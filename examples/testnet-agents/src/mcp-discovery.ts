import assert from "node:assert/strict";

/** Require the trading contract while allowing additive optional capabilities. */
export function assertTradingTools(tools: readonly { name: string }[]): void {
  const names = new Set(tools.map(tool => tool.name));
  for (const name of ["account", "cancel_order", "market", "order_status", "preview_order", "preview_reduction", "reconcile", "submit_order"]) {
    assert(names.has(name), `MCP server omitted required trading tool: ${name}`);
  }
}
