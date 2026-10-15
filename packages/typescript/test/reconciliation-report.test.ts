import assert from "node:assert/strict";
import test from "node:test";
import { GuardedTestnetExecutor, OmniContractError, type RecentReconciliationOptions } from "../src/index.js";

const owner = `0x${"12".repeat(20)}` as `0x${string}`;
type Row = Record<string, unknown>;
const fill = (tid = 1, overrides: Row = {}) => ({coin: "BTC", oid: tid, tid, hash: "0x" + tid.toString(16).padStart(64, "0"),
  time: 1000, side: "B", px: "100000", sz: "0.001", startPosition: "0", dir: "Open Long", closedPnl: "0",
  fee: "0.01", feeToken: "USDC", ...overrides});
const funding = (id = 1, usdc = "-0.02") => ({time: 1000, hash: "0x" + id.toString(16).padStart(64, "0"),
  delta: {type: "funding", coin: "BTC", usdc, szi: "0.001", fundingRate: "0.0001", nSamples: null}});
interface Fixture {
  fills?: (body: Row) => unknown | Promise<unknown>;
  funding?: (body: Row) => unknown | Promise<unknown>;
  snapshot?: Row;
}
async function run(fixture: Fixture, options: Partial<RecentReconciliationOptions> = {}) {
  const original = globalThis.fetch, requests: Row[] = [];
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://api.hyperliquid-testnet.xyz");
    const body = JSON.parse(String(init?.body)) as Row; requests.push(body);
    assert.ok(!String(url).endsWith("/exchange"), "report must never issue exchange writes");
    if (body.type === "meta") return Response.json({universe: [{name: "BTC", szDecimals: 5}]});
    assert.equal(body.user, owner);
    if (body.type === "clearinghouseState") return Response.json(fixture.snapshot ?? {time: 2000, assetPositions: []});
    if (body.type === "userFillsByTime") return Response.json(await fixture.fills?.(body) ?? []);
    if (body.type === "userFunding") return Response.json(await fixture.funding?.(body) ?? []);
    throw new Error("unexpected request");
  };
  try {
    const executor = new GuardedTestnetExecutor({accountAddress: owner, symbol: "BTC", maxNotionalUsd: 15,
      builderFeeTenthsBps: 10, persist: async () => {writes++;}, loadPendingJournals: async () => []});
    const report = await executor.recentReconciliation({startTime: 1000, endTime: 2000, ...options});
    assert.equal(writes, 0);
    return {report, requests};
  } finally {globalThis.fetch = original;}
}
test("signed decimal accounting preserves precision, includes builder once, and separates unrealized PnL", async () => {
  const {report} = await run({
    fills: () => [
      fill(1, {closedPnl: "9007199254740993.123456789012345678", fee: "0.100000000000000001", builderFee: "0.02"}),
      fill(2, {closedPnl: "-9007199254740990", fee: "-0.000000000000000001"}),
      fill(3, {coin: "ETH", closedPnl: "999", fee: "999"}),
    ],
    funding: () => [funding(1, "-0.2"), funding(2, "0.03")],
    snapshot: {time: 2500, assetPositions: [{position: {coin: "BTC", szi: "0.001", unrealizedPnl: "55.1"}}]},
  }, {expectedOrderIds: [1, 99]});
  assert.equal(report.totals.closedPnlUsdc, "3.123456789012345678");
  assert.equal(report.totals.feesByToken.USDC, "0.1");
  assert.equal(report.totals.builderFeesIncludedByToken.USDC, "0.02");
  assert.equal(report.totals.fundingNetUsdc, "-0.17");
  assert.equal(report.totals.realizedNetCashPnlUsdc, "2.853456789012345678");
  assert.equal(report.snapshot.position?.unrealizedPnl, "55.1");
  assert.deepEqual(report.expectedOrders, {requested: [1,99], observed: [1], missing: [99]});
  assert.equal(report.coverage.fills.accountRowsObserved, 3);
  assert.equal(report.fullLedgerReconciled, false);
  assert.equal(report.coverage.fills.retentionVerified, false);
});
test("non-USDC fees remain separate and prevent unsupported USD conversion", async () => {
  const {report} = await run({fills: () => [fill(1, {feeToken: "HYPE", fee: "0.0001", builderFee: "0.00001"})]});
  assert.equal(report.totals.realizedNetCashPnlUsdc, null);
  assert.equal(report.totals.netCashPnlUnavailableReason, "non_usdc_fees");
  assert.equal(report.totals.feesByToken.HYPE, "0.0001");
});
test("raw account saturation is split before instrument filtering; duplicate parent/child rows count once", async () => {
  const all = Array.from({length: 501}, (_, i) => fill(i + 1, {time: 1000+i, coin: i === 500 ? "BTC" : "ETH"}));
  const {report, requests} = await run({fills: body => all.filter(row => row.time >= Number(body.startTime) && row.time <= Number(body.endTime)).slice(0,500)});
  assert.equal(report.fills.length, 1);
  assert.equal(report.fills[0]?.tid, 501);
  assert.equal(report.coverage.fills.accountRowsObserved, 501);
  assert.equal(report.coverage.fills.requestedWindowFetched, true);
  assert.ok(report.coverage.fills.requests > 1);
  assert.ok(requests.every(row => row.type !== "userFillsByTime" || row.aggregateByTime === false));
});
test("same-millisecond saturation and request budgets explicitly preserve coverage gaps", async () => {
  const all = Array.from({length: 500}, (_,i) => fill(i+1));
  const tied = (await run({fills: () => all}, {startTime:1000,endTime:1000})).report;
  assert.equal(tied.coverage.fills.requestedWindowFetched, false);
  assert.equal(tied.coverage.fills.gaps[0]?.reason, "same_timestamp_saturation");
  const limited = await run({fills: () => all}, {maxRequests:4});
  assert.equal(limited.report.coverage.fills.requestedWindowFetched, false);
  assert.equal(limited.report.coverage.fills.gaps[0]?.reason, "request_budget_exhausted");
  assert.equal(limited.requests.length, 4);
});
test("identical rows deduplicate; conflicting fill and funding identities fail closed", async () => {
  const {report} = await run({fills: () => [fill(),fill()], funding: () => [funding(),funding()]});
  assert.equal(report.fills.length, 1);
  assert.equal(report.funding.length, 1);
  await assert.rejects(run({fills: () => [fill(),fill(1,{fee:"2"})]}), OmniContractError);
  const conflict = funding(); conflict.delta.usdc = "2";
  await assert.rejects(run({funding: () => [funding(), conflict]}), OmniContractError);
});
test("malformed decimals/out-of-window rows and invalid bounds fail before misleading totals", async () => {
  await assert.rejects(run({fills: () => [fill(1,{fee:"1e-3"})]}), OmniContractError);
  await assert.rejects(run({fills: () => [fill(1,{time:999})]}), OmniContractError);
  await assert.rejects(run({}, {endTime:Date.now()+100000}), RangeError);
  await assert.rejects(run({}, {maxRequests:3}), RangeError);
  await assert.rejects(run({}, {expectedOrderIds:[1,1]}), RangeError);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run({}, {signal:controller.signal}), {name:"AbortError"});
});
test("upstream errors are redacted and return explicit source gaps", async () => {
  const {report} = await run({fills: () => {throw new Error("sensitive-proof-marker");}});
  assert.equal(report.coverage.fills.gaps[0]?.reason, "request_failed");
  assert.equal(report.coverage.funding.requestedWindowFetched, true);
  assert.ok(!JSON.stringify(report).includes("sensitive-proof-marker"));
});


