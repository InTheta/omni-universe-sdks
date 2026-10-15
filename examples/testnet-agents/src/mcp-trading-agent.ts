import assert from "node:assert/strict";
import { reconciliationResult } from "./mcp-result.js";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execute = process.argv.includes("--execute");
const ioc = process.argv.includes("--ioc");
const recover = process.argv.includes("--recover");
const recoverPlanId = process.env.MCP_RECOVER_PLAN_ID;
if (recover && (!execute || !recoverPlanId || !/^[0-9a-f-]{36}$/i.test(recoverPlanId))) throw new Error("Recovery requires --execute, --recover and original MCP_RECOVER_PLAN_ID");
const permissionCheck = process.argv.includes("--permission-check");
if (permissionCheck && (execute || process.env.RUN_TESTNET_MCP_TRADING === "true")) throw new Error("Permission probe requires execution disabled");
if (execute && process.env.RUN_TESTNET_MCP_TRADING !== "true") throw new Error("RUN_TESTNET_MCP_TRADING=true is required for execution");
if (ioc && process.env.TESTNET_ALLOW_TAKER !== "true") throw new Error("TESTNET_ALLOW_TAKER=true is required for IOC and reduce-only cleanup");
const client = new Client({ name: "omni-guarded-mcp-agent", version: "0.1.0" });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", fileURLToPath(new URL("./mcp-trading-server.ts", import.meta.url))], env, stderr: "inherit" });
const evidence: Record<string, unknown> = { observedAt: new Date().toISOString(), network: "hyperliquid-testnet", mode: "integration-tested", lifecycle: ioc ? "ioc_fill_reduce_only_cleanup" : "passive_cancel", realFundsSpent: 0, executionRequested: execute };
const attempted: string[] = [];
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  if (result.isError) throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.structuredContent)}`);
  const data = result.structuredContent as { data?: unknown } | undefined;
  assert(data && Object.hasOwn(data, "data"), "Tool omitted structured data");
  return data.data;
};
try {
  await client.connect(transport, { timeout: 15_000 });
  const tools = await client.listTools({}, { timeout: 15_000 });
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ["account", "cancel_order", "market", "order_status", "preview_order", "preview_reduction", "reconcile", "submit_order"].sort());
  evidence.tools = tools.tools.map(t => t.name);
  if (recover && recoverPlanId) {
    attempted.push(recoverPlanId);
    evidence.recoveredPlanId = recoverPlanId;
    evidence.cancellation = await call("cancel_order", { planId: recoverPlanId });
    const recovered = await call("reconcile", { planId: recoverPlanId });
    evidence.reconciliation = recovered;
    assert.equal(reconciliationResult(recovered).complete, true, "Recovered outcome remains uncertain; preserve journal and reconcile");
  } else {
  evidence.market = await call("market");
  evidence.account = await call("account");
  const preview = await call("preview_order", { side: "BUY", notionalUsd: Number(process.env.TESTNET_MAX_NOTIONAL_USD ?? "15"), kind: ioc ? "ioc" : "passive" }) as { planId: string; plan: unknown };
  const planId = preview.planId;
  evidence.preview = preview;
  if (permissionCheck) {
    const denied = await client.callTool({ name: "submit_order", arguments: { planId } }, undefined, { timeout: 30_000 });
    assert.equal(denied.isError, true);
    assert(JSON.stringify(denied.structuredContent).includes("TESTNET_EXECUTION_DISABLED"));
    evidence.permissionDenied = denied.structuredContent;
  }
  if (execute) {
    attempted.push(planId);
    evidence.submission = await call("submit_order", { planId });
    evidence.status = await call("order_status", { planId });
    evidence.cancellation = await call("cancel_order", { planId });
    const reconciliation = await call("reconcile", { planId });
    evidence.reconciliation = reconciliation;
    const reconciled = reconciliationResult(reconciliation);
    assert.equal(reconciled.complete, true, "Opening outcome remains uncertain; do not resubmit");
    if (ioc) {
      assert(reconciled.fills?.length, "IOC had no fills; full filled lifecycle remains unverified");
      const reduction = await call("preview_reduction", { planId }) as { planId: string; plan: unknown };
      evidence.reductionPreview = reduction;
      attempted.push(reduction.planId);
      evidence.reductionSubmission = await call("submit_order", { planId: reduction.planId });
      evidence.reductionCancel = await call("cancel_order", { planId: reduction.planId });
      const finalReconciliation = await call("reconcile", { planId: reduction.planId });
      evidence.finalReconciliation = finalReconciliation;
      const final = reconciliationResult(finalReconciliation);
      assert.equal(final.complete, true);
      assert(final.fills?.length, "Reduction had no fills; cleanup unverified");
      assert.equal(final.remainingExposure?.length, 0, "Unexpected remaining exposure: operator reconciliation required");
    }
    evidence.mode = "sandbox-executed";
  }
  }
} finally {
  const cleanup: unknown[] = [];
  for (const planId of [...attempted].reverse()) {
    // Reconcile the SAME cloid even if a response was lost. Never issue another submit.
    try { cleanup.push({ planId, result: await call("cancel_order", { planId }) }); }
    catch (error) { cleanup.push({ planId, error: error instanceof Error ? error.message : "cleanup_failed" }); }
  }
  evidence.cleanup = cleanup;
  await client.close();
  console.log(JSON.stringify(evidence, null, 2));
}
