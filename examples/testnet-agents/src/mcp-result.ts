/** MCP trading operations retain plan identity around the SDK result. */
export function reconciliationResult(value: unknown): { complete: boolean; fills?: unknown[]; remainingExposure?: unknown[] } {
  const result = (value as { result?: unknown } | null)?.result;
  if (!result || typeof result !== "object" || typeof (result as { complete?: unknown }).complete !== "boolean") {
    throw new Error("MCP_RECONCILIATION_SCHEMA_MISMATCH: preserve the journal and reconcile; never resubmit");
  }
  return result as { complete: boolean; fills?: unknown[]; remainingExposure?: unknown[] };
}
