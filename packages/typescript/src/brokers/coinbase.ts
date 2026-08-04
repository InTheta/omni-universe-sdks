import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { randomUUID } from "node:crypto";
import { TradingGateError } from "../errors.js";
import { mergeSignals, parseResponse } from "../http.js";
import type { OrderSide } from "../types.js";

export interface CoinbaseClientOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  liveTrading?: boolean;
  maxOrderNotionalUsd?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface CoinbaseOrderPreview extends Record<string, unknown> {
  errs: unknown[];
  preview_id?: string;
}

export class CoinbaseAdvancedTradeClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: URL;
  private readonly liveTrading: boolean;
  private readonly maxOrderNotionalUsd: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: CoinbaseClientOptions) {
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret.replaceAll("\\n", "\n");
    this.baseUrl = new URL(options.baseUrl ?? "https://api.coinbase.com");
    this.liveTrading = options.liveTrading ?? false;
    this.maxOrderNotionalUsd = options.maxOrderNotionalUsd ?? 25;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.apiKey || !this.apiSecret) throw new TradingGateError("Coinbase API key and secret are required");
    if (!Number.isFinite(this.maxOrderNotionalUsd) || this.maxOrderNotionalUsd <= 0) throw new TradingGateError("maxOrderNotionalUsd must be positive");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TradingGateError("timeoutMs must be positive");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await generateJwt({
      apiKeyId: this.apiKey,
      apiKeySecret: this.apiSecret,
      requestMethod: method,
      requestHost: this.baseUrl.host,
      requestPath: path,
      expiresIn: 120,
    });
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: mergeSignals(this.timeoutMs),
    });
    return parseResponse<T>(response);
  }

  async previewMarketOrder(productId: string, side: OrderSide, quoteSizeUsd: number): Promise<CoinbaseOrderPreview> {
    this.assertNotional(quoteSizeUsd);
    const body = await this.marketOrderBody(productId, side, quoteSizeUsd);
    return this.previewOrderBody(body);
  }

  async submitMarketOrder(productId: string, side: OrderSide, quoteSizeUsd: number): Promise<Record<string, unknown>> {
    this.assertNotional(quoteSizeUsd);
    const body = await this.marketOrderBody(productId, side, quoteSizeUsd);
    const preview = await this.previewOrderBody(body);
    if (!Array.isArray(preview.errs)) throw new TradingGateError("Coinbase returned a malformed order preview without errs");
    if (!this.liveTrading) return { dryRun: true, preview, proposedOrder: body };
    const errors = preview.errs.filter(Boolean);
    if (errors.length) throw new TradingGateError(`Coinbase rejected the order preview: ${errors.join(", ")}`);
    if (typeof preview.preview_id !== "string" || !preview.preview_id) {
      throw new TradingGateError("Coinbase returned an order preview without preview_id");
    }
    return this.request("POST", "/api/v3/brokerage/orders", {
      client_order_id: randomUUID(),
      preview_id: preview.preview_id,
      ...body,
    });
  }

  private previewOrderBody(body: Record<string, unknown>): Promise<CoinbaseOrderPreview> {
    return this.request("POST", "/api/v3/brokerage/orders/preview", body);
  }

  private async marketOrderBody(productId: string, side: OrderSide, quoteSizeUsd: number) {
    if (side === "BUY") {
      return {
        product_id: productId,
        side,
        order_configuration: { market_market_ioc: { quote_size: quoteSizeUsd.toFixed(2) } },
      };
    }
    const product = await this.request<{ price: string; base_increment?: string }>(
      "GET",
      `/api/v3/brokerage/market/products/${encodeURIComponent(productId)}`,
    );
    const price = Number(product.price);
    const increment = Number(product.base_increment ?? "0.00000001");
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(increment) || increment <= 0) {
      throw new TradingGateError("Coinbase returned an invalid product price or base increment");
    }
    const baseSize = Math.floor((quoteSizeUsd / price) / increment) * increment;
    if (baseSize <= 0) throw new TradingGateError("Calculated Coinbase base size is below the product increment");
    const decimals = Math.max(0, (product.base_increment ?? "0.00000001").split(".")[1]?.length ?? 0);
    return {
      product_id: productId,
      side,
      order_configuration: { market_market_ioc: { base_size: baseSize.toFixed(decimals) } },
    };
  }

  private assertNotional(value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new TradingGateError("Order notional must be positive");
    if (value > this.maxOrderNotionalUsd) {
      throw new TradingGateError(`Order notional $${value} exceeds the configured $${this.maxOrderNotionalUsd} limit`);
    }
  }
}
