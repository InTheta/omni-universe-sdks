# House disclosure filing extension (GH236)

This source-only extension is additive to SDK ceabef24bc2c2f5f4cd207fe67d5b4a3b21560fd. It does not change the frozen SDK17 branch or publish a package/version. Corresponding server family requires new owner-reviewed deployment and paid qualification; calling a new source method is not proof that the live route exists.

```ts
const first = await x402.congressFiling("20035689", { limit: 1 });
const next = first.data.pagination.next_offset;
if (next !== null) {
  const second = await x402.congressFiling("20035689", {
    limit: 1, offset: next, public_revision: first.data.public_revision,
  });
}
const mcpResult = await mcp.congressFilingData("20035689", { limit: 1 });
```

The paid REST recipe uses `/api/x402/v1/congress-filings/:doc_id`; MCP uses `get_congress_filing`. Service is `omni.public_congress_filing`, schema `public_congress_filing.v1`, collection `rows`. The new server default quote is $0.005 USDC per independently authorized call. Existing buyer authority, approval and total/per-call ceilings still apply; the example does not authorize payments or automatically retry failures.

Supply an official House document ID (1–12 ASCII digits). No arbitrary Redis keys, URLs or global filing discovery. Query allowlist: `limit`1..20 (default20), `offset`0..499 (default0), optional `public_revision`64lowercasehex. Invalid/private/unknown parameters fail before transport. A public revision binds pagination to the sanitized source document, excluding parser observation/private delivery metadata. Server wiring must verify it before payment and reuse a request-local source snapshot. A changed document requires a deliberate new read, not silently mixing pages.

Response guards enforce requested document/revision, exact official HTTPS House PDF URL, historical date precision and page/row contract. Malformed paid REST/MCP results produce a redacted contract error with `requiresReconciliation=true`, `retryable=false` and `paymentOutcome=unconfirmed`; these flags are conservative recovery metadata, not proof of settlement. Reconcile before another authorization.

Transaction, notification and disclosure dates are separate original calendar dates. `parsed_at` is a parser observation, not publication time. Amounts remain reported USD RANGE/string, not midpoint, size or execution value. Unresolved tickers and non-equity assets remain explicit. A ticker reported on a PDF does not prove a canonical tradable market; joint/spouse/dependent owner codes do not identify a wallet or execution.

Only cached successfully recognized House parser rows qualify. `parser_completed=true` does not prove that every PDF row was parsed; document/global/amendment completeness remains unknown. Source poll freshness is unknown and response status is historical. Senate, archive exhaustiveness, amendments reconciliation, politician portfolios and fresh-market-news claims are unqualified.

Focused check: `node --import tsx --test test/congress-filing.test.ts`. The four tests exercise paid REST identity/query transport, MCP schema/recipe, zero-transport invalid requests and malformed paid-result reconciliation. No production, public-ingress or funded delivery acceptance is implied.
