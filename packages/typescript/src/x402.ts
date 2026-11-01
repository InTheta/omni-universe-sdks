import type { PublicCongressFiling, PublicCongressQuery } from "./types.js";
import type { PublicMarketAlerts, PublicMarketAlertsQuery } from "./types.js";
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
  MarketMicrostructure,
  FundingHistory,
  PublicMarketSymbol,
  PublicMarketCatalog,
  PublicMarketsQuery,
  L4BookSnapshot,
  RealizedLiquidations,
  LiquidationWindow,
  PublicSpotMarketsQuery, PublicSpotMarketCatalog, SpotMarketQuote, SpotCandles, SpotCandleInterval,
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
export interface LiquidationBucketScreenshotQuery { price: number; price_end?:number; bucket_size?:number; side?: "all" | "buy" | "sell"; scope?: "current" | "aggregate" }
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
    try {
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
    } catch (error) {
      if (transport === this.fetcher) {
        cancelPaidResponseBody(response);
        throw unconfirmedPaidResponse(error);
      }
      throw error;
    }
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
    symbol: PublicMarketSymbol,
    query: {
      scope?: "current" | "aggregate";
      view?: "summary" | "buckets" | "clusters" | "flow";
      limit?: number;
      order?: "strongest" | "nearest" | "price";
      around_price?: number;
      side?: "all" | "long" | "short";
    } = {},
  ): Promise<PaidResult<LiquidationMap>> {
    assertPublicMarketSymbol(symbol);
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
    symbol: PublicMarketSymbol,
    query: { scope?: "current" | "aggregate"; rank?: "best" | "worst" | "largest" | "largest_size" | "wallet_size" | "risk" | "closest"; limit?: number } = {},
  ): Promise<PaidResult<TraderLeaderboard>> {
    assertPublicMarketSymbol(symbol);
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
    symbol: PublicMarketSymbol,
    query: { interval?: "1m" | "5m" | "15m" | "1h" | "2h" | "4h" | "8h" | "1d" | "3d" | "1w" | "1M"; limit?: number; scope?: "current" | "aggregate"; include_liquidations?: boolean } = {},
  ): Promise<PaidResult<MarketSnapshot>> {
    assertPublicMarketSymbol(symbol);
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

  marketCarry(symbol: PublicMarketSymbol): Promise<PaidResult<MarketCarry>> {
    assertPublicMarketSymbol(symbol);
    return this.request("GET", `/api/x402/v1/market-carry/${symbol}`, {
      contract: { service: "omni.hyperliquid_market_carry", schema: "hyperliquid_market_carry.v1" },
    });
  }

  marketMicrostructure(symbol:PublicMarketSymbol,query:{depth?:number;trade_limit?:number;trade_window_seconds?:number}={}):Promise<PaidResult<MarketMicrostructure>>{
    assertPublicMarketSymbol(symbol);assertOptionalInteger("depth",query.depth,1,50);assertOptionalInteger("trade_limit",query.trade_limit,1,100);assertOptionalInteger("trade_window_seconds",query.trade_window_seconds,1,3600);
    return this.request("GET",`/api/x402/v1/market-microstructure/${encodeURIComponent(symbol)}`,{query,contract:{service:"omni.hyperliquid_market_microstructure",schema:"hyperliquid_market_microstructure.v1",requiredCollection:"trades"}});
  }

  async marketInstruments(query:PublicMarketsQuery={}):Promise<PaidResult<PublicMarketCatalog>>{
    validatePublicMarketsQuery(query);
    const result=await this.request<PublicMarketCatalog>("GET","/api/x402/v1/markets",{query:{...query},contract:{service:"omni.public_market_catalog",requiredCollection:"rows"}});
    if(result.data.schema!=="public_market_catalog.v1")throw new OmniContractError("Invalid public market catalog schema","/api/x402/v1/markets",undefined);
    return result;
  }

  async spotMarketInstruments(query:PublicSpotMarketsQuery={}):Promise<PaidResult<PublicSpotMarketCatalog>>{
    validateSpotMarketsQuery(query);
    const result=await this.request<PublicSpotMarketCatalog>("GET","/api/x402/v1/spot-markets",{query:{...query},contract:{service:"omni.public_spot_market_catalog",requiredCollection:"rows"}});
    if(result.data.schema!=="public_spot_market_catalog.v1")throw new OmniContractError("Invalid public spot catalog schema","/api/x402/v1/spot-markets",undefined);
    return result;
  }
  async spotMarketQuote(pairIndex:number,query:{depth?:number}={}):Promise<PaidResult<SpotMarketQuote>>{
    assertSpotPairIndex(pairIndex);assertOptionalInteger("depth",query.depth,1,20);
    const result=await this.request<SpotMarketQuote>("GET",`/api/x402/v1/spot-quote/${pairIndex}`,{query,contract:{service:"omni.hyperliquid_spot_quote",schema:"hyperliquid_spot_quote.v1"}});
    assertSpotResultIdentity(result.data,pairIndex);return result;
  }
  async spotCandles(pairIndex:number,query:{interval?:SpotCandleInterval;limit?:number}={}):Promise<PaidResult<SpotCandles>>{
    assertSpotPairIndex(pairIndex);validateSpotCandlesQuery(query);
    const result=await this.request<SpotCandles>("GET",`/api/x402/v1/spot-candles/${pairIndex}`,{query,contract:{service:"omni.hyperliquid_spot_candles",schema:"hyperliquid_spot_candles.v1",requiredCollection:"candles"}});
    assertSpotResultIdentity(result.data,pairIndex);return result;
  }

  async congressFiling(docId:string,query:PublicCongressQuery={}):Promise<PaidResult<PublicCongressFiling>> {
    validateCongressRequest(docId,query);
    const result=await this.request<PublicCongressFiling>("GET",`/api/x402/v1/congress-filings/${encodeURIComponent(docId)}`,{query:{...query},contract:{service:"omni.public_congress_filing",schema:"public_congress_filing.v1",requiredCollection:"rows"}});
    assertCongressFilingIdentity(result.data,docId,query);return result;
  }

  async marketAlerts(symbol:PublicMarketSymbol,query:PublicMarketAlertsQuery={}):Promise<PaidResult<PublicMarketAlerts>>{
    assertPublicMarketSymbol(symbol);validateMarketAlertsQuery(query);
    const result=await this.request<PublicMarketAlerts>("GET",`/api/x402/v1/market-alerts/${encodeURIComponent(symbol)}`,{query:{...query,types:query.types?.join(",")},contract:{service:"omni.public_market_alerts",schema:"public_market_alerts.v1",requiredCollection:"events"}});
    assertMarketAlertsIdentity(result.data,symbol);return result;
  }

  fundingHistory(symbol:PublicMarketSymbol,query:{lookback_hours?:number;limit?:number}={}):Promise<PaidResult<FundingHistory>>{
    assertPublicMarketSymbol(symbol);assertOptionalInteger("lookback_hours",query.lookback_hours,1,168);assertOptionalInteger("limit",query.limit,1,168);
    return this.request("GET",`/api/x402/v1/funding-history/${encodeURIComponent(symbol)}`,{query,contract:{service:"omni.hyperliquid_funding_history",schema:"hyperliquid_funding_history.v1",requiredCollection:"rows"}});
  }
  l4BookSnapshot(symbol:PublicMarketSymbol,query:{orders_per_side?:number}={}):Promise<PaidResult<L4BookSnapshot>>{
    assertPublicMarketSymbol(symbol);assertOptionalInteger("orders_per_side",query.orders_per_side,1,50);
    return this.request("GET",`/api/x402/v1/orderbook-l4/${encodeURIComponent(symbol)}`,{query,contract:{service:"omni.hyperliquid_l4_snapshot",schema:"hyperliquid_l4_snapshot.v1",requiredCollection:"bids"}});
  }
  realizedLiquidations(symbol:PublicMarketSymbol,query:{scope?:"current"|"aggregate";windows?:readonly LiquidationWindow[]}={}):Promise<PaidResult<RealizedLiquidations>>{
    assertPublicMarketSymbol(symbol);assertOptionalOneOf("scope",query.scope,["current","aggregate"]);validateLiquidationWindows(query.windows);
    return this.request("GET",`/api/x402/v1/liquidation-bursts/${encodeURIComponent(symbol)}`,{query:{scope:query.scope,windows:query.windows?.join(",")},contract:{service:"omni.hyperliquid_realized_liquidations",schema:"hyperliquid_realized_liquidations.v1",requiredCollection:"windows"}});
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
      if (response) throw unconfirmedPaidResponse(error);
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
    for(const key of ["price_end","bucket_size"] as const)if(query[key]!==undefined&&(!Number.isFinite(query[key])||query[key]!<=0||query[key]!>1e9))throw new RangeError(`${key} must be positive and bounded`);
    if(query.price_end!==undefined&&query.price_end<=query.price)throw new RangeError("price_end must exceed price");
    if(query.price_end!==undefined&&query.bucket_size!==undefined&&Math.abs(query.price_end-query.price-query.bucket_size)>Math.max(1e-8,query.bucket_size*1e-10))throw new RangeError("bucket range must agree");
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

export function assertPublicMarketSymbol(symbol:unknown):asserts symbol is PublicMarketSymbol{
  if(typeof symbol!=="string" || !/^(?:[a-zA-Z0-9_-]{1,24}:)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(symbol))throw new RangeError("symbol must be a public perpetual subscription key, optionally dex:COIN");
}
export function validatePublicMarketsQuery(query:PublicMarketsQuery):void{
  for(const key of Object.keys(query))if(!["limit","offset","search","dex","revision"].includes(key))throw new RangeError("unknown public market catalog query");
  assertOptionalInteger("limit",query.limit,1,50);assertOptionalInteger("offset",query.offset,0,100000);assertOptionalInteger("revision",query.revision,0,Number.MAX_SAFE_INTEGER);
  if(query.search!==undefined&&(typeof query.search!=="string"||query.search.length>40||/[\u0000-\u001f\u007f]/.test(query.search)))throw new RangeError("invalid market search");
  if(query.dex!==undefined&&(typeof query.dex!=="string"||!/^[a-zA-Z0-9_-]{1,24}$/.test(query.dex)))throw new RangeError("invalid dex");
}
export function assertSpotPairIndex(value:unknown):asserts value is number {if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||value>9999999)throw new RangeError("pair_index must be an exact public spot pair index");}
export function assertSpotResultIdentity(value:{market?:unknown},pairIndex:number):void {
  const m=value.market as Record<string,unknown>|undefined;
  if(!m||m.market_id!==`hyperliquid:spot:${pairIndex}`||m.market_type!=="spot"||m.pair_index!==pairIndex||m.source_coin!==(pairIndex===0?"PURR/USDC":`@${pairIndex}`))throw unconfirmedPaidResponse(new OmniContractError("Paid spot response has a different market identity",`spot:${pairIndex}`,undefined));
}
export function validateSpotCandlesQuery(query:{interval?:SpotCandleInterval;limit?:number}){assertOptionalOneOf("interval",query.interval,["1m","5m","15m","1h","4h","1d"]);assertOptionalInteger("limit",query.limit,1,200);}
export function validateSpotMarketsQuery(query:PublicSpotMarketsQuery){for(const k of Object.keys(query))if(!["limit","offset","revision"].includes(k))throw new RangeError("unknown spot market query");assertOptionalInteger("limit",query.limit,1,25);assertOptionalInteger("offset",query.offset,0,10000);if(query.revision!==undefined&&(typeof query.revision!=="string"||!/^[a-f0-9]{64}$/.test(query.revision)))throw new RangeError("spot metadata revision must be sha256");}
export function validateLiquidationWindows(windows:unknown):void{
  if(windows===undefined)return;
  if(!Array.isArray(windows)||windows.length<1||windows.length>4||new Set(windows).size!==windows.length||windows.some(v=>!["1m","5m","15m","1h"].includes(String(v))))throw new RangeError("windows must contain one to four unique supported windows");
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


/** Keep established typed errors while making a failed paid response unsafe to re-buy. */
function unconfirmedPaidResponse(error: unknown): Error {
  const failure = error instanceof OmniContractError || error instanceof OmniApiError
    ? error : redactedPaymentError(error);
  // A response body/contract failure can happen after settlement, or after its receipt
  // was dropped. These flags are conservative recovery metadata, never payment proof.
  return Object.defineProperties(failure, {
    requiresReconciliation: { value: true, enumerable: true, writable: false, configurable: false },
    retryable: { value: false, enumerable: true, writable: false, configurable: false },
    paymentOutcome: { value: "unconfirmed", enumerable: true, writable: false, configurable: false },
  });
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

export function validateMarketAlertsQuery(query:PublicMarketAlertsQuery):void {
  for(const key of Object.keys(query))if(!["limit","lookback_hours","before_timestamp","types"].includes(key))throw new RangeError("unknown market alerts query");
  assertOptionalInteger("limit",query.limit,1,20);assertOptionalInteger("lookback_hours",query.lookback_hours,1,24);
  if(query.before_timestamp!==undefined&&(!Number.isSafeInteger(query.before_timestamp)||query.before_timestamp<1_000_000_000_000||query.before_timestamp>Date.now()))throw new RangeError("before_timestamp must be a past Unix millisecond timestamp");
  if(query.types!==undefined&&(!Array.isArray(query.types)||query.types.length<1||query.types.length>2||new Set(query.types).size!==query.types.length||query.types.some(v=>!["large_liquidation","large_trader_action"].includes(v))))throw new RangeError("types must contain unique supported public market alert types");
}
export function assertMarketAlertsIdentity(data:PublicMarketAlerts,requested:string):void {
  const parts=requested.split(":"),expected=parts.length===1?requested.toUpperCase():parts[0]!.toLowerCase()==="main"?parts[1]!.toUpperCase():`${parts[0]!.toLowerCase()}:${parts[1]!.toUpperCase()}`;
  if(data.symbol!==expected||data.venue!=="hyperliquid"||data.market_type!=="perp"||data.events.some(e=>!e||typeof e!=="object"||e.symbol!==expected||typeof e.address!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(e.address)||/^0x0{40}$/.test(e.address)||typeof e.id!=="string"||!/^market_event_[a-f0-9]{64}$/.test(e.id)||!["liquidation_fill","observed_position_change"].includes(e.kind)||!Number.isFinite(Date.parse(e.event_at))||Date.parse(e.event_at)>Date.now()+5000))throw unconfirmedPaidResponse(new OmniContractError("Paid market alerts response has an invalid market or wallet identity","market-alerts",undefined));
}

export function validateCongressRequest(docId:string,query:PublicCongressQuery={}):void {
 if(typeof docId!=="string"||!/^\d{1,12}$/.test(docId))throw new RangeError("docId must be a numeric official House document ID");
 if(!query||typeof query!=="object"||Array.isArray(query))throw new TypeError("filing query must be an object");
 for(const key of Object.keys(query))if(!["limit","offset","public_revision"].includes(key))throw new RangeError("unknown public filing query");
 assertOptionalInteger("limit",query.limit,1,20);assertOptionalInteger("offset",query.offset,0,499);
 if(query.public_revision!==undefined&&(typeof query.public_revision!=="string"||!/^[a-f0-9]{64}$/.test(query.public_revision)))throw new RangeError("invalid public filing revision");
}
export function assertCongressFilingIdentity(data:PublicCongressFiling,docId:string,query:PublicCongressQuery={}):void {
 const reject=():never=>{throw unconfirmedPaidResponse(new OmniContractError("Paid House filing response has an invalid document or revision identity","congress-filings",undefined));};
 const date=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
 const integer=(v:unknown,min:number,max:number):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max;
 if(!data||typeof data!=="object"||data.service!=="omni.public_congress_filing"||data.schema!=="public_congress_filing.v1"||data.doc_id!==docId||data.source!=="house_clerk"||data.chamber!=="House"||typeof data.member!=="string"||!data.member.trim()||!date(data.disclosure_date)||typeof data.public_revision!=="string"||!/^[a-f0-9]{64}$/.test(data.public_revision)||(query.public_revision!==undefined&&data.public_revision!==query.public_revision)||!Array.isArray(data.rows))return reject();
 if(typeof data.parsed_at!=="string"||!Number.isFinite(Date.parse(data.parsed_at))||Date.parse(data.parsed_at)<Date.parse(`${data.disclosure_date}T00:00:00Z`)||Date.parse(data.parsed_at)>Date.now()+5000)return reject();
 if(data.official_url!==`https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${data.disclosure_date.slice(0,4)}/${docId}.pdf`||!data.freshness||data.freshness.status!=="historical"||data.freshness.data_as_of!==data.disclosure_date||data.freshness.timestamp_precision!=="date"||data.freshness.source_poll_status!=="unknown")return reject();
 const page=data.pagination,coverage=data.coverage;
 if(!page||page.limit!==(query.limit??20)||page.offset!==(query.offset??0)||!integer(page.source_row_count,1,500)||page.returned_count!==data.rows.length||data.rows.length>page.limit||!coverage||coverage.parser_completed!==true||coverage.document_rows_complete!=="unknown"||coverage.global_completeness!=="unknown"||coverage.amendment_status!=="unknown"||coverage.source_parsed_row_count!==page.source_row_count)return reject();
 const count=Math.max(0,Math.min(page.limit,page.source_row_count-page.offset));if(count!==data.rows.length||page.next_offset!==(page.offset+count<page.source_row_count?page.offset+count:null))return reject();
 const indices=new Set<number>(),ids=new Set<string>();let previousIndex=0;for(const row of data.rows){
  if(!row||typeof row!=="object"||typeof row.id!=="string"||!/^house_filing_row_[a-f0-9]{64}$/.test(row.id)||!integer(row.row_index,1,10000)||indices.has(row.row_index)||row.row_index<=previousIndex||ids.has(row.id)||typeof row.asset!=="string"||!row.asset.trim()||row.asset.length>1000||/[\u0000-\u001f\u007f]/.test(row.asset)||typeof row.asset_type!=="string"||!/^[A-Z]{2}$/.test(row.asset_type)||!date(row.transaction_date)||!date(row.notification_date)||row.transaction_date>row.notification_date||row.notification_date>data.disclosure_date||!["buy","sell","exchange"].includes(row.transaction_type)||typeof row.reported_amount!=="string"||!/^\$\d[\d,]*(?:\.\d{2})?(?: - \$\d[\d,]*(?:\.\d{2})?)?$/.test(row.reported_amount)||row.amount_currency!=="USD"||row.amount_basis!=="reported_disclosure_range_or_amount")return reject();
  if(![null,"SP","JT","DC"].includes(row.owner_code)||![null,"partial","total","full"].includes(row.sale_kind))return reject();
  if(row.ticker===null?row.ticker_resolution!=="unresolved":typeof row.ticker!=="string"||!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(row.ticker)||row.ticker_resolution!=="reported_in_filing")return reject();indices.add(row.row_index);ids.add(row.id);previousIndex=row.row_index;
 }
}