test("whole-report deadline bounds a page adapter that ignores cancellation", async () => {
  const keepAlive = setTimeout(() => {}, 1000), started = Date.now();
  try {
    const {report} = await run({fills: () => new Promise(() => {})}, {timeoutMs: 20});
    assert.ok(Date.now() - started < 500);
    assert.equal(report.coverage.fills.gaps[0]?.reason, "deadline_exceeded");
    assert.equal(report.coverage.funding.gaps[0]?.reason, "deadline_exceeded");
  } finally {clearTimeout(keepAlive);}
});
test("whole-report deadline bounds stalled scope reads and external cancel stops stalled pages", async () => {
  const original = globalThis.fetch, keepAlive = setTimeout(() => {}, 1000);
  try {
    globalThis.fetch = () => new Promise(() => {});
    const executor = new GuardedTestnetExecutor({accountAddress: owner, symbol: "BTC", maxNotionalUsd: 10, builderFeeTenthsBps: 10, persist: async () => {}, loadPendingJournals: async () => []});
    await assert.rejects(executor.recentReconciliation({startTime:1000,endTime:2000,timeoutMs:20}), OmniContractError);
  } finally {globalThis.fetch = original;clearTimeout(keepAlive);}
  const controller = new AbortController(), abort = setTimeout(() => controller.abort("unsafe-secret-reason"), 20);
  try {
    await assert.rejects(run({fills: () => new Promise(() => {})}, {signal: controller.signal}), error => {
      assert.equal((error as Error).name, "AbortError");
      assert.ok(!String(error).includes("unsafe-secret-reason")); return true;
    });
  } finally {clearTimeout(abort);}
});

