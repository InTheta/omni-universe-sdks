/** Free deployed integration: no wallet, proof, payment approval, or execution capability. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OmniMcpClient } from "@omni-terminal/sdk";

const endpoint = new URL(process.env.OMNI_MCP_URL ?? "https://omniterminal.app/api/x402/mcp");
if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1") throw new Error("MCP integration requires HTTPS or local loopback");
const expected = ["get_market_catalog", "get_market_moving_events", "get_market_risk_context", "resolve_market_entities", "get_market_carry", "get_premarket_roundup"];
const evidence: Record<string, unknown> = { environment: endpoint.origin, observedAt: new Date().toISOString(), mode: "integration-tested", spentUsd: 0, checks: [] };
const checks = evidence.checks as string[];
const sdk = new OmniMcpClient({ url: endpoint.href, approvePayment: () => { throw new Error("Payment forbidden in interoperability check"); } });
try {
  await sdk.connect();
  const tools = await sdk.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), [...expected].sort());
  for (const tool of tools.tools) assert.equal(tool.inputSchema.type, "object");
  checks.push("public_sdk_negotiation_tool_list_input_schemas");
  const catalog = (await sdk.catalogData()).data;
  assert.equal(catalog.service, "omni-market-intelligence");
  assert.equal(catalog.tools.length, 5);
  assert(catalog.tools.every(t => /^\$\d+(\.\d+)?$/.test(t.price)));
  evidence.catalog = catalog;
  checks.push("public_sdk_free_catalog_parsed");
} finally { await sdk.close(); }

for (let pass = 0; pass < 2; pass++) {
  const client = new Client({ name: "omni-mcp-interoperability", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint);
  try {
    await client.connect(transport, { timeout: 15_000 });
    const tools = await client.listTools({}, { timeout: 15_000 });
    assert.equal(tools.tools.length, expected.length);
    const result = await client.callTool({ name: "get_market_catalog", arguments: {} }, undefined, { timeout: 15_000 });
    assert.notEqual(result.isError, true);
    assert.equal((result.structuredContent as Record<string, unknown>)?.service, "omni-market-intelligence");
    checks.push(`official_client_reconnect_${pass}_structured_catalog`);
    const invalid = await client.callTool({ name: "get_market_carry", arguments: { symbol: "DOES_NOT_EXIST" } }, undefined, { timeout: 15_000 });
    assert.equal(invalid.isError, true);
    assert(!JSON.stringify(invalid).includes("payment-signature"));
    checks.push(`invalid_instrument_rejected_before_payment_${pass}`);
    const challenge = await client.callTool({ name: "get_market_carry", arguments: { symbol: "BTC" } }, undefined, { timeout: 15_000 });
    assert.equal(challenge.isError, true);
    const serialized = JSON.stringify(challenge);
    assert(serialized.includes("accepts") && serialized.includes("8453"));
    checks.push(`unpaid_tool_returns_payment_requirements_${pass}`);
    await assert.rejects(client.callTool({ name: "get_market_catalog", arguments: {} }, undefined, { signal: AbortSignal.abort(), timeout: 15_000 }));
    checks.push(`client_cancellation_rejected_${pass}`);
  } finally { await client.close(); }
}
console.log(JSON.stringify(evidence, null, 2));
