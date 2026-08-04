import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import WebSocket from "ws";
import { encodePaymentResponseHeader } from "@x402/core/http";
import {
  createEvmPaymentClient,
  decideFromMarketRisk,
  HyperliquidPublicClient,
  HyperliquidWebSocketClient,
  OmniApiError,
  OmniClient,
  OmniContractError,
  OmniMcpClient,
  OmniWebSocketClient,
  OmniX402Client,
  usdToUsdcAtomic,
  validateMcpToolArguments,
  parseMcpToolJson,
  validateMcpToolResult,
} from "../src/index.js";
import { CoinbaseAdvancedTradeClient, RobinhoodCryptoClient, signRobinhoodRequest } from "../src/brokers/index.js";
import type { MarketRisk } from "../src/types.js";

test("MCP client can use its public default endpoint without an options object", () => {
  assert.doesNotThrow(() => new OmniMcpClient());
});

test("MCP paid tool arguments are rejected and normalized before payment", () => {
  assert.deepEqual(validateMcpToolArguments("get_market_catalog"), {});
  assert.deepEqual(validateMcpToolArguments("get_market_carry", { symbol: " BTC " }), { symbol: "BTC" });
  assert.deepEqual(validateMcpToolArguments("resolve_market_entities", { mentions: [" bitcoin "] }), {
    mentions: ["bitcoin"],
    venue: "hyperliquid",
  });
  assert.throws(
    () => validateMcpToolArguments("get_market_moving_events", { limit: 21 }),
    /limit must be an integer between 1 and 20/,
  );
  assert.throws(
    () => validateMcpToolArguments("get_market_risk_context", { symbol: "BTC", extra: true }),
    /does not accept argument: extra/,
  );
  assert.throws(
    () => validateMcpToolArguments("resolve_market_entities", { mentions: [] }),
    /mentions must contain between 1 and 20/,
  );
});

test("MCP JSON helpers enforce product and settlement contracts", () => {
  const settlement = {
    success: true,
    transaction: "0xabc",
    network: "eip155:8453",
  };
  const catalog = parseMcpToolJson<{ tools: unknown[] }>("get_market_catalog", {
    content: [{ type: "text", text: JSON.stringify({ service: "omni-market-intelligence", tools: [] }) }],
    paymentMade: false,
  });
  assert.deepEqual(catalog.data.tools, []);
  assert.equal(catalog.payment, null);

  const carry = parseMcpToolJson<{ symbol: string }>("get_market_carry", {
    content: [{ type: "text", text: JSON.stringify({
      service: "omni.hyperliquid_market_carry",
      schema: "hyperliquid_market_carry.v1",
      symbol: "BTC",
    }) }],
    paymentMade: true,
    paymentResponse: settlement,
  });
  assert.equal(carry.data.symbol, "BTC");
  assert.equal(carry.payment?.transaction, "0xabc");

  assert.throws(() => validateMcpToolResult("get_market_carry", {
    content: [{ type: "text", text: "{}" }],
    paymentMade: true,
  }), /expected an object/);
  assert.throws(() => validateMcpToolResult("get_market_carry", {
    content: [{ type: "text", text: "{}" }],
    paymentMade: true,
    paymentResponse: { ...settlement, success: false },
  }), /settlement was not successful/);
  assert.throws(() => parseMcpToolJson("get_market_risk_context", {
    content: [{ type: "text", text: JSON.stringify({ service: "wrong", schema: "wrong" }) }],
    paymentMade: true,
    paymentResponse: settlement,
  }), /expected service omni.market_risk_snapshot/);
});

test("Omni client does not expose terminal candle or instrument proxy helpers", () => {
  const client = new OmniClient() as unknown as Record<string, unknown>;
  assert.equal(client.instruments, undefined);
  assert.equal(client.candles, undefined);
  assert.equal(client.terminalNews, undefined);
});

