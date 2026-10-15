import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { GuardedTestnetExecutor } from "../src/index.js";

test("guarded execution: deterministic transport fixtures, never real orders", async () => {
  const original = globalThis.fetch;
  let approved = 25, collateral = "100", exchangeCalls = 0, stale = false, agentAllowed = true, agentExpired = false, existingOrder = false;
  let pending: Parameters<GuardedTestnetExecutor["reconcile"]>[0][] = [];
  const journals: unknown[] = [];
  const wallet = privateKeyToAccount(generatePrivateKey());
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(String(url)).origin, "https://api.hyperliquid-testnet.xyz");
    const body = JSON.parse(String(options?.body));
    if (String(url).endsWith("/exchange")) { exchangeCalls++; throw new Error("fixture disconnect after request"); }
    const fixtures: Record<string, unknown> = {
      metaAndAssetCtxs: [{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 20 }] }, [{}]],
      l2Book: { coin: "BTC", time: Date.now() - (stale ? 30_000 : 0), levels: [[{ px: "100000", sz: "1", n: 1 }], [{ px: "100010", sz: "1", n: 1 }]] },
      clearinghouseState: { withdrawable: collateral, assetPositions: [] },
      openOrders: existingOrder ? [{coin: "BTC", oid: 999}] : [],
      maxBuilderFee: approved,
      extraAgents: agentAllowed ? [{ address: wallet.address, validUntil: Date.now() + (agentExpired ? -1 : 60_000), name: "fixture" }] : [],
      orderStatus: { status: "unknownOid" },
    };
    assert.ok(body.type in fixtures, `unexpected method ${body.type}`);
    return Response.json(fixtures[body.type]);
  };
  try {
    const policy = { accountAddress: `0x${"11".repeat(20)}` as `0x${string}`, symbol: "BTC", maxNotionalUsd: 15, builderFeeTenthsBps: 25, loadPendingJournals: async () => pending, persist: async (j: unknown) => { journals.push(j); } };
    const disabled = new GuardedTestnetExecutor(policy);
    const preview = await disabled.preview("BUY", 15);
    await assert.rejects(disabled.submit(preview), /DISABLED/);
    assert.equal(exchangeCalls, 0);
    const executor = new GuardedTestnetExecutor({ ...policy, enabled: true, signer: wallet });
    const plan = await executor.preview("BUY", 15);
    await assert.rejects(executor.submit({ ...plan, size: "999" }), /modified/);
    await assert.rejects(executor.preview("BUY", 26), /cap/);
    const originalNow = Date.now;
    Date.now = () => plan.expiresAt + 1;
    try { await assert.rejects(executor.submit(plan), /expired/); } finally { Date.now = originalNow; }
    assert.equal(exchangeCalls, 0);
    agentAllowed = false;
    await assert.rejects(executor.submit(plan), /SIGNER_SCOPE_MISMATCH/);
    agentAllowed = true; agentExpired = true;
    await assert.rejects(executor.submit(plan), /SIGNER_SCOPE_MISMATCH/);
    agentExpired = false; existingOrder = true;
    await assert.rejects(executor.submit(plan), /OPEN_ORDER_RECOVERY_REQUIRED/);
    existingOrder = false;
    pending = [{plan, stage: "uncertain", startedAt: Date.now()}];
    await assert.rejects(executor.submit(plan), /PENDING_RECOVERY_REQUIRED/);
    pending = [];
    approved = Number.NaN;
    await assert.rejects(executor.submit(plan), /BUILDER_APPROVAL_REQUIRED/);
    assert.equal(exchangeCalls, 0);
    approved = 24;
    await assert.rejects(executor.submit(plan), /BUILDER_APPROVAL_REQUIRED/);
    approved = 25; collateral = "invalid";
    await assert.rejects(executor.submit(plan), /INSUFFICIENT_COLLATERAL/);
    collateral = "0";
    await assert.rejects(executor.submit(plan), /INSUFFICIENT_COLLATERAL/);
    collateral = "100"; stale = true;
    await assert.rejects(executor.submit(plan), /Stale/);
    stale = false;
    await assert.rejects(executor.submit(plan), /UNCERTAIN_ORDER/);
    assert.equal(exchangeCalls, 1);
    await assert.rejects(executor.submit(plan), /outstanding/);
    assert.equal(exchangeCalls, 1, "uncertain submission must never retry");
    assert.equal((journals[0] as {stage: string}).stage, "submitting");
    assert.equal((journals[1] as {stage: string}).stage, "uncertain");
    const result = await executor.reconcile(journals[1] as Parameters<typeof executor.reconcile>[0]);
    assert.equal(result.complete, false);
    assert.equal(result.reason, "unknown_outcome_do_not_resubmit");
    assert.equal(exchangeCalls, 1);
  } finally { globalThis.fetch = original; }
});

