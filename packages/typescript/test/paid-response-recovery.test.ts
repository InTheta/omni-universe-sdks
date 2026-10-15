import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { x402Client } from "@x402/core/client";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { OmniX402Client, OmniApiError, OmniContractError } from "../src/index.js";

// Only unsigned HTTP-response fixtures. No signer, key, authorization or network.
const syntheticReceipt = encodePaymentResponseHeader({ success: true, network: "eip155:84532", transaction: `0x${"ab".repeat(32)}` });
const headers = { "content-type": "application/json", "payment-response": syntheticReceipt };
const product = { service: "omni.hyperliquid_market_carry", schema: "hyperliquid_market_carry.v1" };
type Recovery = Error & { requiresReconciliation?: true; retryable?: false; paymentOutcome?: "unconfirmed" };
const assertRecovery = (error: unknown) => {
  assert(error instanceof Error);
  const recovery = error as Recovery;
  assert.equal(recovery.requiresReconciliation, true);
  assert.equal(recovery.retryable, false);
  assert.equal(recovery.paymentOutcome, "unconfirmed");
  assert.equal(Object.getOwnPropertyDescriptor(error, "retryable")?.writable, false);
};

test("paid JSON parse, body disconnect and product validation failures retain reconciliation flags without repeating requests", async () => {
  for (const withReceipt of [true, false]) {
    for (const kind of ["invalid_json", "disconnected_body", "wrong_product"] as const) {
      let calls = 0;
      const responseHeaders = withReceipt ? headers : { "content-type": "application/json" };
      const client = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => {
        calls++;
        if (kind === "disconnected_body") return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("fixture body disconnected", "AbortError")); } }), { headers: responseHeaders });
        return new Response(kind === "invalid_json" ? "{" : JSON.stringify({ ...product, service: "wrong_service" }), { headers: responseHeaders });
      } });
      await assert.rejects(client.marketCarry("BTC"), error => {
        assertRecovery(error);
        assert(error instanceof (kind === "wrong_product" ? OmniContractError : OmniApiError));
        return true;
      });
      assert.equal(calls, 1);
    }
  }
});

test("paid receipt failures and non-2xx responses keep their typed contracts plus conservative recovery metadata", async () => {
  for (const [receipt, expected] of [[undefined, "Missing PAYMENT-RESPONSE"], ["%%%SYNTHETIC_NOT_BASE64%%%", "Invalid PAYMENT-RESPONSE"]] as const) {
    const client = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => Response.json(product, { headers: receipt ? { "payment-response": receipt } : {} }) });
    await assert.rejects(client.marketCarry("BTC"), error => {
      assert(error instanceof OmniContractError);
      assert.equal(error.requiresReconciliation, true);
      assert.equal(error.retryable, false);
      assert.equal(error.paymentOutcome, "unconfirmed");
      assert.match(error.message, new RegExp(expected));
      assertRecovery(error);
      return true;
    });
  }
  let calls = 0;
  const limited = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => {
    calls++; return Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "3" } });
  } });
  await assert.rejects(limited.marketCarry("BTC"), error => {
    assert(error instanceof OmniApiError);
    assert.equal(error.requiresReconciliation, true);
    assert.equal(error.retryable, false);
    assert.equal(error.paymentOutcome, "unconfirmed");
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, "3");
    assertRecovery(error);
    return true;
  });
  assert.equal(calls, 1);
});

test("unsigned health parsing and rejected quote/admission remain unchanged", async () => {
  let calls = 0;
  const health = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => {
    calls++; return new Response("{", { headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(health.newsHealth(), error => {
    assert(error instanceof OmniApiError);
    assert.equal((error as Recovery).requiresReconciliation, undefined);
    return true;
  });
  assert.throws(() => health.marketCarry("DOGE" as never), RangeError);
  assert.equal(calls, 1);
  const substituted = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => Response.json({}, { status: 402,
    headers: { "payment-required": encodePaymentRequiredHeader({ x402Version: 2, resource: { url: "https://other.invalid/paid" }, accepts: [] }) },
  }) });
  await assert.rejects(substituted.marketCarry("BTC"), error => {
    assert(error instanceof OmniContractError);
    assert.equal((error as Recovery).requiresReconciliation, undefined);
    return true;
  });
});

test("paid screenshot MIME, PNG, receipt, size and body failures are unconfirmed and never silently retried", async () => {
  for (const kind of ["mime", "png", "receipt", "size", "body"] as const) {
    let calls = 0;
    const client = new OmniX402Client({ paymentClient: new x402Client(), maxScreenshotBytes: 8, fetch: async () => {
      calls++;
      const pngHeaders = { "content-type": kind === "mime" ? "text/plain" : "image/png", ...(kind === "receipt" ? {} : { "payment-response": syntheticReceipt }) };
      if (kind === "body") return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("fixture disconnect", "AbortError")); } }), { headers: pngHeaders });
      return new Response(new Uint8Array(kind === "size" ? 9 : 8), { headers: pngHeaders });
    } });
    await assert.rejects(client.liquidationLevelsScreenshot("BTC"), error => { assertRecovery(error); return true; });
    assert.equal(calls, 1);
  }
});

test("paid recovery errors retain no echoed body, proof or raw adapter cause", async () => {
  const sentinel = "SYNTHETIC_UNTRUSTED_BODY_SENTINEL";
  const client = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => Response.json({ ...product, service: sentinel, paymentProof: sentinel }, { headers }) });
  await assert.rejects(client.marketCarry("BTC"), error => {
    assertRecovery(error);
    assert(error instanceof OmniContractError);
    for (const rendered of [String(error), inspect(error), JSON.stringify(error)]) assert(!rendered.includes(sentinel));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("public generic auto-paying request retains reconciliation flags when receipt and body are lost", async () => {
  let calls = 0;
  const client = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("fixture lost receipt and body", "AbortError")); } }), { headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(client.request("GET", "/api/x402/v1/market-carry/BTC"), error => {
    assert(error instanceof OmniApiError);
    assert.equal(error.requiresReconciliation, true);
    assert.equal(error.retryable, false);
    assert.equal(error.paymentOutcome, "unconfirmed");
    return true;
  });
  assert.equal(calls, 1);
});