test("x402 client rejects invalid paid calls before invoking fetch", () => {
  let fetchCalls = 0;
  const client = new OmniX402Client({
    paymentClient: createEvmPaymentClient(`0x${"22".repeat(32)}` as `0x${string}`),
    fetch: async () => {
      fetchCalls++;
      throw new Error("fetch must not run");
    },
  });

  assert.throws(() => client.symbolNews("DOGE" as "BTC"), /symbol must be one of/);
  assert.throws(() => client.symbolNews("BTC", { limit: 21 }), /limit must be an integer between 1 and 20/);
  assert.throws(() => client.traderProfile("not-an-address"), /20-byte EVM address/);
  assert.throws(() => client.marketSnapshot("BTC", { limit: 19 }), /limit must be an integer between 20 and 200/);
  assert.throws(() => client.marketSnapshot("BTC", { include_liquidations: "yes" as unknown as boolean }), /include_liquidations must be a boolean/);
  assert.throws(() => client.symbolNews("BTC", { nearest_timestamp: 10_000_000_000_000 }), /13-digit Unix timestamp/);
  assert.throws(() => client.resolveSymbols([]), /mentions must contain between 1 and 20/);
  assert.throws(() => client.resolveSymbols([" "]), /mentions\[0\] must contain 1 to 100/);
  assert.equal(fetchCalls, 0);
});

test("x402 client fails closed on a mismatched paid product body", async () => {
  const client = new OmniX402Client({
    paymentClient: createEvmPaymentClient(`0x${"33".repeat(32)}` as `0x${string}`),
    fetch: async () => Response.json({ service: "unexpected", schema: "wrong" }),
  });
  await assert.rejects(client.marketCarry("BTC"), (error: unknown) => {
    assert.ok(error instanceof OmniContractError);
    assert.equal(error.route, "/api/x402/v1/market-carry/BTC");
    return true;
  });
});

test("x402 client fails closed when a paid response omits its settlement receipt", async () => {
  const client = new OmniX402Client({
    paymentClient: createEvmPaymentClient(`0x${"44".repeat(32)}` as `0x${string}`),
    fetch: async () => Response.json({
      service: "omni.hyperliquid_market_carry",
      schema: "hyperliquid_market_carry.v1",
    }),
  });
  await assert.rejects(client.marketCarry("BTC"), (error: unknown) => {
    assert.ok(error instanceof OmniContractError);
    assert.match(error.message, /Missing PAYMENT-RESPONSE/);
    return true;
  });
});

test("x402 client accepts only successful, attributable settlement receipts", async () => {
  const product = {
    service: "omni.hyperliquid_market_carry",
    schema: "hyperliquid_market_carry.v1",
  };
  const settlement = {
    success: true,
    transaction: "0xabc",
    network: "eip155:8453" as const,
  };
  let failed = false;
  const client = new OmniX402Client({
    paymentClient: createEvmPaymentClient(`0x${"55".repeat(32)}` as `0x${string}`),
    fetch: async () => Response.json(product, {
      headers: {
        "payment-response": encodePaymentResponseHeader(failed ? { ...settlement, success: false } : settlement),
      },
    }),
  });
  const result = await client.marketCarry("BTC");
  assert.equal(result.payment?.transaction, "0xabc");
  failed = true;
  await assert.rejects(client.marketCarry("BTC"), /settlement was not successful/);
});

test("successful API responses fail closed on invalid JSON or non-JSON content", async () => {
  const invalidJson = new OmniClient({
    fetch: async () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(invalidJson.health(), /invalid JSON/);

  const html = new OmniClient({
    fetch: async () => new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } }),
  });
  await assert.rejects(html.health(), /unexpected content type/);
});

test("Coinbase live submission fails closed on malformed previews and includes preview_id", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const apiSecret = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const submittedBodies: Array<Record<string, unknown>> = [];
  let malformed = true;
  const client = new CoinbaseAdvancedTradeClient({
    apiKey: "organizations/test/apiKeys/test",
    apiSecret,
    liveTrading: true,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/preview")) {
        return Response.json(malformed ? { preview_id: "preview-1" } : { errs: [], preview_id: "preview-1" });
      }
      submittedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ success: true });
    },
  });
  await assert.rejects(client.submitMarketOrder("BTC-USD", "BUY", 10), /without errs/);
  malformed = false;
  await client.submitMarketOrder("BTC-USD", "BUY", 10);
  assert.equal(submittedBodies.length, 1);
  assert.equal(submittedBodies[0]?.preview_id, "preview-1");
});

