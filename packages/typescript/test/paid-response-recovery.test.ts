import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { x402Client } from "@x402/core/client";
import { x402ResourceServer } from "@x402/core/server";
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


const verificationReasons = [
  "invalid_exact_evm_payload_authorization_valid_before", "invalid_exact_evm_payload_authorization_valid_after",
  "invalid_exact_evm_signature", "invalid_exact_evm_payload_authorization_value_mismatch",
  "invalid_exact_evm_recipient_mismatch", "invalid_exact_evm_network_mismatch", "invalid_exact_evm_nonce_already_used",
  "invalid_exact_evm_insufficient_balance", "invalid_exact_evm_transaction_simulation_failed",
  "asset_not_deployed_contract", "invalid_exact_evm_scheme", "invalid_exact_evm_missing_eip712_domain",
];
const rejectionRequirements = { scheme: "exact", network: "eip155:84532" as const,
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "1000",
  payTo: "0x0000000000000000000000000000000000000002", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } };
const rejectionResource = { url: "https://offline.invalid/api/x402/v1/news" };

test("public paid requests preserve official verification reasons from gateway-shaped v2 headers without retrying", async () => {
  const server = new x402ResourceServer();
  const sentinel = "SYNTHETIC_UNKNOWN_REJECTION_SENTINEL";
  for (const reason of [...verificationReasons, sentinel]) {
    let calls = 0, fixturePayloads = 0;
    // An unsigned fixture mechanism exercises the HTTP handshake without any signer or network.
    const payer = new x402Client().register("eip155:*", { scheme: "exact", createPaymentPayload: async () => {
      fixturePayloads++;
      return { x402Version: 2, payload: { fixture: "unsigned deterministic payload" } };
    } });
    const challenge = await server.createPaymentRequiredResponse([rejectionRequirements], rejectionResource);
    const rejected = await server.createPaymentRequiredResponse([rejectionRequirements], rejectionResource, reason);
    const client = new OmniX402Client({ baseUrl: "https://offline.invalid", paymentClient: payer, fetch: async () => {
      calls++;
      assert(calls <= 2);
      // Official server middleware puts the reason in PAYMENT-REQUIRED.error and sends an empty JSON body.
      return Response.json({}, { status: 402, headers: { "payment-required": encodePaymentRequiredHeader(calls === 1 ? challenge : rejected) } });
    } });
    await assert.rejects(client.request("GET", "/api/x402/v1/news"), error => {
      assert(error instanceof OmniApiError);
      assert.equal(error.code, reason === sentinel ? "HTTP_ERROR" : reason);
      for (const rendered of [String(error), inspect(error), JSON.stringify(error)]) assert(!rendered.includes(sentinel));
      assert.equal(error.cause, undefined);
      assert.equal(error.status, 402);
      assertRecovery(error);
      return true;
    });
    assert.equal(calls, 2);
    assert.equal(fixturePayloads, 1);
  }
});

test("error header decoding is bounded, v2-only, finite and redacted with explicit body precedence", () => {
  const sentinel = "SYNTHETIC_UNTRUSTED_REJECTION_SENTINEL";
  const known = "invalid_exact_evm_nonce_already_used";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
  for (const header of [undefined, "%%%" + sentinel, encode({ x402Version: 2, error: sentinel }),
    encode({ x402Version: 1, error: known }), encode({ x402Version: "2", error: known }),
    encode({ x402Version: 2, error: { detail: known } }), encode(null),
    encode({ x402Version: 2, error: known, ignored: sentinel.repeat(1000) })]) {
    const response = Response.json({}, { status: 402, headers: header ? { "payment-required": header } : {} });
    const error = new OmniApiError("Request failed", 402, response, {});
    assert.equal(error.code, "HTTP_ERROR");
    for (const rendered of [String(error), inspect(error), JSON.stringify(error)]) assert(!rendered.includes(sentinel));
    assert.equal(error.cause, undefined);
  }
  const header = encode({ x402Version: 2, error: known });
  assert.equal(new OmniApiError("Request failed", 402, Response.json({}, { status: 402, headers: { "payment-required": header } }), { error: "rate_limited" }).code, "rate_limited");
  assert.equal(new OmniApiError("Request failed", 402, Response.json({}, { status: 402, headers: { "payment-required": header } }), { error: sentinel }).code, known);
  assert.equal(new OmniApiError("Request failed", 500, Response.json({}, { status: 500, headers: { "payment-required": header } }), {}).code, "HTTP_ERROR");
  for (const legacy of ["invalid_exact_evm_payload_signature", "invalid_exact_evm_payload_recipient_mismatch"]) {
    assert.equal(new OmniApiError("Request failed", 402, Response.json({}, { status: 402 }), { error: legacy }).code, legacy);
  }
});
