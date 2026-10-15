import type { GuardedTestnetExecutor, GuardedTestnetPlan, TestnetReconciliation } from "@omni-terminal/sdk";

type Executor = Pick<GuardedTestnetExecutor, "submit" | "cancel" | "previewReduction">;

function requireReconciled(result: TestnetReconciliation): void {
  if (!result.complete || !result.fills || !result.remainingExposure) {
    throw new Error("Incomplete execution reconciliation; preserve recovery journal");
  }
  if (result.status.status === "order" && result.status.order.status === "filled" && !result.fills.length) {
    throw new Error("Filled order is not indexed in fills; preserve recovery journal");
  }
}

function isFlat(result: TestnetReconciliation): boolean {
  return !!result.remainingExposure && result.remainingExposure.every(({ position }) =>
    position.szi.trim() !== "" && Number.isFinite(Number(position.szi)) && Number(position.szi) === 0);
}

/** Only returns after authoritative reconciliation and flat final exposure. */
export async function runGuardedLifecycle(executor: Executor, plan: GuardedTestnetPlan) {
  const entry = await executor.submit(plan);
  const result = await executor.cancel(entry);
  requireReconciled(result);
  if (result.fills!.length) {
    const reduction = await executor.previewReduction(entry);
    const cleanup = await executor.submit(reduction);
    const final = await executor.cancel(cleanup);
    requireReconciled(final);
    if (!final.fills!.length || !isFlat(final)) throw new Error("Cleanup incomplete; preserve recovery journal");
    return { entry: result, cleanup: final };
  }
  if (!isFlat(result)) throw new Error("Unattributed exposure remains; preserve recovery journal");
  return { entry: result };
}
