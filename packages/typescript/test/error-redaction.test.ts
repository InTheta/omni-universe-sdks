import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { parseResponse } from "../src/http.js";
import { OmniApiError, OmniContractError } from "../src/index.js";
const secret = "sensitive_proof_marker_do_not_log";
function logged(error: unknown) { return String(error) + JSON.stringify(error) + inspect(error); }
test("HTTP errors never expose untrusted seller body, status text or metadata", async () => {
  for (const response of [
    Response.json({ detail: secret, error: secret, paymentSignature: secret }, { status: 402, statusText: secret, headers: {"x-request-id": secret, "retry-after": secret} }),
    new Response(secret, { status: 503, statusText: secret, headers: {"content-type": "text/plain"} }),
    new Response(secret, { status: 200, headers: {"content-type": "text/"+secret} }),
    new Response('{"proof":"'+secret, { status: 200, headers: {"content-type": "application/json"} }),
  ]) {
    await assert.rejects(parseResponse(response), error => {
      assert.ok(error instanceof OmniApiError);
      assert.ok(!logged(error).includes(secret));
      assert.equal(error.code, "HTTP_ERROR");
      return true;
    });
  }
});
test("contract errors drop raw product and settlement bodies", () => {
  const error = new OmniContractError("Invalid paid response", "/api/x402/v1/news", { nested: { paymentSignature: secret }, content: secret });
  assert.ok(!logged(error).includes(secret));
  assert.equal(error.code, "INVALID_RESPONSE_CONTRACT");
});
test("safe correlation IDs and retry metadata remain available", () => {
  const error = new OmniApiError("rate limited", 429, new Response(null, { status: 429, headers: {"x-request-id":"req-1", "retry-after":"30"} }), { detail: secret });
  assert.equal(error.requestId, "req-1");
  assert.equal(error.retryAfter, "30");
  assert.deepEqual(error.details, {code:"HTTP_ERROR",status:429,responseBodyRedacted:true});
});

test("official machine-readable payment error codes survive body redaction", async () => {
  await assert.rejects(parseResponse(Response.json({error: "invalid_exact_evm_payload_recipient_mismatch", detail: secret, proof: secret}, {status:402})), error => {
    assert.ok(error instanceof OmniApiError);
    assert.equal(error.code, "invalid_exact_evm_payload_recipient_mismatch");
    assert.ok(!logged(error).includes(secret));
    return true;
  });
});
