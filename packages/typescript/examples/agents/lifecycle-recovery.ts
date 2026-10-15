import assert from "node:assert/strict";
import type { GuardedTestnetExecutor, GuardedTestnetPlan, TestnetReconciliation } from "@omni-terminal/sdk";
import { runGuardedLifecycle } from "./guarded-lifecycle.js";

// Deterministic fixtures only. No wallet, signer, fetch, venue order or credentials.
const plan = { network: "hyperliquid-testnet" } as GuardedTestnetPlan;
function result(status = "canceled", position = "0", indexed = false): TestnetReconciliation {
  return { complete: true, status: { status: "order", order: { status, order: {} } },
    fills: indexed ? [{ oid: 1 }] : [], remainingExposure: position === "0" ? [] : [{ position: { szi: position } }] } as unknown as TestnetReconciliation;
}
function fixture(results: TestnetReconciliation[], rejection?: string) {
  let submissions = 0, reductions = 0;
  const executor = {
    submit: async () => { submissions++; if (rejection) throw new Error(rejection); return { plan }; },
    cancel: async () => { const next = results.shift(); if (!next) throw new Error("Fixture exhausted"); return next; },
    previewReduction: async () => { reductions++; return plan; },
  } as unknown as Pick<GuardedTestnetExecutor, "submit" | "cancel" | "previewReduction">;
  return { executor, counts: () => ({ submissions, reductions }) };
}
const scenarios: { scenario: string; result: string; submissions: number; reductions: number }[] = [];
for (const rejection of ["ORDER_REJECTED", "STALE_DATA", "EXPIRED_QUOTE", "INSUFFICIENT_COLLATERAL", "UNCERTAIN_ORDER_AFTER_DISCONNECT"]) {
  const f = fixture([], rejection);
  await assert.rejects(runGuardedLifecycle(f.executor, plan), new RegExp(rejection));
  assert.equal(f.counts().submissions, 1, "No resubmission after uncertain or rejected fixture outcome");
  scenarios.push({ scenario: rejection, result: "stopped_without_replay", ...f.counts() });
}
for (const [name, entry, cleanup] of [
  ["unindexed_filled_entry", result("filled", "0.001"), undefined],
  ["partial_cleanup_exposure", result("filled", "0.001", true), result("canceled", "0.0005", true)],
] as const) {
  const f = fixture(cleanup ? [entry, cleanup] : [entry]);
  await assert.rejects(runGuardedLifecycle(f.executor, plan), /preserve recovery journal/);
  scenarios.push({ scenario: name, result: "recovery_required", ...f.counts() });
}
const closed = fixture([result("filled", "0.001", true), result("filled", "0", true)]);
assert.ok((await runGuardedLifecycle(closed.executor, plan)).cleanup);
scenarios.push({ scenario: "partial_entry_fill_then_reduce_only_cleanup", result: "fixture_flat_after_indexed_cleanup", ...closed.counts() });
const unfilled = fixture([result()]);
assert.equal((await runGuardedLifecycle(unfilled.executor, plan)).cleanup, undefined);
scenarios.push({ scenario: "unfilled_cancel", result: "fixture_flat_no_earned_builder_fee", ...unfilled.counts() });
console.log(JSON.stringify({ schema: "omni_lifecycle_recovery.v1", evidence: "mock-tested", venueRequests: 0, signatures: 0,
  placedOrders: false, paidUsageUsdc: "0", scenarios, limits: "Fixtures exercise orchestration, not venue rejection semantics, sandbox execution or builder credit." }, null, 2));
