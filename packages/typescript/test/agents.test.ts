import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { CoinbaseAdvancedTradeClient, RobinhoodCryptoClient } from "../src/brokers/index.js";
import { readBrokerAgentConfig } from "../examples/agents/config.js";
import { readAgentResearchConfig } from "../examples/agents/research.js";

test("agent settings enforce bounded notional and broker-specific live confirmations", () => {
  assert.deepEqual(readBrokerAgentConfig("coinbase", {}), {
    liveTrading: false,
    maxNotionalUsd: 25,
    symbol: "BTC",
  });
  assert.throws(() => readBrokerAgentConfig("coinbase", {
    LIVE_TRADING: "true",
  }), /COINBASE_LIVE_ORDER/);
  assert.throws(() => readBrokerAgentConfig("robinhood", {
    LIVE_TRADING: "true",
    CONFIRM_LIVE_ORDER: "COINBASE_LIVE_ORDER",
  }), /ROBINHOOD_LIVE_ORDER/);
  assert.throws(() => readBrokerAgentConfig("coinbase", {
    MAX_ORDER_NOTIONAL_USD: "101",
  }), /at most 100/);
  assert.throws(() => readBrokerAgentConfig("coinbase", {
    TRADING_SYMBOL: "DOGE",
  }), /BTC, ETH, SOL, or HYPE/);
});

test("agent research requires explicit paid opt-in, a valid buyer key, and a one-cent ceiling", () => {
  assert.throws(() => readAgentResearchConfig({}), /RUN_PAID_RESEARCH=true/);
  assert.throws(() => readAgentResearchConfig({
    RUN_PAID_RESEARCH: "true",
  }), /EVM_PRIVATE_KEY/);
  assert.throws(() => readAgentResearchConfig({
    RUN_PAID_RESEARCH: "true",
    EVM_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    X402_MAX_PAYMENT_USD: "0.02",
  }), /at most 0.01/);
  assert.equal(readAgentResearchConfig({
    RUN_PAID_RESEARCH: "true",
    EVM_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    OMNI_RESEARCH_TRANSPORT: "mcp",
  }).transport, "mcp");
});

test("Coinbase dry-run authenticates only the preview and never creates an order", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const calls: string[] = [];
  const client = new CoinbaseAdvancedTradeClient({
    apiKey: "organizations/test/apiKeys/test",
    apiSecret: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    fetch: async (input) => {
      calls.push(new URL(String(input)).pathname);
      return Response.json({ errs: [], preview_id: "preview-1" });
    },
  });
  const result = await client.submitMarketOrder("BTC-USD", "BUY", 10);
  assert.equal(result.dryRun, true);
  assert.deepEqual(calls, ["/api/v3/brokerage/orders/preview"]);
});

test("Robinhood dry-run returns the exact v2 order plan without any network call", async () => {
  let fetchCalls = 0;
  const client = new RobinhoodCryptoClient({
    apiKey: "rh-api-test",
    privateKey: "xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=",
    accountNumber: "test-account",
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("dry-run must not call Robinhood");
    },
  });
  const result = await client.submitMarketOrder("BTC-USD", "buy", 10);
  assert.equal(result.dryRun, true);
  assert.equal(result.path, "/api/v2/crypto/trading/orders/?account_number=test-account");
  assert.equal(fetchCalls, 0);
});
