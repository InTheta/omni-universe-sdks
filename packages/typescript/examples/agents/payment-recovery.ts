import assert from "node:assert/strict";
import { BundleBudget, createAskOmniBundlePlan, createEvmPaymentClient, OMNI_USDC_ASSETS, OMNI_X402_RECEIVER, OmniX402Client } from "@omni-terminal/sdk";
import { x402Client } from "@x402/core/client";

// Deterministic fixtures only: no remote service, usable payer, or settlement.
const client = createEvmPaymentClient(`0x${"11".repeat(32)}`, { maxPaymentUsd: 0.01, maxTotalPaymentUsd: 0.01 });
const requirements = { x402Version: 2, resource: { url: "https://fixture.invalid/research" }, accepts: [{
  scheme: "exact", network: "eip155:84532" as const, asset: OMNI_USDC_ASSETS["eip155:84532"][0], amount: "10000",
  payTo: OMNI_X402_RECEIVER, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" },
}] };
const scenarios: Array<{ scenario: string; outcome: string }> = [];
for (const [scenario, changes] of [["wrong_recipient", { payTo: "0x0000000000000000000000000000000000000001" }],
  ["expired_authorization_window", { maxTimeoutSeconds: 0 }], ["over_per_request_budget", { amount: "10001" }]] as const) {
  await assert.rejects(client.createPaymentPayload({ ...requirements, accepts: [{ ...requirements.accepts[0]!, ...changes }] }));
  scenarios.push({ scenario, outcome: "rejected_before_authorization" });
}
await client.createPaymentPayload(requirements); // local fixture signature is deliberately discarded
await assert.rejects(client.createPaymentPayload(requirements), /Aggregate payment/);
scenarios.push({ scenario: "retry_after_uncertain_settlement", outcome: "authorization_hold_prevents_repayment" });
const budget = new BundleBudget({ budgetUsd: 0.12, maxPaymentUsd: 0.1 });
const plan = createAskOmniBundlePlan({ symbol: "BTC", tier: "brief" });
let attempts = 0;
const adapter = async () => { attempts++; throw new Error("fixture response lost after possible settlement"); };
const first = await budget.execute("stable-fixture-operation", plan, adapter);
assert.equal(await budget.execute("stable-fixture-operation", plan, adapter), first);
assert.equal(attempts, 1);
assert.equal(first.uncertainAtomic, 100000);
scenarios.push({ scenario: "bundle_disconnect_recovery", outcome: "same_id_reuses_failed_result_unstarted_steps_not_charged" });
let rateLimitedAttempts = 0;
const http = new OmniX402Client({ paymentClient: new x402Client(), fetch: async () => {
  rateLimitedAttempts++; return Response.json({ error: "fixture_rate_limited" }, { status: 429 });
} });
await assert.rejects(http.newsHealth());
assert.equal(rateLimitedAttempts, 1);
scenarios.push({ scenario: "rate_limited_data_call", outcome: "explicit_error_no_automatic_paid_retry" });
console.log(JSON.stringify({ schema: "omni_payment_recovery.v1", evidence: "mock-tested", paid: false,
  spentUsdc: "0", scenarios, uncertainSettlement: "Inspect authoritative receipt/audit before authorizing a new operation. This in-memory budget is not durable across restarts." }, null, 2));
