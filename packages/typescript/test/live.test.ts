import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidPublicClient, HyperliquidWebSocketClient, OmniClient, OmniMcpClient } from "../src/index.js";

test("Omni health and direct Hyperliquid public REST are live", async () => {
  const client = new OmniClient({ baseUrl: process.env.OMNI_API_URL });
  const health = await client.health();
  assert.match(health.status, /ok|running|ready/i);
  const hyperliquid = new HyperliquidPublicClient({ baseUrl: process.env.HYPERLIQUID_API_URL });
  const instruments = await hyperliquid.perpetuals();
  assert.ok(instruments.some((asset) => asset.name === "BTC"));
  const spot = await hyperliquid.spotInstruments();
  assert.ok(spot.length > 0);
  const contexts = await hyperliquid.metaAndAssetContexts();
  assert.ok(contexts[0].universe.length > 0);
  assert.ok(contexts[1].length > 0);
  const mids = await hyperliquid.allMids();
  assert.equal(typeof mids.BTC, "string");
  const candles = await hyperliquid.candles("BTC", "1h");
  assert.ok(candles.length > 0);
  const book = await hyperliquid.l2Book("BTC");
  assert.equal(book.levels.length, 2);
  const trades = await hyperliquid.recentTrades("BTC");
  assert.ok(trades.length > 0);
});

test("x402 MCP initializes and serves the free catalog", async () => {
  const client = await new OmniMcpClient({ url: process.env.OMNI_MCP_URL }).connect();
  try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    for (const expected of [
      "get_market_catalog",
      "get_market_moving_events",
      "get_market_risk_context",
      "resolve_market_entities",
      "get_market_carry",
    ]) assert.ok(names.has(expected), `MCP tool missing: ${expected}`);
    const result = await client.catalogData();
    assert.equal(result.payment, null);
    assert.equal(result.data.service, "omni-market-intelligence");
    assert.equal(result.data.tools.length, 4);
  } finally {
    await client.close();
  }
});

test("published OpenAPI contracts retain the SDK route boundary", async () => {
  const base = process.env.OMNI_APP_URL ?? "https://omniterminal.app";
  const [restResponse, x402Response] = await Promise.all([
    fetch(new URL("/openapi.yaml", base)),
    fetch(new URL("/openapi-x402.yaml", base)),
  ]);
  assert.equal(restResponse.status, 200);
  assert.equal(x402Response.status, 200);
  const rest = await restResponse.text();
  const x402 = await x402Response.text();

  for (const path of [
    "/health",
    "/api/v1/news/health",
    "/api/v1/news",
    "/api/v1/news/{symbol}",
    "/api/v1/news/ws-ticket",
    "/api/v1/ask-omni",
    "/api/hl/public-profile",
    "/integrations/defillama/v1/builder-fees",
  ]) assert.ok(rest.includes(`  ${path}:`), `REST contract missing: ${path}`);

  // These published terminal routes intentionally remain outside OmniClient;
  // equivalent commodity market data is sourced from Hyperliquid directly.
  for (const path of [
    "/terminal/instruments",
    "/terminal/market/candles/{exchange}/{symbol}",
    "/terminal/news",
    "/terminal/news/{symbol}",
  ]) assert.ok(rest.includes(`  ${path}:`), `published terminal contract missing: ${path}`);

  for (const path of [
    "/api/x402/v1/news/health",
    "/api/x402/v1/trader-profile/health",
    "/api/x402/v1/news/{symbol}",
    "/api/x402/v1/news",
    "/api/x402/v1/trader-profile/{address}",
    "/api/x402/v1/liquidations/{symbol}",
    "/api/x402/v1/traders/{symbol}",
    "/api/x402/v1/market-risk/{symbol}",
    "/api/x402/v1/market-snapshot/{symbol}",
    "/api/x402/v1/symbols/resolve",
    "/api/x402/v1/market-carry/{symbol}",
  ]) assert.ok(x402.includes(`  ${path}:`), `x402 contract missing: ${path}`);
});

test("direct Hyperliquid public WebSocket yields a live trade frame", async () => {
  const client = new HyperliquidWebSocketClient({ baseUrl: process.env.HYPERLIQUID_WS_URL });
  const iterator = client.trades("BTC")[Symbol.asyncIterator]();
  try {
    const event = await withTimeout(iterator.next(), 10_000, "WebSocket frame timeout");
    assert.equal(event.done, false);
    assert.ok(event.value.receivedAt > 0);
  } finally {
    await iterator.return?.();
  }
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

test("all nine paid x402 routes publish a payment challenge", async () => {
  const base = process.env.OMNI_APP_URL ?? "https://omniterminal.app";
  const address = "0x0ddf9bae2af4b874b96d287a5ad42eb47138a902";
  const targets: Array<[string, RequestInit?]> = [
    ["/api/x402/v1/news/BTC"],
    ["/api/x402/v1/news?market=crypto"],
    [`/api/x402/v1/trader-profile/${address}`],
    ["/api/x402/v1/liquidations/BTC"],
    ["/api/x402/v1/traders/BTC"],
    ["/api/x402/v1/market-risk/BTC"],
    ["/api/x402/v1/market-snapshot/BTC?limit=20"],
    ["/api/x402/v1/symbols/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mentions: ["bitcoin"] }) }],
    ["/api/x402/v1/market-carry/BTC"],
  ];
  for (const [path, init] of targets) {
    const response = await fetch(new URL(path, base), init);
    assert.equal(response.status, 402, path);
    assert.ok(response.headers.has("payment-required"), `${path} omitted PAYMENT-REQUIRED`);
  }
});
