import { decodePaymentRequiredHeader } from "@x402/core/http";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { OmniApiError, OmniContractError, OmniPaymentError } from "./errors.js";
import { buildUrl, mergeSignals, parseResponse, type QueryValue } from "./http.js";
import type {
  EntityResolution,
  LiquidationMap,
  MarketCarry,
  MarketRisk,
  MarketSnapshot,
  NewsPulse,
  PaidResult,
  PaymentReceipt,
  PremarketRoundup,
  PremarketRoundupQuery,
  TraderLeaderboard,
  TraderProfile,
  X402Health,
  X402NewsQuery,
  X402Symbol,
} from "./types.js";

export interface ScreenshotPng { contentType: "image/png"; bytes: Uint8Array; byteLength: number }
export interface LiquidationLevelsScreenshotQuery {
  interval?: "1m" | "5m" | "15m" | "1h" | "2h" | "4h" | "8h" | "1d" | "3d" | "1w" | "1M";
  scope?: "current" | "aggregate"; layout?: "compact" | "standard" | "tall";
}
export interface LiquidationBucketScreenshotQuery { price: number; side?: "all" | "buy" | "sell"; scope?: "current" | "aggregate" }
export interface TraderProfileScreenshotQuery { symbol?: X402Symbol; range?: "1d" | "7d" | "30d" | "all"; tab?: "positions" | "pnl" | "balance" | "mixed"; mode?: "chart" | "stats" | "full_stats" }

export interface OmniX402ClientOptions {
  baseUrl?: string;
  paymentClient: x402Client;
  timeoutMs?: number;
  /** PNG rendering can take longer than JSON requests; default 150 seconds. */
  screenshotTimeoutMs?: number;
  /** Default 4 MiB; bounded to 16 MiB. Does not change payment budgets. */
  maxScreenshotBytes?: number;
  fetch?: typeof fetch;
}

export interface EvmPaymentClientOptions {
  /** Optional instance-local authorization cap; exhausted attempts require reconciliation, not a reset/retry. */
  maxPaymentAuthorizations?: number;
  /** Maximum USDC authorized for one Omni x402 call. USDC uses six decimal places. */
  maxPaymentUsd?: number;
  /** Aggregate authorization ceiling for this instance. Holds are never released automatically after failures. */
  maxTotalPaymentUsd?: number;
  /** Explicit receivers; defaults to Omni. Custom sellers require deliberate allowlisting. */
  allowedPayees?: readonly `0x${string}`[];
  allowedNetworks?: readonly ("eip155:84532" | "eip155:8453")[];
  allowedAssets?: Partial<Record<"eip155:84532" | "eip155:8453", readonly `0x${string}`[]>>;
}

export const DEFAULT_MAX_X402_PAYMENT_USD = 0.01;
export const OMNI_X402_RECEIVER = "0x733f40A4FA0cd13d59aBADE04b9eD2e9acAc6457";
export const OMNI_USDC_ASSETS = {
  "eip155:84532": ["0x036CbD53842c5426634e7929541eC2318f3dCF7e"],
  "eip155:8453": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
} as const;

