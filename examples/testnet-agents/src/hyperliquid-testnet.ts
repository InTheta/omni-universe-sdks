import { ExchangeClient, HttpTransport, InfoClient, TESTNET_API_URL } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";
import {
  HARD_MAX_TESTNET_NOTIONAL_USD,
  MIN_TESTNET_NOTIONAL_USD,
  type TestnetExecutionConfig,
} from "./config.js";
import type { AgentIntent } from "./strategies.js";

export interface TestnetMarketSnapshot {
  asset: number;
  midPrice: number;
  symbol: string;
  szDecimals: number;
}

export interface TestnetOrderPlan {
  asset: number;
  isBuy: boolean;
  network: "hyperliquid-testnet";
  notionalUsd: number;
  price: string;
  reduceOnly: false;
  size: string;
  symbol: string;
  tif: "Alo";
}

export type TestnetExecutionResult =
  | { mode: "hold"; intent: AgentIntent }
  | { mode: "dry-run"; intent: AgentIntent; plan: TestnetOrderPlan }
  | { mode: "testnet"; intent: AgentIntent; plan: TestnetOrderPlan; orderId: number; cancelled: true };

export class HyperliquidTestnetExecutor {
  readonly transport = new HttpTransport({ isTestnet: true, timeout: 10_000 });
  readonly info = new InfoClient({ transport: this.transport });

  constructor() {
    assertTestnetTransport(this.transport);
  }

  async candles(symbol: string, interval: "5m" | "15m" | "1h" = "15m", lookbackMs = 24 * 60 * 60 * 1_000) {
    return this.info.candleSnapshot({ coin: symbol, interval, startTime: Date.now() - lookbackMs });
  }

  async market(symbol: string): Promise<TestnetMarketSnapshot> {
    const [meta, contexts] = await this.info.metaAndAssetCtxs();
    const asset = meta.universe.findIndex((entry) => entry.name === symbol && entry.isDelisted !== true);
    if (asset < 0) throw new Error(`Hyperliquid testnet market is unavailable: ${symbol}`);
    const metadata = meta.universe[asset];
    const context = contexts[asset];
    const midPrice = Number(context?.midPx ?? context?.markPx);
    if (!metadata || !Number.isFinite(midPrice) || midPrice <= 0) {
      throw new Error(`Hyperliquid testnet market has no valid midpoint: ${symbol}`);
    }
    return { asset, midPrice, symbol, szDecimals: metadata.szDecimals };
  }

  async run(intent: AgentIntent, config: TestnetExecutionConfig): Promise<TestnetExecutionResult> {
    if (intent.side === "HOLD") return { mode: "hold", intent };
    if (!Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 1) {
      throw new RangeError("Agent confidence must be between zero and one");
    }
    if (intent.confidence < config.minConfidence) {
      return {
        mode: "hold",
        intent: {
          ...intent,
          rationale: [...intent.rationale, `below_min_confidence=${config.minConfidence.toFixed(4)}`],
          side: "HOLD",
        },
      };
    }
    const plan = createOrderPlan(intent, await this.market(intent.symbol), config);
    if (!config.enabled) return { mode: "dry-run", intent, plan };
    return this.placeAndCancel(intent, plan, config);
  }

  private async placeAndCancel(
    intent: AgentIntent,
    plan: TestnetOrderPlan,
    config: TestnetExecutionConfig,
  ): Promise<TestnetExecutionResult> {
    assertTestnetTransport(this.transport);
    if (!config.privateKey) throw new Error("A Hyperliquid testnet private key is required");
    const wallet = privateKeyToAccount(config.privateKey);
    const accountAddress = config.accountAddress ?? wallet.address;
    const state = await this.info.clearinghouseState({ user: accountAddress });
    if (Number(state.withdrawable) <= 0) {
      throw new Error(`Hyperliquid testnet account has no withdrawable collateral: ${accountAddress}`);
    }

    const exchange = new ExchangeClient({
      transport: this.transport,
      wallet,
      defaultExpiresAfter: () => Date.now() + 30_000,
    });
    let orderId: number | undefined;
    let cancelled = false;
    try {
      const placed = await exchange.order({
        orders: [{
          a: plan.asset,
          b: plan.isBuy,
          p: plan.price,
          s: plan.size,
          r: plan.reduceOnly,
          t: { limit: { tif: plan.tif } },
        }],
        grouping: "na",
      });
      const status = placed.response.data.statuses[0];
      if (!status || typeof status !== "object" || !("resting" in status)) {
        throw new Error(`Expected a resting ALO testnet order, received: ${JSON.stringify(status)}`);
      }
      orderId = status.resting.oid;
      const cancellation = await exchange.cancel({ cancels: [{ a: plan.asset, o: orderId }] });
      if (cancellation.response.data.statuses[0] !== "success") {
        throw new Error(`Testnet cancellation failed: ${JSON.stringify(cancellation.response.data.statuses[0])}`);
      }
      await waitForOrderClosed(() => this.info.openOrders({ user: accountAddress }), orderId);
      cancelled = true;
      return { cancelled: true, intent, mode: "testnet", orderId, plan };
    } finally {
      if (orderId !== undefined && !cancelled) {
        await exchange.cancel({ cancels: [{ a: plan.asset, o: orderId }] }).catch(() => undefined);
      }
    }
  }
}