test("Omni News WebSocket queue is bounded and drops the oldest frame", async () => {
  class FakeWebSocket extends EventEmitter {
    static instances: FakeWebSocket[] = [];
    static OPEN = WebSocket.OPEN;
    readyState: number = WebSocket.OPEN;
    constructor(_url: URL) {
      super();
      FakeWebSocket.instances.push(this);
    }
    send() {}
    close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
  }

  const client = new OmniWebSocketClient({ maxQueueSize: 2, WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket });
  const iterator = client.news("ticket")[Symbol.asyncIterator]();
  const socket = FakeWebSocket.instances[0]!;
  socket.emit("message", Buffer.from(JSON.stringify({ sequence: 1 })));
  socket.emit("message", Buffer.from(JSON.stringify({ sequence: 2 })));
  socket.emit("message", Buffer.from(JSON.stringify({ sequence: 3 })));
  assert.deepEqual((await iterator.next()).value?.data, { sequence: 2 });
  assert.deepEqual((await iterator.next()).value?.data, { sequence: 3 });
  await iterator.return?.();
});

test("keyed news sends x-api-key and normalized query", async () => {
  let captured: { url?: string; key?: string | null } = {};
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    captured = { url: String(input), key: headers.get("x-api-key") };
    return Response.json({ object: "list", api_version: "test", tier: "pro", data: [], pagination: { limit: 5, has_more: false, next_before_timestamp: null } });
  };
  const client = new OmniClient({ baseUrl: "https://example.test", apiKey: "secret", fetch: fetcher });
  await client.news({ limit: 5, topics: ["macro", "crypto"] });
  assert.equal(captured.key, "secret");
  assert.match(captured.url!, /limit=5/);
  assert.match(captured.url!, /topics=macro%2Ccrypto/);
});

test("keyed REST calls reject invalid inputs before invoking fetch", async () => {
  let fetchCalls = 0;
  const client = new OmniClient({
    apiKey: "secret",
    fetch: async () => {
      fetchCalls++;
      throw new Error("fetch must not run");
    },
  });
  assert.throws(() => client.news({ limit: 0 }), /limit must be an integer between 1 and 2000/);
  assert.throws(() => client.news({ before_timestamp: 1 }), /13-digit Unix timestamp/);
  assert.throws(() => client.news({ topics: [] }), /topics must contain between 1 and 20/);
  assert.throws(() => client.newsForSymbol(" "), /symbol must contain 1 to 32/);
  assert.throws(() => client.publicProfile("not-an-address"), /20-byte EVM address/);
  assert.throws(() => client.builderFees(200, 100), /startTimestamp < endTimestamp/);
  assert.throws(() => client.builderFees(0, 367 * 24 * 60 * 60), /cannot exceed 366 days/);
  assert.throws(() => client.askOmni({}), /requires question or presetId/);
  assert.throws(() => client.askOmni({ question: "test", scopeAddress: "bad" }), /20-byte EVM address/);
  assert.equal(fetchCalls, 0);

  const missingKey = new OmniClient({ fetch: async () => { fetchCalls++; return Response.json({}); } });
  await assert.rejects(missingKey.news(), /Omni API key is required/);
  assert.equal(fetchCalls, 0);
});

test("keyed REST calls fail closed on malformed News and ticket responses", async () => {
  let ticketIsValid = false;
  const client = new OmniClient({
    apiKey: "secret",
    fetch: async (input) => {
      if (new URL(String(input)).pathname.endsWith("ws-ticket")) {
        return Response.json(ticketIsValid ? {
          ticket: "a".repeat(32),
          expires_in: 60,
          single_use: true,
          websocket_path: "/ws/v1/news",
          max_connections: 2,
          idle_timeout_seconds: 120,
          recommended_ping_interval_seconds: 60,
          max_client_message_bytes: 4096,
        } : { ticket: "short" });
      }
      return Response.json({ object: "list", api_version: "test", tier: "pro", data: [{}], pagination: { limit: 1, has_more: false } });
    },
  });
  await assert.rejects(client.news(), /Invalid News event contract/);
  await assert.rejects(client.createNewsWebSocketTicket(), /Invalid News WebSocket ticket contract/);
  ticketIsValid = true;
  assert.equal((await client.createNewsWebSocketTicket()).ticket.length, 32);
});

test("HTTP failures preserve status, request id, and details", async () => {
  const client = new OmniClient({
    apiKey: "test-key",
    fetch: async () => Response.json({ error: "bad key" }, { status: 401, headers: { "x-request-id": "req-1" } }),
  });
  await assert.rejects(client.news(), (error: unknown) => {
    assert.ok(error instanceof OmniApiError);
    assert.equal(error.status, 401);
    assert.equal(error.requestId, "req-1");
    return true;
  });
});