export function createEvmPaymentClient(
  privateKey: `0x${string}`,
  options: EvmPaymentClientOptions = {},
): x402Client {
  const signer = privateKeyToAccount(privateKey);
  const maxPaymentAtomic = usdToUsdcAtomic(options.maxPaymentUsd ?? DEFAULT_MAX_X402_PAYMENT_USD);
  const allowedNetworks = new Set(options.allowedNetworks ?? ["eip155:84532", "eip155:8453"]);
  const allowedAssets = new Map(Object.entries(options.allowedAssets ?? OMNI_USDC_ASSETS)
    .map(([network, assets]) => [network, new Set(assets.map((asset) => asset.toLowerCase()))]));
  const maxPaymentAuthorizations = options.maxPaymentAuthorizations;
  if (maxPaymentAuthorizations !== undefined && (!Number.isSafeInteger(maxPaymentAuthorizations) || maxPaymentAuthorizations < 1)) {
    throw new RangeError("maxPaymentAuthorizations must be a positive safe integer");
  }
  const maxTotalAtomic = options.maxTotalPaymentUsd === undefined ? undefined : usdToUsdcAtomic(options.maxTotalPaymentUsd);
  const allowedPayees = new Set((options.allowedPayees ?? [OMNI_X402_RECEIVER]).map((address) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RangeError("allowedPayees must contain EVM addresses");
    return address.toLowerCase();
  }));
  let authorizedAtomic = 0n;
  let authorizations = 0;
  return new x402Client()
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      if (maxPaymentAuthorizations !== undefined && authorizations >= maxPaymentAuthorizations) {
        return { abort: true, reason: "Payment authorization limit reached; reconcile before any new payment" };
      }
      const amount = BigInt(selectedRequirements.amount);
      if (maxTotalAtomic !== undefined && authorizedAtomic + amount > maxTotalAtomic) {
        return { abort: true, reason: "Aggregate payment authorization budget exceeded; reconcile before any new payment" };
      }
      // Synchronous reservation before signing is shared across concurrent HTTP/MCP calls.
      // A lost response can already have settled; never release or retry that hold automatically.
      authorizedAtomic += amount;
      authorizations++;
    })
    .register("eip155:*", new ExactEvmScheme(signer))
    .registerPolicy((version, requirements) => requirements.filter((requirement) => {
      if (version !== 2 || requirement.scheme !== "exact") return false;
      if (!/^0x[0-9a-fA-F]{40}$/.test(requirement.payTo) || !allowedPayees.has(requirement.payTo.toLowerCase())) return false;
      if (!Number.isSafeInteger(requirement.maxTimeoutSeconds) || requirement.maxTimeoutSeconds <= 0 || requirement.maxTimeoutSeconds > 3600) return false;
      if (!/^[1-9][0-9]*$/.test(requirement.amount)) return false;
      const network = requirement.network as "eip155:84532" | "eip155:8453";
      if (!allowedNetworks.has(network)) return false;
      const networkAssets = allowedAssets.get(network);
      if (!networkAssets?.has(requirement.asset.toLowerCase())) return false;
      try { const amount = BigInt(requirement.amount); return amount > 0n && amount <= maxPaymentAtomic; }
      catch { return false; }
    }));
}

export function usdToUsdcAtomic(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("maxPaymentUsd must be a positive finite number");
  const scaled = Math.floor(value * 1_000_000);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new RangeError("maxPaymentUsd is outside the supported range");
  return BigInt(scaled);
}

export class OmniX402Client {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly screenshotTimeoutMs: number;
  readonly maxScreenshotBytes: number;
  readonly paymentClient: x402Client;
  private readonly fetcher: typeof fetch;
  private readonly rawFetcher: typeof fetch;
  private readonly httpPaymentClient: x402HTTPClient;