export function createOrderPlan(
  intent: AgentIntent,
  market: TestnetMarketSnapshot,
  config: Pick<TestnetExecutionConfig, "maxNotionalUsd" | "orderOffsetBps">,
): TestnetOrderPlan {
  if (intent.side === "HOLD") throw new Error("A HOLD intent cannot create an order");
  if (intent.symbol !== market.symbol) {
    throw new Error(`Intent symbol ${intent.symbol} does not match market symbol ${market.symbol}`);
  }
  if (!Number.isInteger(market.asset) || market.asset < 0) {
    throw new RangeError("Market asset ID must be a non-negative integer");
  }
  if (!Number.isFinite(market.midPrice) || market.midPrice <= 0) {
    throw new RangeError("Market midpoint must be a positive finite number");
  }
  if (!Number.isInteger(market.szDecimals) || market.szDecimals < 0 || market.szDecimals > 8) {
    throw new RangeError("Market size decimals must be an integer between zero and eight");
  }
  const requestedNotional = Math.min(intent.maxNotionalUsd, config.maxNotionalUsd);
  if (
    !Number.isFinite(requestedNotional)
    || requestedNotional < MIN_TESTNET_NOTIONAL_USD
    || requestedNotional > HARD_MAX_TESTNET_NOTIONAL_USD
  ) {
    throw new RangeError(
      `Order notional must be between ${MIN_TESTNET_NOTIONAL_USD} and ${HARD_MAX_TESTNET_NOTIONAL_USD}`,
    );
  }
  if (!Number.isInteger(config.orderOffsetBps) || config.orderOffsetBps < 50 || config.orderOffsetBps > 500) {
    throw new RangeError("Order offset must be an integer between 50 and 500 basis points");
  }

  const isBuy = intent.side === "BUY";
  const multiplier = 1 + (isBuy ? -1 : 1) * config.orderOffsetBps / 10_000;
  const price = formatPrice(market.midPrice * multiplier, market.szDecimals);
  const size = formatSize(requestedNotional / Number(price), market.szDecimals);
  const notionalUsd = Number(price) * Number(size);
  if (
    !Number.isFinite(notionalUsd)
    || notionalUsd < MIN_TESTNET_NOTIONAL_USD
    || notionalUsd > requestedNotional + 1e-9
  ) {
    throw new RangeError(
      `Formatted order notional must be between ${MIN_TESTNET_NOTIONAL_USD} and ${requestedNotional} USD`,
    );
  }
  return {
    asset: market.asset,
    isBuy,
    network: "hyperliquid-testnet",
    notionalUsd,
    price,
    reduceOnly: false,
    size,
    symbol: market.symbol,
    tif: "Alo",
  };
}

export function assertTestnetTransport(transport: Pick<HttpTransport, "apiUrl" | "isTestnet">): void {
  const url = new URL(String(transport.apiUrl));
  if (
    !transport.isTestnet
    || url.origin !== TESTNET_API_URL
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || url.username !== ""
    || url.password !== ""
  ) {
    throw new Error(`Refusing non-testnet Hyperliquid transport: ${url.href}`);
  }
}

export async function waitForOrderClosed(
  fetchOpenOrders: () => Promise<readonly { oid: number }[]>,
  orderId: number,
  options: {
    attempts?: number;
    intervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<void> {
  const attempts = options.attempts ?? 8;
  const intervalMs = options.intervalMs ?? 250;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new RangeError("Cancellation verification attempts must be an integer between one and twenty");
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 5_000) {
    throw new RangeError("Cancellation verification interval must be an integer between zero and 5000 milliseconds");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const openOrders = await fetchOpenOrders();
    if (!openOrders.some((order) => order.oid === orderId)) return;
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw new Error(`Testnet order ${orderId} remained open after ${attempts} cancellation checks`);
}