test("Robinhood signing primitive matches the official Ed25519 test vector", () => {
  const body = "{'client_order_id': '131de903-5a9c-4260-abc1-28d562a5dcf0', 'side': 'buy', 'symbol': 'BTC-USD', 'type': 'market', 'market_order_config': {'asset_quantity': '0.1'}}";
  const signature = signRobinhoodRequest(
    "rh-api-6148effc-c0b1-486c-8940-a1d099456be6",
    "xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=",
    "1698708981",
    "/api/v1/crypto/trading/orders/",
    "POST",
    body,
  );
  assert.equal(signature, "q/nEtxp/P2Or3hph3KejBqnw5o9qeuQ+hYRnB56FaHbjDsNUY9KhB1asMxohDnzdVFSD7StaTqjSd9U9HvaRAw==");
});

test("Robinhood request signs the exact JSON body it transmits", async () => {
  const originalNow = Date.now;
  Date.now = () => 1_698_708_981_000;
  let capturedSignature: string | null = null;
  let capturedBody: string | null = null;
  try {
    const client = new RobinhoodCryptoClient({
      apiKey: "rh-api-6148effc-c0b1-486c-8940-a1d099456be6",
      privateKey: "xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=",
      accountNumber: "unused",
      fetch: async (_input, init) => {
        capturedSignature = new Headers(init?.headers).get("x-signature");
        capturedBody = String(init?.body);
        return Response.json({ ok: true });
      },
    });
    await client.request("POST", "/api/v1/crypto/trading/orders/", {
      client_order_id: "131de903-5a9c-4260-abc1-28d562a5dcf0",
      side: "buy",
      type: "market",
      symbol: "BTC-USD",
      market_order_config: { asset_quantity: "0.1" },
    });
  } finally {
    Date.now = originalNow;
  }
  assert.equal(capturedSignature, signRobinhoodRequest(
    "rh-api-6148effc-c0b1-486c-8940-a1d099456be6",
    "xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=",
    "1698708981",
    "/api/v1/crypto/trading/orders/",
    "POST",
    capturedBody!,
  ));
});

test("agent guardrails return HOLD below the confidence threshold", () => {
  const risk = {
    symbol: "BTC",
    news: { items: [{ direction: "bullish", sentiment: 4, confidence: 0.5 }] },
    funding: { carry: { funding_rate_per_hour: 0.0001 } },
    freshness: { status: "fresh" },
  } as unknown as MarketRisk;
  assert.equal(decideFromMarketRisk(risk).side, "HOLD");
});

test("agent reads the live x402 news.items schema and normalizes -10..10 sentiment", () => {
  const risk = {
    symbol: "BTC",
    news: { items: [{ direction: "bullish", sentiment: 8, confidence: 0.95 }] },
    funding: { carry: { funding_rate_per_hour: 0.0001 } },
    freshness: { status: "fresh" },
  } as unknown as MarketRisk;
  const decision = decideFromMarketRisk(risk);
  assert.equal(decision.side, "BUY");
  assert.equal(decision.confidence, 0.76);
});

test("direct Hyperliquid candles use the official info request shape", async () => {
  let requestBody: unknown;
  const client = new HyperliquidPublicClient({
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json([{ s: "BTC", i: "1h", t: 1, T: 2, o: "1", h: "2", l: "1", c: "2", v: "3", n: 4 }]);
    },
  });
  const candles = await client.candles("BTC", "1h", { startTime: 1, endTime: 2 });
  assert.equal(candles.length, 1);
  assert.deepEqual(requestBody, {
    type: "candleSnapshot",
    req: { coin: "BTC", interval: "1h", startTime: 1, endTime: 2 },
  });
});

test("direct Hyperliquid instrument helpers unwrap the metadata envelopes", async () => {
  const client = new HyperliquidPublicClient({
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { type: string };
      if (body.type === "meta") return Response.json({ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] });
      return Response.json({ universe: [{ name: "PURR/USDC", index: 0, tokens: [1, 0] }], tokens: [] });
    },
  });
  assert.equal((await client.perpetuals())[0]?.name, "BTC");
  assert.equal((await client.perpetualMeta()).universe[0]?.name, "BTC");
  assert.equal((await client.spotInstruments())[0]?.name, "PURR/USDC");
});

