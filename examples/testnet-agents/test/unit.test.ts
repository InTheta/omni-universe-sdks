import assert from "node:assert/strict";
import test from "node:test";
import { HttpTransport } from "@nktkas/hyperliquid";
import { readTestnetExecutionConfig, TESTNET_ORDER_CONFIRMATION } from "../src/config.js";
import { assertTestnetTransport, createOrderPlan, HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";
import { loadOmniMarketRisk } from "../src/omni-research.js";
import { meanReversionIntent, momentumIntent } from "../src/strategies.js";

test("momentum and mean-reversion strategies produce deterministic opposing signals", () => {
  const rising = [100, 101, 102, 103, 104, 105].map((c) => ({ c: String(c) }));
  assert.equal(momentumIntent("BTC", rising, 15).side, "BUY");
  assert.equal(meanReversionIntent("BTC", rising, 15).side, "SELL");
});

test("testnet configuration defaults to dry-run and requires two explicit live gates", () => {
  const defaults = readTestnetExecutionConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.maxNotionalUsd, 15);
  assert.equal(defaults.minConfidence, 0.55);
  assert.throws(() => readTestnetExecutionConfig({ RUN_TESTNET_ORDERS: "true" }), /CONFIRM_TESTNET_ORDER/);
  assert.throws(() => readTestnetExecutionConfig({
    RUN_TESTNET_ORDERS: "true",
    CONFIRM_TESTNET_ORDER: TESTNET_ORDER_CONFIRMATION,
  }), /HL_TESTNET_PRIVATE_KEY/);
});

test("low-confidence directional signals are converted to HOLD before market lookup", async () => {
  const config = readTestnetExecutionConfig({ TESTNET_MIN_CONFIDENCE: "0.8" });
  const executor = new HyperliquidTestnetExecutor();
  const result = await executor.run({
    confidence: 0.5,
    maxNotionalUsd: 15,
    rationale: ["weak signal"],
    side: "BUY",
    symbol: "BTC",
  }, config);
  assert.equal(result.mode, "hold");
  assert.equal(result.intent.side, "HOLD");
});

test("executor refuses mainnet and order plans enforce the hard notional cap", () => {
  assert.throws(() => assertTestnetTransport(new HttpTransport()), /Refusing non-testnet/);
  const intent = momentumIntent("BTC", [100, 101, 102, 103].map((c) => ({ c: String(c) })), 15);
  const plan = createOrderPlan(intent, { asset: 0, midPrice: 60_000, symbol: "BTC", szDecimals: 5 }, {
    maxNotionalUsd: 15,
    orderOffsetBps: 200,
  });
  assert.equal(plan.network, "hyperliquid-testnet");
  assert.equal(plan.tif, "Alo");
  assert.ok(plan.notionalUsd <= 15);
  assert.throws(() => createOrderPlan({ ...intent, maxNotionalUsd: 26 }, {
    asset: 0,
    midPrice: 60_000,
    symbol: "BTC",
    szDecimals: 5,
  }, { maxNotionalUsd: 26, orderOffsetBps: 200 }), /between 10 and 25/);
});

test("Omni research cannot purchase without the explicit paid-research gate", async () => {
  await assert.rejects(loadOmniMarketRisk("BTC", {}), /RUN_PAID_RESEARCH=true/);
});
