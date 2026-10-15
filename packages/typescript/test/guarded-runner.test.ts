import assert from "node:assert/strict";
import test from "node:test";
import type { GuardedTestnetExecutor, GuardedTestnetPlan, TestnetReconciliation } from "@omni-terminal/sdk";
import { runGuardedLifecycle } from "../examples/agents/guarded-lifecycle.js";

const plan = {} as GuardedTestnetPlan;
function result(status = "canceled", exposure = "0", indexed = false): TestnetReconciliation {
  return { complete: true, status: { status: "order", order: { status, order: {} } },
    fills: indexed ? [{ oid: 1 }] : [], remainingExposure: exposure === "0" ? [] : [{ position: { szi: exposure } }] } as unknown as TestnetReconciliation;
}
function fixture(results: TestnetReconciliation[]) {
  let submissions = 0, reductions = 0;
  const executor = {
    submit: async () => { submissions++; return { plan }; },
    cancel: async () => results.shift()!,
    previewReduction: async () => { reductions++; return plan; },
  } as unknown as Pick<GuardedTestnetExecutor, "submit" | "cancel" | "previewReduction">;
  return { executor, counts: () => ({ submissions, reductions }) };
}
test("runner preserves recovery for filled entry before fills are indexed", async () => {
  for (const exposure of ["0", "0.001"]) {
    const f = fixture([result("filled", exposure)]);
    await assert.rejects(runGuardedLifecycle(f.executor, plan), /not indexed/);
    assert.deepEqual(f.counts(), { submissions: 1, reductions: 0 });
  }
});
test("runner refuses unattributed exposure and incomplete reconciliation", async () => {
  for (const response of [result("canceled", "0.001"), { ...result(), complete: false }, { ...result(), remainingExposure: undefined }]) {
    const f = fixture([response]);
    await assert.rejects(runGuardedLifecycle(f.executor, plan), /preserve recovery journal/);
    assert.equal(f.counts().submissions, 1);
  }
});
test("runner accepts reconciled unfilled cancellation with flat exposure", async () => {
  const f = fixture([result()]);
  const response = await runGuardedLifecycle(f.executor, plan);
  assert.equal(response.cleanup, undefined);
  assert.equal(f.counts().submissions, 1);
});
test("runner requires indexed cleanup fills and flat final exposure", async () => {
  for (const cleanup of [result("filled", "0", false), result("canceled", "0.001", true)]) {
    const f = fixture([result("filled", "0.001", true), cleanup]);
    await assert.rejects(runGuardedLifecycle(f.executor, plan), /preserve recovery journal/);
    assert.deepEqual(f.counts(), { submissions: 2, reductions: 1 });
  }
  const f = fixture([result("filled", "0.001", true), result("filled", "0", true)]);
  assert.ok((await runGuardedLifecycle(f.executor, plan)).cleanup);
});