test("direct Hyperliquid public reads retry a 429 response", async () => {
  let calls = 0;
  const client = new HyperliquidPublicClient({
    maxRetries: 1,
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: "limited" }, { status: 429, headers: { "retry-after": "0" } })
        : Response.json({ BTC: "100000" });
    },
  });
  assert.deepEqual(await client.allMids(), { BTC: "100000" });
  assert.equal(calls, 2);
});

test("direct Hyperliquid helpers fail closed on malformed 200 responses", async () => {
  const client = new HyperliquidPublicClient({
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { type: string };
      if (body.type === "allMids") return Response.json({ BTC: 100_000 });
      return Response.json({});
    },
  });
  await assert.rejects(client.perpetuals(), (error: unknown) => error instanceof OmniContractError && error.route === "hyperliquid:/info:meta");
  await assert.rejects(client.spotInstruments(), /expected universe array/);
  await assert.rejects(client.metaAndAssetContexts(), /expected \[meta, contexts\]/);
  await assert.rejects(client.allMids(), /expected string price values/);
  await assert.rejects(client.candles("BTC", "1h"), /expected an array/);
  await assert.rejects(client.l2Book("BTC"), /expected coin and time/);
  await assert.rejects(client.recentTrades("BTC"), /expected an array/);
  assert.throws(() => client.candles(" ", "1h"), /coin must contain 1 to 64 characters/);
});

test("direct Hyperliquid retry backoff remains inside the overall timeout", async () => {
  const client = new HyperliquidPublicClient({
    timeoutMs: 30,
    maxRetries: 2,
    fetch: async () => Response.json({ error: "limited" }, { status: 429, headers: { "retry-after": "10" } }),
  });
  const started = Date.now();
  await assert.rejects(client.allMids(), /abort|timeout/i);
  assert.ok(Date.now() - started < 1_000, "retry delay escaped the configured timeout");
});

test("direct Hyperliquid WebSocket reconnects are bounded across successful opens", async () => {
  class FakeWebSocket extends EventEmitter {
    static instances: FakeWebSocket[] = [];
    readyState: number = WebSocket.CONNECTING;
    constructor(_url: string) {
      super();
      FakeWebSocket.instances.push(this);
    }
    send() {}
    open() { this.readyState = WebSocket.OPEN; this.emit("open"); }
    end() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
    close() { this.end(); }
  }

  const client = new HyperliquidWebSocketClient({
    maxReconnects: 1,
    reconnectDelayMs: 0,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
  const iterator = client.trades("BTC")[Symbol.asyncIterator]();
  FakeWebSocket.instances[0]!.open();
  FakeWebSocket.instances[0]!.end();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.instances[1]!.open();
  FakeWebSocket.instances[1]!.end();
  await assert.rejects(iterator.next(), /Hyperliquid WebSocket closed/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(FakeWebSocket.instances.length, 2);
});

test("x402 buyer rejects challenges above its per-call USDC ceiling", async () => {
  assert.equal(usdToUsdcAtomic(0.01), 10_000n);
  assert.equal(usdToUsdcAtomic(0.0000019), 1n);
  const paymentClient = createEvmPaymentClient(`0x${"11".repeat(32)}` as `0x${string}`, { maxPaymentUsd: 0.01 });
  await assert.rejects(paymentClient.createPaymentPayload({
    x402Version: 2,
    resource: { url: "https://example.test/paid" },
    accepts: [{
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x0000000000000000000000000000000000000001",
      amount: "10001",
      payTo: "0x0000000000000000000000000000000000000002",
      maxTimeoutSeconds: 60,
      extra: {},
    }],
  }));
});

test("x402 buyer rejects a non-USDC asset even below the price ceiling", async () => {
  const paymentClient = createEvmPaymentClient(`0x${"11".repeat(32)}` as `0x${string}`);
  await assert.rejects(paymentClient.createPaymentPayload({
    x402Version: 2,
    resource: { url: "https://example.test/paid" },
    accepts: [{
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x0000000000000000000000000000000000000001",
      amount: "1",
      payTo: "0x0000000000000000000000000000000000000002",
      maxTimeoutSeconds: 60,
      extra: {},
    }],
  }));
});
