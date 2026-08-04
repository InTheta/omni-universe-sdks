import { mergeSignals, parseResponse } from "./http.js";
import { OmniContractError } from "./errors.js";

export type HyperliquidInterval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";

export interface HyperliquidPerpAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  [key: string]: unknown;
}

export interface HyperliquidMeta {
  universe: HyperliquidPerpAsset[];
  [key: string]: unknown;
}

export interface HyperliquidSpotAsset {
  index: number;
  name: string;
  tokens: [number, number];
  isCanonical?: boolean;
  [key: string]: unknown;
}

export interface HyperliquidSpotToken {
  index: number;
  name: string;
  szDecimals: number;
  weiDecimals: number;
  tokenId: string;
  isCanonical?: boolean;
  evmContract?: string | null;
  fullName?: string | null;
  [key: string]: unknown;
}

export interface HyperliquidSpotMeta {
  universe: HyperliquidSpotAsset[];
  tokens: HyperliquidSpotToken[];
  [key: string]: unknown;
}

export interface HyperliquidCandle {
  T: number;
  c: string;
  h: string;
  i: HyperliquidInterval;
  l: string;
  n: number;
  o: string;
  s: string;
  t: number;
  v: string;
}

export interface HyperliquidBookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface HyperliquidL2Book {
  coin: string;
  time: number;
  levels: [HyperliquidBookLevel[], HyperliquidBookLevel[]];
}

export interface HyperliquidPublicClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export class HyperliquidPublicClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  private readonly fetcher: typeof fetch;

  constructor(options: HyperliquidPublicClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.hyperliquid.xyz";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) throw new RangeError("maxRetries must be a non-negative integer");
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive integer");
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async info<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const requestSignal = mergeSignals(this.timeoutMs, signal);
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(new URL("/info", this.baseUrl), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal,
      });
      if (response.ok || attempt >= this.maxRetries || !isRetryable(response.status)) {
        return parseResponse<T>(response);
      }
      const waitMs = retryDelayMs(response.headers.get("retry-after"), attempt);
      await response.arrayBuffer().catch(() => undefined);
      await delay(waitMs, requestSignal);
    }
  }

  async perpetualMeta(dex?: string): Promise<HyperliquidMeta> {
    const normalizedDex = normalizeOptionalIdentifier("dex", dex);
    const data = await this.info<unknown>({ type: "meta", ...(normalizedDex ? { dex: normalizedDex } : {}) });
    const record = assertRecord("meta", data);
    assertArrayField("meta", record, "universe");
    return record as unknown as HyperliquidMeta;
  }

  async perpetuals(dex?: string): Promise<HyperliquidPerpAsset[]> {
    return (await this.perpetualMeta(dex)).universe;
  }

  async spotMeta(): Promise<HyperliquidSpotMeta> {
    const data = await this.info<unknown>({ type: "spotMeta" });
    const record = assertRecord("spotMeta", data);
    assertArrayField("spotMeta", record, "universe");
    assertArrayField("spotMeta", record, "tokens");
    return record as unknown as HyperliquidSpotMeta;
  }

  async spotInstruments(): Promise<HyperliquidSpotAsset[]> {
    return (await this.spotMeta()).universe;
  }

  async metaAndAssetContexts(dex?: string): Promise<[HyperliquidMeta, Array<Record<string, unknown>>]> {
    const normalizedDex = normalizeOptionalIdentifier("dex", dex);
    const data = await this.info<unknown>({ type: "metaAndAssetCtxs", ...(normalizedDex ? { dex: normalizedDex } : {}) });
    if (!Array.isArray(data) || data.length !== 2) throw contractError("metaAndAssetCtxs", "expected [meta, contexts]", data);
    const meta = assertRecord("metaAndAssetCtxs", data[0]);
    assertArrayField("metaAndAssetCtxs", meta, "universe");
    if (!Array.isArray(data[1])) throw contractError("metaAndAssetCtxs", "expected contexts array", data);
    return data as [HyperliquidMeta, Array<Record<string, unknown>>];
  }

  async allMids(dex?: string): Promise<Record<string, string>> {
    const normalizedDex = normalizeOptionalIdentifier("dex", dex);
    const data = await this.info<unknown>({ type: "allMids", ...(normalizedDex ? { dex: normalizedDex } : {}) });
    const record = assertRecord("allMids", data);
    if (Object.keys(record).length === 0 || Object.values(record).some((value) => typeof value !== "string")) {
      throw contractError("allMids", "expected string price values", data);
    }
    return record as Record<string, string>;
  }

  candles(
    coin: string,
    interval: HyperliquidInterval,
    options: { startTime?: number; endTime?: number } = {},
  ): Promise<HyperliquidCandle[]> {
    const normalizedCoin = normalizeIdentifier("coin", coin);
    const endTime = options.endTime ?? Date.now();
    const startTime = options.startTime ?? endTime - 24 * 60 * 60 * 1_000;
    if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || startTime >= endTime) {
      throw new RangeError("Hyperliquid candle startTime and endTime must be valid epoch milliseconds with startTime < endTime");
    }
    return this.info<unknown>({ type: "candleSnapshot", req: { coin: normalizedCoin, interval, startTime, endTime } })
      .then((data) => validateCandles(data));
  }

  l2Book(coin: string, options: { nSigFigs?: 2 | 3 | 4 | 5 | null; mantissa?: 1 | 2 | 5 } = {}): Promise<HyperliquidL2Book> {
    const normalizedCoin = normalizeIdentifier("coin", coin);
    if (options.mantissa !== undefined && options.nSigFigs !== 5) {
      throw new RangeError("Hyperliquid mantissa is only valid when nSigFigs is 5");
    }
    return this.info<unknown>({ type: "l2Book", coin: normalizedCoin, ...options }).then((data) => {
      const record = assertRecord("l2Book", data);
      if (typeof record.coin !== "string" || typeof record.time !== "number") {
        throw contractError("l2Book", "expected coin and time", data);
      }
      if (!Array.isArray(record.levels) || record.levels.length !== 2 || record.levels.some((side) => !Array.isArray(side))) {
        throw contractError("l2Book", "expected two book-level arrays", data);
      }
      return record as unknown as HyperliquidL2Book;
    });
  }

  recentTrades(coin: string): Promise<Array<Record<string, unknown>>> {
    const normalizedCoin = normalizeIdentifier("coin", coin);
    return this.info<unknown>({ type: "recentTrades", coin: normalizedCoin }).then((data) => {
      if (!Array.isArray(data)) throw contractError("recentTrades", "expected an array", data);
      for (const item of data) {
        const trade = assertRecord("recentTrades", item);
        if (typeof trade.coin !== "string" || typeof trade.px !== "string" || typeof trade.sz !== "string" || typeof trade.time !== "number") {
          throw contractError("recentTrades", "expected coin, px, sz, and time", data);
        }
      }
      return data as Array<Record<string, unknown>>;
    });
  }
}