test("IOC fill and reduction reconcile only own flat-baseline fills (deterministic fixture)", async () => {
  const original = globalThis.fetch;
  let position = "0", orderCount = 0, venueStatus = "filled";
  const orders = new Map<string, { oid: number; side: string; size: string }>();
  const journals: unknown[] = [];
  const wallet = privateKeyToAccount(generatePrivateKey());
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (String(url).endsWith("/exchange")) {
      const order = body.action.orders[0];
      assert.deepEqual(body.action.builder, { b: "0x733f40a4fa0cd13d59abade04b9ed2e9acac6457", f: 25 });
      assert.equal(order.t.limit.tif, "Ioc");
      orderCount++;
      assert.equal(order.r, orderCount === 2);
      orders.set(order.c, { oid: orderCount, side: order.b ? "B" : "A", size: order.s });
      position = order.r ? "0" : order.s;
      return Response.json({ status: "ok", response: { type: "order", data: { statuses: [{ filled: { oid: orderCount, totalSz: order.s, avgPx: "100000" } }] } } });
    }
    const match = orders.get(body.oid);
    const fixtures: Record<string, unknown> = {
      metaAndAssetCtxs: [{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 20 }] }, [{}]],
      l2Book: { coin: "BTC", time: Date.now(), levels: [[{ px: "100000", sz: "1", n: 1 }], [{ px: "100010", sz: "1", n: 1 }]] },
      clearinghouseState: { withdrawable: "100", marginSummary: {totalMarginUsed: "2"}, crossMarginSummary: {totalMarginUsed: "2"}, crossMaintenanceMarginUsed: "0.5", assetPositions: Number(position) ? [{position: {coin: "BTC", szi: position, leverage: {type: "cross", value: 5}, marginUsed: "2"}}] : [] },
      openOrders: [],
      maxBuilderFee: 25,
      extraAgents: [{ address: wallet.address, validUntil: Date.now() + 60_000, name: "fixture" }],
      orderStatus: match ? { status: "order", order: { order: { coin: "BTC", cloid: body.oid, oid: match.oid }, status: venueStatus } } : { status: "unknownOid" },
      userFillsByTime: [...orders.values()].map(order => ({ coin: "BTC", oid: order.oid, sz: order.size, side: order.side, fee: "0.01", feeToken: "USDC", builderFee: "0.0001" })),
    };
    return Response.json(fixtures[body.type]);
  };
  try {
    const executor = new GuardedTestnetExecutor({ accountAddress: `0x${"11".repeat(20)}`, symbol: "BTC", maxNotionalUsd: 15, builderFeeTenthsBps: 25, allowTaker: true, enabled: true, signer: wallet, loadPendingJournals: async () => [], persist: async j => { journals.push(j); } });
    const plan = await executor.preview("BUY", 15, {kind: "ioc"});
    const journal = await executor.submit(plan);
    venueStatus = "unknown-future-status";
    const unresolved = await executor.reconcile(journal);
    assert.equal(unresolved.complete, false);
    assert.equal(unresolved.reason, "unrecognized_status_do_not_resubmit");
    assert.equal(journal.stage, "submitted");
    await assert.rejects(executor.submit(await executor.preview("BUY", 15, {kind: "ioc"})), /outstanding/);
    venueStatus = "triggered";
    assert.equal((await executor.reconcile(journal)).complete, false);
    venueStatus = "filled";
    const filled = await executor.reconcile(journal);
    assert.equal(filled.complete, true);
    assert.equal(filled.account?.margin.mode, "cross");
    assert.equal(filled.account?.margin.initialMarginUsd, "2");
    assert.equal(filled.account?.margin.crossMaintenanceMarginUsd, "0.5");
    assert.equal(filled.account?.margin.instrumentMaintenanceMarginUsd, null);
    position = "1";
    await assert.rejects(executor.previewReduction(journal), /outside/);
    position = plan.size;
    const close = await executor.previewReduction(journal);
    assert.equal(close.reduceOnly, true);
    const cleanup = await executor.submit(close);
    const result = await executor.reconcile(cleanup);
    assert.equal(result.complete, true);
    assert.deepEqual(result.remainingExposure, []);
    assert.equal(orderCount, 2);
    assert.equal(result.attribution, "builder_fee_fields_only_verify_builder_export");
    const next = await executor.preview("BUY", 15, {kind: "ioc"});
    await executor.submit(next);
    await executor.reconcile(journal); // A prior completed order must not release the current lock.
    const overlapping = await executor.preview("BUY", 15, {kind: "ioc"});
    await assert.rejects(executor.submit(overlapping), /outstanding/);
    assert.equal(orderCount, 3);
  } finally { globalThis.fetch = original; }
});
