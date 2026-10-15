import type { AskOmniBundlePlan, AskOmniBundleStep } from "./bundles.js";
import { usdToUsdcAtomic } from "./x402.js";

export class BundleBudgetError extends Error {
  readonly code = "BUNDLE_BUDGET_EXCEEDED";
  constructor(
    readonly requiredAtomic: number,
    readonly availableAtomic: number,
    readonly boundary: "bundle" | "per_call",
    readonly stepId?: string,
  ) {
    super(`${boundary} requires ${requiredAtomic} atomic USDC; available ${availableAtomic}${stepId ? ` (${stepId})` : ""}`);
    this.name = "BundleBudgetError";
  }
}

export interface BundleItemResult<T> {
  id: AskOmniBundleStep["id"];
  status: "completed" | "failed" | "not_started";
  value?: T;
  /** Proven charge reported by the adapter; never an estimate. */
  chargedAtomic?: number;
  /** Ambiguous attempted payments remain held and unavailable for reuse. */
  uncertainAtomic?: number;
  error?: unknown;
}

export interface BundleExecutionResult<T> {
  operationId: string;
  complete: boolean;
  items: BundleItemResult<T>[];
  chargedAtomic: number;
  uncertainAtomic: number;
}

/**
 * One-process, one-instance ceiling. Share this instance across concurrent calls.
 * It is not a durable ledger, cross-process lock, refund mechanism or settlement
 * guarantee. Adapters MUST enforce each supplied step.priceAtomic at signing.
 * Unknown settlements are conservatively held for this instance's lifetime.
 */
export class BundleBudget {
  readonly limitAtomic: number;
  readonly perCallAtomic: number;
  private heldAtomic = 0;
  private operations = new Map<string, { fingerprint: string; promise: Promise<BundleExecutionResult<unknown>> }>();

  constructor(options: { budgetUsd: number; maxPaymentUsd?: number }) {
    this.limitAtomic = Number(usdToUsdcAtomic(options.budgetUsd));
    this.perCallAtomic = Number(usdToUsdcAtomic(options.maxPaymentUsd ?? 0.01));
  }

  get availableAtomic(): number { return this.limitAtomic - this.heldAtomic; }

  execute<T>(
    operationId: string,
    plan: AskOmniBundlePlan,
    adapter: (step: Readonly<AskOmniBundleStep>) => Promise<{ value: T; chargedAtomic?: number }>,
    options: { allowPartial?: boolean } = {},
  ): Promise<BundleExecutionResult<T>> {
    if (!operationId.trim()) throw new RangeError("operationId must not be empty");
    // Copy before awaiting: caller mutation cannot change the admitted payment plan.
    const steps = plan.steps.map((step) => ({ ...step }));
    const allowPartial = options.allowPartial ?? false;
    const fingerprint = JSON.stringify({ plan: { ...plan, steps }, allowPartial });
    const existing = this.operations.get(operationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("operationId already belongs to a different bundle");
      return existing.promise as Promise<BundleExecutionResult<T>>;
    }
    let required = 0;
    const ids = new Set<string>();
    for (const step of steps) {
      if (!Number.isSafeInteger(step.priceAtomic) || step.priceAtomic < 0 || ids.has(step.id)) throw new RangeError("invalid bundle price or duplicate item");
      ids.add(step.id);
      required += step.priceAtomic;
    }
    if (!Number.isSafeInteger(required) || required !== plan.maxCostAtomic) throw new RangeError("bundle total must equal the sum of item ceilings");
    if (required > this.availableAtomic) throw new BundleBudgetError(required, this.availableAtomic, "bundle");
    for (const step of steps) {
      if (step.priceAtomic > this.perCallAtomic) throw new BundleBudgetError(step.priceAtomic, this.perCallAtomic, "per_call", step.id);
    }
    // Synchronous admission prevents concurrent calls from oversubscribing this instance.
    this.heldAtomic += required;
    const promise = Promise.resolve().then(async () => {
      const items: BundleItemResult<T>[] = [];
      let stopped = false;
      let retained = 0;
      for (const step of steps) {
        if (stopped) { items.push({ id: step.id, status: "not_started" }); continue; }
        try {
          const result = await adapter(Object.freeze(step));
          if (result.chargedAtomic !== undefined && (!Number.isSafeInteger(result.chargedAtomic) || result.chargedAtomic < 0 || result.chargedAtomic > step.priceAtomic)) {
            throw new RangeError("adapter returned an invalid/unbounded charge; reconcile independently");
          }
          retained += result.chargedAtomic ?? step.priceAtomic;
          items.push({ id: step.id, status: "completed", ...result,
            ...(result.chargedAtomic === undefined ? { uncertainAtomic: step.priceAtomic } : {}),
          });
        } catch (error) {
          // A thrown request may already have settled: do not free or retry it.
          retained += step.priceAtomic;
          items.push({ id: step.id, status: "failed", uncertainAtomic: step.priceAtomic, error });
          stopped = !allowPartial || step.required || step.failurePolicy === "stop";
        }
      }
      this.heldAtomic -= required - retained;
      return {
        operationId,
        complete: items.every((item) => item.status === "completed"),
        items,
        chargedAtomic: items.reduce((sum, item) => sum + (item.chargedAtomic ?? 0), 0),
        uncertainAtomic: items.reduce((sum, item) => sum + (item.uncertainAtomic ?? 0), 0),
      };
    });
    this.operations.set(operationId, { fingerprint, promise });
    return promise;
  }
}