function validateCandles(data: unknown): HyperliquidCandle[] {
  if (!Array.isArray(data)) throw contractError("candleSnapshot", "expected an array", data);
  for (const item of data) {
    const candle = assertRecord("candleSnapshot", item);
    for (const field of ["s", "i", "o", "h", "l", "c", "v"] as const) {
      if (typeof candle[field] !== "string") throw contractError("candleSnapshot", `expected string ${field}`, data);
    }
    for (const field of ["t", "T", "n"] as const) {
      if (typeof candle[field] !== "number") throw contractError("candleSnapshot", `expected number ${field}`, data);
    }
  }
  return data as HyperliquidCandle[];
}

function assertRecord(type: string, data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw contractError(type, "expected an object", data);
  return data as Record<string, unknown>;
}

function assertArrayField(type: string, record: Record<string, unknown>, field: string): void {
  if (!Array.isArray(record[field])) throw contractError(type, `expected ${field} array`, record);
}

function contractError(type: string, detail: string, data: unknown): OmniContractError {
  const route = `hyperliquid:/info:${type}`;
  return new OmniContractError(`Invalid Hyperliquid ${type} response: ${detail}`, route, data);
}

function normalizeIdentifier(name: string, value: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 64) throw new RangeError(`${name} must contain 1 to 64 characters`);
  return normalized;
}

function normalizeOptionalIdentifier(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeIdentifier(name, value);
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 10_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 10_000));
  }
  return Math.min(250 * 2 ** attempt, 2_000);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDone = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      onDone();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      onDone();
      reject(signal?.reason);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
