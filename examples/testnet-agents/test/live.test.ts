import assert from "node:assert/strict";
import test from "node:test";
import { TESTNET_API_URL } from "@nktkas/hyperliquid";
import { readTestnetExecutionConfig } from "../src/config.js";
import { HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";
import { meanReversionIntent, momentumIntent } from "../src/strategies.js";

test("agents read live Hyperliquid testnet markets and create guarded dry-run decisions", async () => {
  const config = readTestnetExecutionConfig({ TESTNET_SYMBOL: "BTC" });
  const testnet = new HyperliquidTestnetExecutor();
  assert.equal(String(testnet.transport.apiUrl), TESTNET_API_URL);
  const [market, candles] = await Promise.all([
    testnet.market(config.symbol),
    testnet.candles(config.symbol, "15m"),
  ]);
  assert.equal(market.symbol, "BTC");
  assert.ok(market.midPrice > 0);
  assert.ok(candles.length >= 12);

  for (const intent of [
    momentumIntent(config.symbol, candles.slice(-8), config.maxNotionalUsd),
    meanReversionIntent(config.symbol, candles.slice(-12), config.maxNotionalUsd),
  ]) {
    const result = await testnet.run(intent, config);
    assert.ok(result.mode === "hold" || result.mode === "dry-run");
    if (result.mode === "dry-run") {
      assert.equal(result.plan.network, "hyperliquid-testnet");
      assert.ok(result.plan.notionalUsd <= config.maxNotionalUsd);
    }
  }
});