  constructor(options: OmniX402ClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://omniterminal.app";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.screenshotTimeoutMs = options.screenshotTimeoutMs ?? 150_000;
    this.maxScreenshotBytes = options.maxScreenshotBytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxScreenshotBytes) || this.maxScreenshotBytes < 8 || this.maxScreenshotBytes > 16 * 1024 * 1024) throw new RangeError("maxScreenshotBytes must be an integer from 8 to 16777216");
    if (!Number.isSafeInteger(this.screenshotTimeoutMs) || this.screenshotTimeoutMs < 1 || this.screenshotTimeoutMs > 180_000) throw new RangeError("screenshotTimeoutMs must be an integer from 1 to 180000");
    this.paymentClient = options.paymentClient;
    this.httpPaymentClient = new x402HTTPClient(options.paymentClient);
    this.rawFetcher = options.fetch ?? globalThis.fetch;
    this.fetcher = wrapFetchWithPayment(async (input, init) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      signal?.throwIfAborted();
      const response = await this.rawFetcher(input, init);
      if (signal?.aborted) {
        cancelPaidResponseBody(response);
        signal.throwIfAborted();
      }
      if (response.status === 402 && response.headers.has("payment-required")) {
        const requestedUrl = input instanceof Request ? input.url : String(input);
        const required = decodePaymentRequiredHeader(response.headers.get("payment-required")!);
        if (required.x402Version !== 2 || required.resource?.url !== requestedUrl) {
          throw new OmniContractError("Payment challenge is bound to a different resource", new URL(requestedUrl).pathname, undefined);
        }
      }
      return response;
    }, options.paymentClient);
  }

  async request<T>(
    method: "GET" | "POST",
    path: string,
    options: {
      query?: Record<string, QueryValue>;
      body?: unknown;
      signal?: AbortSignal;
      contract?: { service: string; schema?: string; requiredCollection?: string };
    } = {},
  ): Promise<PaidResult<T>> {
    const headers = new Headers({ accept: "application/json" });
    if (options.body !== undefined) headers.set("content-type", "application/json");
    const transport = options.contract && options.contract.schema === undefined ? this.rawFetcher : this.fetcher;
    let response: Response;
    try {
      response = await transport(buildUrl(this.baseUrl, path, options.query), {
        method,
        redirect: "error",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: mergeSignals(this.timeoutMs, options.signal),
      });
    } catch (error) {
      throw redactedPaymentError(error);
    }
    const data = await parseResponse<T>(response);
    if (options.contract) validateProductContract(path, data, options.contract);
    let payment: PaymentReceipt | null = null;
    if (response.headers.has("payment-response")) {
      try {
        payment = this.httpPaymentClient.getPaymentSettleResponse((name) => response.headers.get(name)) as PaymentReceipt;
      } catch (error) {
        throw new OmniContractError(`Invalid PAYMENT-RESPONSE for ${path}`, path, { cause: String(error) });
      }
    }
    if (options.contract?.schema !== undefined && !payment) {
      throw new OmniContractError(`Missing PAYMENT-RESPONSE for paid route ${path}`, path, data);
    }
    if (options.contract?.schema !== undefined) validatePaymentSettlement(path, payment);
    return { data, payment, requestId: response.headers.get("x-request-id") };
  }

  /** Read-only challenge inspection: never creates a payment or signs, even when a payer is configured. */
  async inspectPayment(method: "GET" | "POST", path: string, options: {
    query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal;
  } = {}): Promise<{ x402Version: 2; resource: { url: string }; accepts: Array<{
    scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number;
  }> }> {
    const url = buildUrl(this.baseUrl, path, options.query);
    if (url.origin !== new URL(this.baseUrl).origin || !url.pathname.startsWith("/api/x402/v1/")) {
      throw new RangeError("Challenge inspection requires a same-origin Omni x402 product route");
    }
    const response = await this.rawFetcher(url, {
      method, redirect: "error", signal: mergeSignals(this.timeoutMs, options.signal),
      headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const header = response.headers.get("payment-required");
    if (response.status !== 402 || !header) throw new OmniContractError("Expected an x402 PAYMENT-REQUIRED challenge", path, { status: response.status });
    let challenge;
    try { challenge = decodePaymentRequiredHeader(header); }
    catch { throw new OmniContractError("Invalid PAYMENT-REQUIRED challenge", path, undefined); }
    if (challenge.x402Version !== 2 || challenge.resource?.url !== url.toString() || !Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
      throw new OmniContractError("Payment challenge version/resource does not match the inspected request", path, undefined);
    }
    return challenge as { x402Version: 2; resource: { url: string }; accepts: Array<{ scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number }> };
  }

  newsHealth(): Promise<PaidResult<X402Health>> {
    return this.request("GET", "/api/x402/v1/news/health", { contract: { service: "omni-x402-gateway" } });
  }

  traderProfileHealth(): Promise<PaidResult<X402Health>> {
    return this.request("GET", "/api/x402/v1/trader-profile/health", { contract: { service: "omni-x402-gateway" } });
  }

  symbolNews(symbol: X402Symbol, query: X402NewsQuery = {}): Promise<PaidResult<NewsPulse>> {
    assertSymbol(symbol);
    validateNewsQuery(query);
    return this.request("GET", `/api/x402/v1/news/${symbol}`, {
      query: { ...query },
      contract: { service: "omni.ai_news_pulse", schema: "news_pulse.v1", requiredCollection: "items" },
    });
  }

  marketNews(
    market: "crypto" | "macro" | "equities" | "forex" = "crypto",
    query: X402NewsQuery = {},
  ): Promise<PaidResult<NewsPulse>> {
    assertOneOf("market", market, ["crypto", "macro", "equities", "forex"]);
    validateNewsQuery(query);
    return this.request("GET", "/api/x402/v1/news", {
      query: { market, ...query },
      contract: { service: "omni.ai_news_pulse", schema: "news_pulse.v1", requiredCollection: "items" },
    });
  }

  traderProfile(
    address: string,
    query: { range?: "1d" | "7d" | "30d" | "all"; view?: "summary" | "positions" | "balances" | "full"; symbol?: X402Symbol; limit?: number } = {},
  ): Promise<PaidResult<TraderProfile>> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RangeError("address must be a 20-byte EVM address");
    if (query.symbol !== undefined) assertSymbol(query.symbol);
    assertOptionalInteger("limit", query.limit, 1, 20);
    assertOptionalOneOf("range", query.range, ["1d", "7d", "30d", "all"]);
    assertOptionalOneOf("view", query.view, ["summary", "positions", "balances", "full"]);
    return this.request("GET", `/api/x402/v1/trader-profile/${encodeURIComponent(address)}`, {
      query,
      contract: { service: "omni.trader_profile", schema: "trader_profile.v1", requiredCollection: "positions" },
    });
  }

  liquidationMap(
    symbol: X402Symbol,
    query: {
      scope?: "current" | "aggregate";
      view?: "summary" | "buckets" | "clusters" | "flow";
      limit?: number;
      order?: "strongest" | "nearest" | "price";
      around_price?: number;
      side?: "all" | "long" | "short";
    } = {},
  ): Promise<PaidResult<LiquidationMap>> {
    assertSymbol(symbol);
    assertOptionalOneOf("scope", query.scope, ["current", "aggregate"]);
    assertOptionalOneOf("view", query.view, ["summary", "buckets", "clusters", "flow"]);
    assertOptionalOneOf("order", query.order, ["strongest", "nearest", "price"]);
    assertOptionalOneOf("side", query.side, ["all", "long", "short"]);
    assertOptionalInteger("limit", query.limit, 1, 50);
    if (query.around_price !== undefined && (!Number.isFinite(query.around_price) || query.around_price <= 0)) {
      throw new RangeError("around_price must be a positive finite number");
    }
    return this.request("GET", `/api/x402/v1/liquidations/${symbol}`, {
      query,
      contract: { service: "omni.hyperliquid_liquidation_map", schema: "hyperliquid_liquidation_map.v1" },
    });
  }

  traderLeaderboard(
    symbol: X402Symbol,
    query: { scope?: "current" | "aggregate"; rank?: "best" | "worst" | "largest" | "largest_size" | "wallet_size" | "risk" | "closest"; limit?: number } = {},
  ): Promise<PaidResult<TraderLeaderboard>> {
    assertSymbol(symbol);
    assertOptionalOneOf("scope", query.scope, ["current", "aggregate"]);
    assertOptionalOneOf("rank", query.rank, ["best", "worst", "largest", "largest_size", "wallet_size", "risk", "closest"]);
    assertOptionalInteger("limit", query.limit, 1, 20);
    return this.request("GET", `/api/x402/v1/traders/${symbol}`, {
      query,
      contract: { service: "omni.hyperliquid_trader_leaderboard", schema: "hyperliquid_trader_leaderboard.v1", requiredCollection: "rows" },
    });
  }

  marketRisk(
    symbol: X402Symbol,
    query: { scope?: "current" | "aggregate"; event_window_minutes?: 15 | 60; limit?: number } = {},
  ): Promise<PaidResult<MarketRisk>> {
    assertSymbol(symbol);
    assertOptionalOneOf("scope", query.scope, ["current", "aggregate"]);
    assertOptionalOneOf("event_window_minutes", query.event_window_minutes, [15, 60]);
    assertOptionalInteger("limit", query.limit, 1, 10);
    return this.request("GET", `/api/x402/v1/market-risk/${symbol}`, {
      query,
      contract: { service: "omni.market_risk_snapshot", schema: "market_risk_snapshot.v1" },
    });
  }

  marketSnapshot(
    symbol: X402Symbol,
    query: { interval?: "1m" | "5m" | "15m" | "1h" | "2h" | "4h" | "8h" | "1d" | "3d" | "1w" | "1M"; limit?: number; scope?: "current" | "aggregate"; include_liquidations?: boolean } = {},
  ): Promise<PaidResult<MarketSnapshot>> {
    assertSymbol(symbol);
    assertOptionalOneOf("interval", query.interval, ["1m", "5m", "15m", "1h", "2h", "4h", "8h", "1d", "3d", "1w", "1M"]);
    assertOptionalOneOf("scope", query.scope, ["current", "aggregate"]);
    assertOptionalInteger("limit", query.limit, 20, 200);
    assertOptionalBoolean("include_liquidations", query.include_liquidations);
    return this.request("GET", `/api/x402/v1/market-snapshot/${symbol}`, {
      query,
      contract: { service: "omni.hyperliquid_market_snapshot", schema: "hyperliquid_market_snapshot.v1", requiredCollection: "candles" },
    });
  }

  resolveSymbols(mentions: string[], venue: "hyperliquid" = "hyperliquid"): Promise<PaidResult<EntityResolution>> {
    assertOneOf("venue", venue, ["hyperliquid"]);
    if (!Array.isArray(mentions) || mentions.length < 1 || mentions.length > 20) {
      throw new RangeError("mentions must contain between 1 and 20 entries");
    }
    const normalizedMentions = mentions.map((mention, index) => {
      if (typeof mention !== "string") throw new TypeError(`mentions[${index}] must be a string`);
      const normalized = mention.trim();
      if (normalized.length < 1 || normalized.length > 100) throw new RangeError(`mentions[${index}] must contain 1 to 100 characters`);
      return normalized;
    });
    return this.request("POST", "/api/x402/v1/symbols/resolve", {
      body: { mentions: normalizedMentions, venue },
      contract: { service: "omni.market_entity_resolution", schema: "market_entity_resolution.v1", requiredCollection: "results" },
    });
  }

  marketCarry(symbol: X402Symbol): Promise<PaidResult<MarketCarry>> {
    assertSymbol(symbol);
    return this.request("GET", `/api/x402/v1/market-carry/${symbol}`, {
      contract: { service: "omni.hyperliquid_market_carry", schema: "hyperliquid_market_carry.v1" },
    });
  }

  /** Purchase a bounded PNG. The returned receipt is seller metadata; reconcile it on-chain separately. */
  private async requestScreenshot(path: string, query: Record<string, QueryValue>): Promise<PaidResult<ScreenshotPng>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Screenshot request timed out", "TimeoutError")), this.screenshotTimeoutMs);
    let response: Response | undefined;
    try {
      response = await waitForScreenshot(this.fetcher(buildUrl(this.baseUrl, path, query), {
        method: "GET", redirect: "error", headers: { accept: "image/png" }, signal: controller.signal,
      }), controller.signal);
      if (!response.ok) throw new OmniApiError("Omni screenshot request failed", response.status, response, undefined);
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "image/png") {
        throw new OmniContractError("Expected image/png screenshot", path, undefined);
      }
      let payment: PaymentReceipt | null = null;
      try {
        payment = this.httpPaymentClient.getPaymentSettleResponse((name) => response!.headers.get(name)) as PaymentReceipt;
      } catch {
        throw new OmniContractError("Invalid screenshot PAYMENT-RESPONSE", path, undefined);
      }
      validatePaymentSettlement(path, payment);
      // Fetch decodes gzip/br, but Content-Length still describes wire bytes.
      // Compare declared lengths only when they describe the decoded PNG body.
      const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
      const declaredLength = !encoding || encoding === "identity" ? response.headers.get("content-length") : null;
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > this.maxScreenshotBytes)) {
        throw new OmniContractError("Screenshot exceeds client byte budget", path, undefined);
      }
      if (!response.body) throw new OmniContractError("Missing screenshot body", path, undefined);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      try {
        while (true) {
          const { value, done } = await waitForScreenshot(reader.read(), controller.signal);
          if (done) break;
          byteLength += value.byteLength;
          if (byteLength > this.maxScreenshotBytes) throw new OmniContractError("Screenshot exceeds client byte budget", path, undefined);
          chunks.push(value);
        }
      } catch (error) {
        // Adapter cancellation may never resolve. Close pending reads without waiting.
        void reader.cancel().catch(() => undefined);
        throw error;
      } finally { reader.releaseLock(); }
      if (declaredLength !== null && byteLength !== Number(declaredLength)) throw new OmniContractError("Screenshot length mismatch", path, undefined);
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (!signature.every((value, index) => bytes[index] === value)) throw new OmniContractError("Invalid PNG signature", path, undefined);
      return { data: { contentType: "image/png", bytes, byteLength }, payment, requestId: response.headers.get("x-request-id") };
    } catch (error) {
      if (response) cancelPaidResponseBody(response);
      if (error instanceof OmniContractError || error instanceof OmniApiError) throw error;
      throw redactedPaymentError(error);
    } finally { clearTimeout(timer); }
  }

  liquidationLevelsScreenshot(symbol: X402Symbol, query: LiquidationLevelsScreenshotQuery = {}): Promise<PaidResult<ScreenshotPng>> {
    assertSymbol(symbol);
    assertOptionalOneOf("interval", query.interval, ["1m", "5m", "15m", "1h", "2h", "4h", "8h", "1d", "3d", "1w", "1M"]);
    assertOptionalOneOf("scope", query.scope, ["current", "aggregate"]);
    assertOptionalOneOf("layout", query.layout, ["compact", "standard", "tall"]);
    return this.requestScreenshot(`/api/x402/v1/screenshots/liquidation-levels/${symbol}`, { ...query });
  }

  liquidationBucketScreenshot(symbol: X402Symbol, query: LiquidationBucketScreenshotQuery): Promise<PaidResult<ScreenshotPng>> {
    assertSymbol(symbol);
    if (!query || !Number.isFinite(query.price) || query.price <= 0 || query.price > 1_000_000_000) throw new RangeError("price must be a positive finite number at most 1000000000");
    assertOptionalOneOf("side", query.side, ["all", "buy", "sell"]);
    assertOptionalOneOf("scope", query.scope, ["current", "aggregate"]);
    return this.requestScreenshot(`/api/x402/v1/screenshots/liquidation-bucket/${symbol}`, { ...query });
  }

  traderProfileScreenshot(address: string, query: TraderProfileScreenshotQuery = {}): Promise<PaidResult<ScreenshotPng>> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RangeError("address must be a 20-byte EVM address");
    if (query.symbol !== undefined) assertSymbol(query.symbol);
    assertOptionalOneOf("range", query.range, ["1d", "7d", "30d", "all"]);
    assertOptionalOneOf("tab", query.tab, ["positions", "pnl", "balance", "mixed"]);
    assertOptionalOneOf("mode", query.mode, ["chart", "stats", "full_stats"]);
    return this.requestScreenshot(`/api/x402/v1/screenshots/trader-profile/${encodeURIComponent(address)}`, { ...query });
  }

  premarketRoundup(limit?: number): Promise<PaidResult<PremarketRoundup>>;
  premarketRoundup(query?: PremarketRoundupQuery): Promise<PaidResult<PremarketRoundup>>;
  premarketRoundup(input: number | PremarketRoundupQuery = 1): Promise<PaidResult<PremarketRoundup>> {
    const query = typeof input === "number" ? { limit: input } : { ...input };
    query.limit ??= 1;
    assertOptionalInteger("limit", query.limit, 1, 5);
    if (query.date !== undefined) assertIsoDate("date", query.date);
    return this.request("GET", "/api/x402/v1/research/premarket", {
      query,
      contract: {
        service: "omni.premarket_roundup",
        schema: "premarket_roundup.v1",
        requiredCollection: "items",
      },
    });
  }
}

