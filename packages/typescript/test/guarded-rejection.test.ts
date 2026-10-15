import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { GuardedTestnetExecutor } from "../src/index.js";

test("known exchange rejection is terminal and persisted, not an uncertain order", async () => {
  const original = globalThis.fetch;
  const wallet = privateKeyToAccount(generatePrivateKey());
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/exchange")) { writes++; return Response.json({status: "ok", response: { type: "order", data: {statuses: [{error: "Insufficient margin PAYMENT-SIGNATURE fixture-private-proof"}]}}}); }
    return Response.json(({metaAndAssetCtxs: [{universe: [{name: "BTC", szDecimals: 5}]}, [{}]], l2Book: {coin: "BTC", time: Date.now(), levels: [[{px: "100000"}], [{px: "100010"}]]}, clearinghouseState: {withdrawable: "100", assetPositions: []}, maxBuilderFee: 25, openOrders: []} as Record<string, unknown>)[body.type]);
  };
  try {
    const stored: unknown[] = [];
    const executor = new GuardedTestnetExecutor({accountAddress: wallet.address, symbol: "BTC", maxNotionalUsd: 15, builderFeeTenthsBps: 25, signer: wallet, enabled: true, persist: async journal => {stored.push(journal);}, loadPendingJournals: async () => []});
    const plan = await executor.preview("BUY", 15);
    const journal = await executor.submit(plan);
    assert.equal(journal.stage, "rejected");
    assert.equal(journal.rejection, "VENUE_ORDER_REJECTED");
    assert.equal((await executor.reconcile(journal)).complete, true);
    assert.equal((await executor.cancel(journal)).complete, true);
    assert.equal(writes, 1);
    await assert.rejects(executor.submit(plan), /outstanding/);
    assert.equal(stored.length, 2);
    assert.doesNotMatch(JSON.stringify(stored), /fixture-private-proof|PAYMENT-SIGNATURE/);
  } finally { globalThis.fetch = original; }
});
