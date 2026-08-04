import assert from "node:assert/strict";
import test from "node:test";
import { ExchangeClient } from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HyperliquidTestnetExecutor, createOrderPlan } from "../src/hyperliquid-testnet.js";

test("an ephemeral wallet signs a valid testnet order request that is rejected as an unfunded account", async () => {
  const testnet = new HyperliquidTestnetExecutor();
  const market = await testnet.market("BTC");
  const plan = createOrderPlan({
    confidence: 1,
    maxNotionalUsd: 15,
    rationale: ["signed contract probe"],
    side: "BUY",
    symbol: "BTC",
  }, market, { maxNotionalUsd: 15, orderOffsetBps: 300 });
  const wallet = privateKeyToAccount(generatePrivateKey());
  const exchange = new ExchangeClient({ transport: testnet.transport, wallet });
  await assert.rejects(exchange.order({
    orders: [{
      a: plan.asset,
      b: plan.isBuy,
      p: plan.price,
      s: plan.size,
      r: false,
      t: { limit: { tif: "Alo" } },
    }],
    grouping: "na",
  }), (error: unknown) => {
    assert.doesNotMatch(String(error), /signature|invalid nonce/i);
    assert.match(String(error), /margin|collateral|account|does not exist/i);
    return true;
  });
});
