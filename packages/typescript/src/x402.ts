import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { OmniContractError } from "./errors.js";
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

export interface OmniX402ClientOptions {
  baseUrl?: string;
  paymentClient: x402Client;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface EvmPaymentClientOptions {
  /** Maximum USDC authorized for one Omni x402 call. USDC uses six decimal places. */
  maxPaymentUsd?: number;
  allowedNetworks?: readonly ("eip155:84532" | "eip155:8453")[];
  allowedAssets?: Partial<Record<"eip155:84532" | "eip155:8453", readonly `0x${string}`[]>>;
}

export const DEFAULT_MAX_X402_PAYMENT_USD = 0.01;
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
  const allowedAssets = options.allowedAssets ?? OMNI_USDC_ASSETS;
  return new x402Client()
    .register("eip155:*", new ExactEvmScheme(signer))
    .registerPolicy((_version, requirements) => requirements.filter((requirement) => {
      const network = requirement.network as "eip155:84532" | "eip155:8453";
      if (!allowedNetworks.has(network)) return false;
      const networkAssets = allowedAssets[network];
      if (!networkAssets?.some((asset) => asset.toLowerCase() === requirement.asset.toLowerCase())) return false;
      try { return BigInt(requirement.amount) <= maxPaymentAtomic; }
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
  readonly paymentClient: x402Client;
  private readonly fetcher: typeof fetch;
  private readonly httpPaymentClient: x402HTTPClient;

  constructor(options: OmniX402ClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://omniterminal.app";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.paymentClient = options.paymentClient;
    this.httpPaymentClient = new x402HTTPClient(options.paymentClient);
    this.fetcher = wrapFetchWithPayment(options.fetch ?? globalThis.fetch, options.paymentClient);
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
    const response = await this.fetcher(buildUrl(this.baseUrl, path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: mergeSignals(this.timeoutMs, options.signal),
    });
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

/** Fail closed unless an x402 settlement proves a successful on-chain payment. */
export function validatePaymentSettlement(route: string, payment: unknown): asserts payment is PaymentReceipt {
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: expected an object`, route, payment);
  }
  const record = payment as Record<string, unknown>;
  if (record.success !== true) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: settlement was not successful`, route, payment);
  }
  if (typeof record.transaction !== "string" || record.transaction.length === 0) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: missing transaction`, route, payment);
  }
  if (typeof record.network !== "string" || record.network.length === 0) {
    throw new OmniContractError(`Invalid payment settlement for ${route}: missing network`, route, payment);
  }
}
