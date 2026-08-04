import assert from "node:assert/strict";
import test from "node:test";
import { readTestnetExecutionConfig } from "../src/config.js";
import { HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";

const enabled = process.env.RUN_TESTNET_ORDERS === "true";

test("funded testnet account places, observes, and cancels a capped ALO order", {
  skip: enabled ? false : "Set the documented testnet gates and a funded testnet key to run this lifecycle",
}, async () => {
  const config = readTestnetExecutionConfig();
  const executor = new HyperliquidTestnetExecutor();
  const result = await executor.run({
    confidence: 1,
    maxNotionalUsd: config.maxNotionalUsd,
    rationale: ["funded testnet lifecycle"],
    side: "BUY",
    symbol: config.symbol,
  }, config);
  if (result.mode !== "testnet") throw new Error(`Expected testnet execution, received ${result.mode}`);
  assert.equal(result.cancelled, true);
});