const x402Symbols: readonly X402Symbol[] = ["BTC", "ETH", "SOL", "HYPE"];

function assertSymbol(symbol: string): asserts symbol is X402Symbol {
  assertOneOf("symbol", symbol, x402Symbols);
}

function assertIsoDate(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${name} must be an exact YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} must be a valid YYYY-MM-DD date`);
  }
}

function validateNewsQuery(query: X402NewsQuery): void {
  assertOptionalInteger("limit", query.limit, 1, 20);
  assertOptionalInteger("lookback_hours", query.lookback_hours, 1, 168);
  assertOptionalOneOf("event_window_minutes", query.event_window_minutes, [15, 60]);
  assertOptionalOneOf("mode", query.mode, ["latest", "window", "context"]);
  assertOptionalOneOf("order", query.order, ["recent", "impact"]);
  assertOptionalInteger("offset", query.offset, 0, 19);
  assertOptionalOneOf("sentiment", query.sentiment, ["bullish", "bearish", "neutral"]);
  assertOptionalOneOf("impact", query.impact, ["high", "medium", "low"]);
  if (query.nearest_timestamp !== undefined && (!Number.isSafeInteger(query.nearest_timestamp) || query.nearest_timestamp < 1_000_000_000_000 || query.nearest_timestamp > 9_999_999_999_999)) {
    throw new RangeError("nearest_timestamp must be a 13-digit Unix timestamp in milliseconds");
  }
  if (query.min_confidence !== undefined && (!Number.isFinite(query.min_confidence) || query.min_confidence < 0 || query.min_confidence > 1)) {
    throw new RangeError("min_confidence must be between 0 and 1");
  }
}

function assertOptionalInteger(name: string, value: number | undefined, minimum: number, maximum: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < minimum || value > maximum)) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertOptionalBoolean(name: string, value: boolean | undefined): void {
  if (value !== undefined && typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
}

function assertOptionalOneOf<T>(name: string, value: T | undefined, allowed: readonly T[]): void {
  if (value !== undefined) assertOneOf(name, value, allowed);
}

function assertOneOf<T>(name: string, value: T, allowed: readonly T[]): void {
  if (!allowed.includes(value)) throw new RangeError(`${name} must be one of: ${allowed.join(", ")}`);
}

function validateProductContract(
  route: string,
  data: unknown,
  contract: { service: string; schema?: string; requiredCollection?: string },
): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected an object`, route, data);
  }
  const record = data as Record<string, unknown>;
  if (record.service !== contract.service) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected service ${contract.service}`, route, data);
  }
  if (contract.schema !== undefined && record.schema !== contract.schema) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected schema ${contract.schema}`, route, data);
  }
  if (contract.requiredCollection !== undefined && !Array.isArray(record[contract.requiredCollection])) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected ${contract.requiredCollection} array`, route, data);
  }
}

/** Validate seller settlement metadata. Chain receipts must be independently reconciled for proof. */
export function validatePaymentSettlement(route: string, payment: unknown): asserts payment is PaymentReceipt {
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: expected an object`, route, payment);
  }
  const record = payment as Record<string, unknown>;
  if (record.success !== true) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: settlement was not successful`, route, payment);
  }
  if (typeof record.transaction !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(record.transaction)) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: missing transaction`, route, payment);
  }
  if (record.network !== "eip155:8453" && record.network !== "eip155:84532") {
    throw new OmniContractError(`Invalid payment settlement for ${route}: missing network`, route, payment);
  }
}


function redactedPaymentError(error: unknown): Error {
  if (error instanceof OmniContractError) return error;
  const message = error instanceof Error ? error.message : "";
  const code = message.includes("Aggregate payment authorization budget exceeded") ? "PAYMENT_BUDGET_EXCEEDED"
    : message.includes("Payment authorization limit reached") ? "PAYMENT_AUTHORIZATION_LIMIT" : "PAYMENT_OUTCOME_UNKNOWN";
  const kind = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? error.name : undefined;
  return new OmniPaymentError(code, kind);
}


function cancelPaidResponseBody(response: Response): void {
  // Best-effort cleanup must not extend the caller deadline or expose adapter errors.
  try { void response.body?.cancel().catch(() => undefined); } catch { /* already locked/closed */ }
}

async function waitForScreenshot<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    signal.throwIfAborted();
  }
  let rejectOnAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(signal.reason);
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", rejectOnAbort); }
}
