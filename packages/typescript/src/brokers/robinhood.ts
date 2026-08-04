import { randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import { TradingGateError } from "../errors.js";
import { mergeSignals, parseResponse } from "../http.js";

export interface RobinhoodClientOptions {
  apiKey: string;
  privateKey: string;
  accountNumber: string;
  baseUrl?: string;
  liveTrading?: boolean;
  maxOrderNotionalUsd?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class RobinhoodCryptoClient {
  private readonly apiKey: string;
  private readonly privateKey: Uint8Array;
  private readonly accountNumber: string;
  private readonly baseUrl: URL;
  private readonly liveTrading: boolean;
  private readonly maxOrderNotionalUsd: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: RobinhoodClientOptions) {
    this.apiKey = options.apiKey;
    this.privateKey = Buffer.from(options.privateKey, "base64");
    if (this.privateKey.length !== 32) throw new TradingGateError("Robinhood private key must be a base64-encoded 32-byte Ed25519 seed");
    this.accountNumber = options.accountNumber;
    this.baseUrl = new URL(options.baseUrl ?? "https://trading.robinhood.com");
    this.liveTrading = options.liveTrading ?? false;
    this.maxOrderNotionalUsd = options.maxOrderNotionalUsd ?? 25;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.apiKey || !this.accountNumber) throw new TradingGateError("Robinhood API key and account number are required");
    if (!Number.isFinite(this.maxOrderNotionalUsd) || this.maxOrderNotionalUsd <= 0) throw new TradingGateError("maxOrderNotionalUsd must be positive");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TradingGateError("timeoutMs must be positive");
  }

  async request<T>(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const serializedBody = body === undefined ? "" : JSON.stringify(body);
    const signature = signRobinhoodRequest(this.apiKey, this.privateKey, timestamp, pathWithQuery, method, serializedBody);
    const response = await this.fetcher(new URL(pathWithQuery, this.baseUrl), {
      method,
      headers: {
        "x-api-key": this.apiKey,
        "x-timestamp": timestamp,
        "x-signature": signature,
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
      },
      body: body === undefined ? undefined : serializedBody,
      signal: mergeSignals(this.timeoutMs),
    });
    return parseResponse<T>(response);
  }

  account(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/v1/crypto/trading/accounts/");
  }

  async submitMarketOrder(symbol: string, side: "buy" | "sell", quoteAmountUsd: number): Promise<Record<string, unknown>> {
    this.assertNotional(quoteAmountUsd);
    const body = {
      symbol,
      client_order_id: randomUUID(),
      side,
      type: "market",
      market_order_config: { quote_amount: quoteAmountUsd.toFixed(2) },
    };
    const path = `/api/v2/crypto/trading/orders/?account_number=${encodeURIComponent(this.accountNumber)}`;
    if (!this.liveTrading) return { dryRun: true, path, proposedOrder: body };
    return this.request("POST", path, body);
  }

  private assertNotional(value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new TradingGateError("Order notional must be positive");
    if (value > this.maxOrderNotionalUsd) {
      throw new TradingGateError(`Order notional $${value} exceeds the configured $${this.maxOrderNotionalUsd} limit`);
    }
  }
}

export function signRobinhoodRequest(
  apiKey: string,
  privateKey: string | Uint8Array,
  timestamp: string,
  path: string,
  method: string,
  body = "",
): string {
  const seed = typeof privateKey === "string" ? Buffer.from(privateKey, "base64") : privateKey;
  if (seed.length !== 32) throw new TradingGateError("Robinhood private key must be a base64-encoded 32-byte Ed25519 seed");
  const message = `${apiKey}${timestamp}${path}${method}${body}`;
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  return Buffer.from(nacl.sign.detached(Buffer.from(message), keyPair.secretKey)).toString("base64");
}
