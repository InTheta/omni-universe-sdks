# Research and payment recovery agents

For v0.8.3 installed-package commands requiring no development dependencies, use [installed SDK quickstarts](installed-quickstarts.md). The source-checkout commands below require `npm ci && npm run build` in `packages/typescript`. Historical v0.8.0 does not contain these APIs.

## Free real research agent

Prerequisites: Node >=22.12, install dependencies with `npm ci` in `packages/typescript`, then `npm run build`. From that directory:

```sh
RESEARCH_SYMBOL=BTC node dist-examples/agents/research-readonly.js --free-only
```

This uses only public SDK imports. It resolves the exact active Hyperliquid perpetual, checks book identity/time, connects the actual Omni MCP server, reads its free structured catalog, and inspects the exact HTTP x402 research challenge without signing. The structured output reports both networks, token, receiver, atomic price, market metadata and bid/ask. Account scope is `not_requested` unless an exact public `RESEARCH_ACCOUNT=0x...` is supplied. There is no personal-account or alternate-instrument fallback. Account reads do not grant trading rights.

The free path has zero paid usage and no LLM call. It leaves paid research assessment null rather than fabricating a data purchase. Live read-only integration was verified on 15 October 2026; live market values change on each run.

## One approved testnet research purchase

Do not execute this until the human approves **one 0.010 test-USDC Market Risk request on Base Sepolia**, and funds a dedicated test payer. This path is prepared but not funded-tested in the October 15 run.

```sh
RESEARCH_SYMBOL=BTC RUN_PAID_RESEARCH=true \
CONFIRM_RESEARCH_TESTNET_BUDGET='0.010 USDC ON BASE SEPOLIA' \
node --env-file=.env dist-examples/agents/research-readonly.js
```

The protected local `.env` supplies `EVM_PRIVATE_KEY`; never commit or print it. Direct EVM signing stays in the caller process. A separately hosted ACM payer can instead enforce custody/policy, but x402 buying does not grant trading permission. No API/MCP server needs this private key. The one-request authorization and aggregate ceiling are both 0.010. The receiver defaults to Omni and the only allowed network is Base Sepolia. The exact symbol and URL remain fixed by code, not retrieved headlines. Seller settlement metadata is validated; independently reconcile its transaction on the correct chain for authoritative proof.

## Deterministic recovery runners

The unsigned lifecycle runner is included in the archive:

```sh
node dist-examples/agents/lifecycle-recovery.js
```

The payment-policy fixture below creates and discards a local signature using a public deterministic fixture key; it makes no remote payment. Its regression test command is **source-only** (`test/` is omitted from the archive):

```sh
node dist-examples/agents/payment-recovery.js
node --import tsx --test test/x402-hardening.test.ts test/bundle-budget.test.ts
```

This deliberately uses local fixtures, not a live facilitator: wrong recipient, invalid expiry, request and aggregate budgets, concurrent authorization, lost response, same-operation replay, and rate-limit errors. It emits `mock-tested`, zero spend, and discards fixture signatures. Trading partial fills and insufficient-margin cases are exercised separately by the guarded lifecycle runner.

`createEvmPaymentClient` defaults to Omni's receiver. Custom sellers now require explicit `allowedPayees`. `maxTotalPaymentUsd` is optional for compatibility; set it for every bounded agent. Reservations occur synchronously before signing and are never automatically freed following uncertain outcomes. This is an instance-local authorization ceiling, not a durable accounting ledger or exactly-once settlement guarantee. Share one client across concurrent HTTP calls; do not create a replacement client to escape an exhausted limit. MCP accepts the same ceiling/recipient options.

`OmniX402Client.inspectPayment(method, path, options)` is always unsigned, even with a configured payer. Health requests are also unsigned. `OmniMcpClient` supports `timeoutMs` plus cancellation on `connect`, `listTools`, `callTool` and `callJsonTool`. Cancellation after signing may leave an uncertain charge; inspect receipt and audit state before any newly authorized request. Reused, expired, or mismatched proofs at a live facilitator require a separately approved paid test; these fixtures do not prove facilitator rejection semantics.

`decideFromMarketRisk` returns HOLD for non-fresh components, missing funding and invalid numeric evidence. Its result is research only. Retrieved content cannot amend grants, account scope, recipient, budget, builder-fee limits, or execution policy.
