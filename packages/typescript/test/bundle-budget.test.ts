import assert from "node:assert/strict";
import test from "node:test";
import { BundleBudget, BundleBudgetError, createAskOmniBundlePlan, createEvmPaymentClient, OMNI_USDC_ASSETS } from "../src/index.js";

const plan = () => createAskOmniBundlePlan({ symbol: "BTC", tier: "brief" });
const adapter = async (step: { priceAtomic: number }) => ({ value: "mock", chargedAtomic: step.priceAtomic });

test("bundle below/exact ceiling succeeds; over ceiling rejects before any work", async () => {
  for (const budgetUsd of [0.120, 0.121]) {
    const budget = new BundleBudget({ budgetUsd, maxPaymentUsd: 0.1 });
    const result = await budget.execute("one", plan(), adapter);
    assert.equal(result.complete, true);
    assert.equal(result.chargedAtomic, 120_000);
    assert.equal(budget.availableAtomic, Math.round(budgetUsd * 1e6) - 120_000);
  }
  let calls = 0;
  const budget = new BundleBudget({ budgetUsd: 0.119, maxPaymentUsd: 0.1 });
  assert.throws(() => budget.execute("over", plan(), async () => { calls++; return { value: 0 }; }), (error: unknown) => {
    assert.ok(error instanceof BundleBudgetError);
    assert.equal(error.requiredAtomic, 120_000);
    assert.equal(error.availableAtomic, 119_000);
    assert.equal(error.code, "BUNDLE_BUDGET_EXCEEDED");
    return true;
  });
  assert.equal(calls, 0);
  assert.equal(budget.availableAtomic, 119_000);
});

test("per-call default is never bypassed by a sufficient total budget", () => {
  const budget = new BundleBudget({ budgetUsd: 1 });
  assert.throws(() => budget.execute("per-call", plan(), adapter), (error: unknown) => {
    assert.ok(error instanceof BundleBudgetError);
    assert.equal(error.boundary, "per_call");
    assert.equal(error.requiredAtomic, 100_000);
    assert.equal(error.availableAtomic, 10_000);
    return true;
  });
  assert.equal(budget.availableAtomic, 1_000_000);
});

test("malformed totals/prices/duplicate items fail before adapter execution", () => {
  const budget = new BundleBudget({ budgetUsd: 1, maxPaymentUsd: 1 });
  const malformed = [
    { ...plan(), maxCostAtomic: 1 },
    { ...plan(), steps: [{ ...plan().steps[0]!, priceAtomic: -1 }] },
    { ...plan(), steps: [plan().steps[0]!, plan().steps[0]!] },
  ];
  for (const invalid of malformed) assert.throws(() => budget.execute("invalid", invalid, adapter), RangeError);
  assert.equal(budget.availableAtomic, 1_000_000);
});

test("same-ID concurrent/repeated retries reuse result, different IDs cannot oversubscribe", async () => {
  let calls = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const budget = new BundleBudget({ budgetUsd: 0.12, maxPaymentUsd: 0.1 });
  const run = async (step: { priceAtomic: number }) => { calls++; await wait; return adapter(step); };
  const first = budget.execute("stable", plan(), run);
  assert.equal(first, budget.execute("stable", plan(), run));
  assert.throws(() => budget.execute("other", plan(), run), BundleBudgetError);
  assert.throws(() => budget.execute("stable", { ...plan(), symbol: "ETH" }, run), /different bundle/);
  release();
  const result = await first;
  assert.equal(await budget.execute("stable", plan(), run), result);
  assert.equal(calls, 3);
});

test("ambiguous failure is held, unattempted reservations released, same-ID failure never recharged", async () => {
  const budget = new BundleBudget({ budgetUsd: 0.12, maxPaymentUsd: 0.1 });
  let calls = 0;
  const run = async () => { calls++; throw new Error("response lost after possible settlement"); };
  const result = await budget.execute("ambiguous", plan(), run, { allowPartial: true });
  assert.equal(result.complete, false);
  assert.equal(result.chargedAtomic, 0);
  assert.equal(result.uncertainAtomic, 100_000);
  assert.deepEqual(result.items.map((item) => item.status), ["failed", "not_started", "not_started"]);
  assert.equal(budget.availableAtomic, 20_000);
  assert.equal(await budget.execute("ambiguous", plan(), run, { allowPartial: true }), result);
  assert.equal(calls, 1);
});

test("partial optional fulfilment is opt-in; actual charges and uncertain authorizations are separate", async () => {
  const deep = createAskOmniBundlePlan({ symbol: "BTC", tier: "deep" });
  for (const allowPartial of [false, true]) {
    const budget = new BundleBudget({ budgetUsd: 0.133, maxPaymentUsd: 0.1 });
    const result = await budget.execute("partial", deep, async (step) => {
      if (step.id === "market_carry") throw new Error("partial failure");
      return { value: step.id, chargedAtomic: step.priceAtomic - 1 };
    }, { allowPartial });
    assert.equal(result.complete, false);
    assert.equal(result.uncertainAtomic, 3_000);
    assert.equal(result.items.filter((item) => item.status === "completed").length, allowPartial ? 5 : 3);
    assert.equal(result.chargedAtomic, allowPartial ? 129_995 : 119_997);
    assert.equal(budget.availableAtomic, allowPartial ? 5 : 10_003);
  }
});

test("unreported or invalid charge retains ceiling; plan mutation cannot increase admitted work", async () => {
  const budget = new BundleBudget({ budgetUsd: 0.12, maxPaymentUsd: 0.1 });
  const mutable = plan();
  const resultPromise = budget.execute("copied", mutable, async () => ({ value: "confirmed response, amount unavailable" }));
  mutable.steps[0]!.priceAtomic = 999_999;
  const result = await resultPromise;
  assert.equal(result.complete, true);
  assert.equal(result.chargedAtomic, 0);
  assert.equal(result.uncertainAtomic, 120_000);
  assert.equal(budget.availableAtomic, 0);
  const second = new BundleBudget({ budgetUsd: 0.12, maxPaymentUsd: 0.1 });
  const invalid = await second.execute("invalid", plan(), async () => ({ value: "bad", chargedAtomic: 1_000_000 }));
  assert.equal(invalid.uncertainAtomic, 100_000);
  assert.equal(invalid.items[0]!.status, "failed");
});

test("one-shot payment client rejects recovery/retry authorization, including concurrent creation", async () => {
  // Deterministic public test fixture, no funds, RPC, or submitted payloads.
  const paymentClient = createEvmPaymentClient(`0x${"11".repeat(32)}`, { maxPaymentAuthorizations: 1 });
  const requirement = {
    x402Version: 2,
    resource: { url: "https://example.test/paid" },
    accepts: [{ scheme: "exact", network: "eip155:84532" as const,
      asset: OMNI_USDC_ASSETS["eip155:84532"][0], amount: "1000",
      payTo: "0x0000000000000000000000000000000000000002", maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" } }],
  };
  const results = await Promise.allSettled([
    paymentClient.createPaymentPayload(requirement), paymentClient.createPaymentPayload(requirement),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  await assert.rejects(paymentClient.createPaymentPayload(requirement), /authorization limit/);
});
