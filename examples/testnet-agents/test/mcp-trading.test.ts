import test from "node:test";
import { reconciliationResult } from "../src/mcp-result.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGuardedTradingMcpServer, type TradingExecutor } from "../src/mcp-trading.js";

async function session(path: string, uncertain = false, hold?: Promise<void>, recent?: TradingExecutor["recentReconciliation"]) {
  let submits = 0;
  const server = createGuardedTradingMcpServer(persist => ({
    ...(recent ? { recentReconciliation: recent } : {}),
    async market() { return { symbol: "EXACT", network: "hyperliquid-testnet" }; },
    async account() { return { accountAddress: "fixed_test_account", withdrawable: "100" }; },
    async preview(side, notionalUsd) { return { side, notionalUsd, cloid: "0x" + Date.now().toString(16).padStart(32, "0"), network: "hyperliquid-testnet", accountAddress: "0x" + "1".repeat(40), symbol: "EXACT", asset: 0, price: "100", size: "0.15", createdAt: Date.now(), expiresAt: Date.now() + 15000, tif: "Alo", reduceOnly: false, builder: { b: "0x" + "2".repeat(40), f: 10 } }; },
    async submit(plan: unknown) { submits++; const journal = { plan, stage: "submitting", startedAt: Date.now() }; await persist(journal); await hold; if (uncertain) throw new Error("lost_response"); return journal; },
    async status() { return { status: "open" }; },
    async cancel() { return { complete: true, status: { status: "order", order: { status: "canceled", order: { coin: "EXACT", oid: 1 } } } }; },
    async reconcile() { return { complete: true, status: { status: "order", order: { status: "canceled", order: { coin: "EXACT", oid: 1 } } } }; },
  } satisfies TradingExecutor), path);
  const client = new Client({ name: "mcp-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { client, server, call, submits: () => submits };
}
const path = () => join(mkdtempSync(join(tmpdir(), "codex-test-mcp-ledger-")), "journal.json");
function data(result: unknown) { return (result as { structuredContent: { data: Record<string, unknown> } }).structuredContent.data; }

test("actual MCP discovery validates schema and fixes policy scope outside tool inputs", async () => {
  const s = await session(path());
  try {
    const tools = (await s.client.listTools()).tools;
    assert.equal(tools.length, 8);
    for (const tool of tools) assert(!JSON.stringify(tool.inputSchema).match(/privateKey|accountAddress|network|builder/));
    const invalid = await s.call("preview_order", { side: "UNKNOWN", notionalUsd: 15 });
    assert.equal(invalid.isError, true);
    const over = await s.call("preview_order", { side: "BUY", notionalUsd: 26 });
    assert.equal(over.isError, true);
    assert.equal(s.submits(), 0);
  } finally { await s.client.close(); await s.server.close(); }
});

test("one-use plan, durable private journal, known-scope status/cancel/reconcile", async () => {
  const journalPath = path();
  const s = await session(journalPath);
  try {
    const planId = data(await s.call("preview_order", { side: "BUY", notionalUsd: 15 })).planId as string;
    assert.equal((await s.call("submit_order", { planId })).isError, undefined);
    assert.equal((await s.call("submit_order", { planId })).isError, true);
    assert.equal(s.submits(), 1);
    assert.equal(data(await s.call("order_status", { planId })).result && true, true);
    assert.equal((await s.call("cancel_order", { planId })).isError, undefined);
    const reconciled = await s.call("reconcile", { planId });
    assert.equal(reconciled.isError, undefined);
    assert.equal(reconciliationResult(data(reconciled)).complete, true);
    assert.throws(() => reconciliationResult({ complete: true }), /SCHEMA_MISMATCH/);
    assert.equal(reconciliationResult({ planId, result: { complete: false } }).complete, false);
    assert.equal(statSync(journalPath).mode & 0o077, 0);
    assert.equal(JSON.parse(readFileSync(journalPath, "utf8")).entries[0].state, "submitted");
    const second = data(await s.call("preview_order", { side: "SELL", notionalUsd: 15 })).planId as string;
    assert.equal((await s.call("submit_order", { planId: second })).isError, true);
    assert.equal(s.submits(), 1);
  } finally { await s.client.close(); await s.server.close(); }
});

test("uncertain submit persists before network, survives reconnect, and only reconciles same plan", async () => {
  const journalPath = path();
  const first = await session(journalPath, true);
  const planId = data(await first.call("preview_order", { side: "BUY", notionalUsd: 15 })).planId as string;
  assert.equal((await first.call("submit_order", { planId })).isError, true);
  assert.equal(first.submits(), 1);
  await first.client.close(); await first.server.close();
  const second = await session(journalPath);
  try {
    assert.equal((await second.call("submit_order", { planId })).isError, true);
    assert.equal((await second.call("cancel_order", { planId })).isError, undefined);
    assert.equal((await second.call("reconcile", { planId })).isError, undefined);
    assert.equal(second.submits(), 0);
  } finally { await second.client.close(); await second.server.close(); }
});


test("a second process/session cannot reuse a locked ledger", async () => {
  const journalPath = path();
  const first = await session(journalPath);
  try { await assert.rejects(session(journalPath), /EEXIST/); }
  finally { await first.client.close(); await first.server.close(); }
  const reopened = await session(journalPath);
  await reopened.client.close(); await reopened.server.close();
});


test("MCP timeout cannot duplicate an in-flight submission; same-plan reconciliation remains available", async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const s = await session(path(), false, hold);
  try {
    const planId = data(await s.call("preview_order", { side: "BUY", notionalUsd: 15 })).planId as string;
    await assert.rejects(s.client.callTool({ name: "submit_order", arguments: { planId } }, undefined, { timeout: 20 }));
    const duplicate = await s.call("submit_order", { planId });
    assert.equal(duplicate.isError, true);
    assert.match(JSON.stringify(duplicate.structuredContent), /operation_in_progress/);
    assert.equal(s.submits(), 1);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await s.call("cancel_order", { planId })).isError, undefined);
    assert.equal(s.submits(), 1);
  } finally { release(); await s.client.close(); await s.server.close(); }
});

