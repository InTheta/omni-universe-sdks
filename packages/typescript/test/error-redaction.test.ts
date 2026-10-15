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
import { createEvmPaymentClient, OmniX402Client, OmniPaymentError } from "../src/index.js";
test("paid wrapper failures redact unsupported challenge extras before parsing", async () => {
  let calls=0;
  const client=new OmniX402Client({paymentClient:createEvmPaymentClient(`0x${"11".repeat(32)}`),fetch:async()=>{
    calls++;
    const challenge={x402Version:2,resource:{url:"https://omniterminal.app/api/x402/v1/market-carry/BTC"},accepts:[{scheme:"unsupported",network:"eip155:999999",asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",payTo:"0x733f40A4FA0cd13d59aBADE04b9eD2e9acAc6457",amount:"3000",maxTimeoutSeconds:60,extra:{proof:secret}}]};
    return new Response(null,{status:402,headers:{"payment-required":Buffer.from(JSON.stringify(challenge)).toString("base64")}});
  }});
  await assert.rejects(client.marketCarry("BTC"),error=>{
    assert.ok(error instanceof OmniPaymentError);
    assert.equal(error.code,"PAYMENT_OUTCOME_UNKNOWN");
    assert.equal(error.requiresReconciliation,true);
    assert.equal(error.retryable,false);
    assert.ok(!logged(error).includes(secret));
    return true;
  });
  assert.equal(calls,1);
});
test("paid timeout and budget errors retain safe classifications only", async()=>{
  for(const failure of [new DOMException(secret,"TimeoutError"),new Error("Aggregate payment authorization budget exceeded "+secret)]) {
    const client=new OmniX402Client({paymentClient:createEvmPaymentClient(`0x${"11".repeat(32)}`),fetch:async()=>{throw failure}});
    await assert.rejects(client.marketCarry("BTC"),error=>{
      assert.ok(error instanceof OmniPaymentError);
      assert.ok(!logged(error).includes(secret));
      if(failure.name==="TimeoutError")assert.equal(error.name,"TimeoutError");
      else assert.equal(error.code,"PAYMENT_BUDGET_EXCEEDED");
      return true;
    });
  }
});