test("read-only reconciliation tool keeps account policy outside inputs and returns explicit coverage", async () => {
  let calls = 0;
  const coverage = { requests: 1, accountRowsObserved: 0, instrumentRowsObserved: 0, requestedWindowFetched: true, retentionVerified: false, gaps: [] };
  const s = await session(path(), false, undefined, async options => {
    calls++;
    assert.equal(options.maxRequests, 12);
    assert.ok(options.signal instanceof AbortSignal);
    return { schema: "omni.hyperliquid_recent_reconciliation.v1", network: "hyperliquid-testnet", accountAddress: "0x" + "1".repeat(40), symbol: "EXACT", observedAt: 100,
      window: { startTime: options.startTime, endTime: options.endTime, inclusive: true }, fullLedgerReconciled: false, fills: [], funding: [],
      expectedOrders: { requested: [7], observed: [], missing: [7] }, totals: { scope: "observed_instrument_period", closedPnlUsdc: "0", fundingNetUsdc: "0", feesByToken: {}, builderFeesIncludedByToken: {}, realizedNetCashPnlUsdc: "0", netCashPnlUnavailableReason: null },
      snapshot: { observedAt: 100, venueTime: 100, position: null }, coverage: { fills: coverage, funding: coverage },
      limits: { conservativePageThreshold: 500, fillRetention: "latest_10000_fills", builderCredit: "unverified", fundingAttribution: "account_instrument_period_not_order" } };
  });
  try {
    const tool = (await s.client.listTools()).tools.find(tool => tool.name === "recent_reconciliation")!;
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert(!JSON.stringify(tool.inputSchema).match(/accountAddress|network|builder|privateKey/));
    const invalid = await s.call("recent_reconciliation", { startTime: 0, endTime: 100, maxRequests: 17 });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 0);
    const response = await s.call("recent_reconciliation", { startTime: 0, endTime: 100, expectedOrderIds: [7] });
    assert.equal(response.isError, undefined);
    assert.equal(data(response).fullLedgerReconciled, false);
    assert.equal(calls, 1);
    assert.equal(s.submits(), 0);
  } finally { await s.client.close(); await s.server.close(); }
});
