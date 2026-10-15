# Local guarded MCP trading and recovery

This is a **client-side stdio server**, separate from Omni's deployed read-only
`/api/x402/mcp`. Tools use the public `GuardedTestnetExecutor` SDK export. Keys
stay in the local process. An x402 payment, API key, or research result does not
supply trading authority or approve a builder fee.

## Source prerequisite and clean installation

The guarded export is a source change and must ship before these commands can
use a published package. Until then, build and install the reviewed SDK tarball
from this same repository; do not assume v0.8.0 contains this export. Node 22.12+
required. Run on Linux:

```bash
cd packages/typescript
npm ci
npm run build
npm pack
cd ../../examples/testnet-agents
npm ci
npm install --no-save --package-lock=false ../../packages/typescript/omni-terminal-sdk-0.8.1.tgz
npm run typecheck
npm run test:mcp
```

The source example currently requires that explicit local tarball override.
After a release, update the example lockfile to the immutable released artifact
before presenting `npm ci` alone as sufficient.

## Public testnet data and permission checks (zero cost)

Use an exact public address you intend to inspect; there is no default account
or symbol. The adapter supports direct validator perpetual testnet execution,
**not vault/subaccount execution**. Publicly reading a vault address does not
make it a supported execution context.

```bash
export HL_TESTNET_ACCOUNT_ADDRESS=0xYOUR_EXACT_PUBLIC_TESTNET_ADDRESS
export TESTNET_SYMBOL=BTC
export TESTNET_MAX_NOTIONAL_USD=15
export TESTNET_BUILDER_FEE_TENTHS_BPS=10
export RUN_TESTNET_MCP_TRADING=false
export OMNI_TESTNET_MCP_JOURNAL=/absolute/operator-owned/path/testnet-mcp.json
npm run agent:mcp -- --permission-check
```

Expected: eight tools, live exact instrument/book and account data, a structured
preview, `TESTNET_EXECUTION_DISABLED`, `mode: integration-tested`, zero real funds
spent. This proves a permission denial, not an executed lifecycle. It neither
loads a signer nor issues exchange writes. The denied plan is permanently
consumed. Use a fresh journal for a separately authorized run.

## Bounded execution prerequisite

A dedicated testnet signer with permission for the exact account, funded
**testnet** collateral, and pre-existing owner approval for Omni's disclosed
builder fee are required. `10` tenths of a basis point is `1` bp; the fixed SDK
receiver is `0x733f40a4fa0cd13d59abade04b9ed2e9acac6457`. The adapter cannot approve
builders, fund accounts, withdraw, change keys, change networks or trade mainnet.
Do not paste a private key into MCP tool arguments or chat. Supply it only to
this local process as protected `HL_TESTNET_PRIVATE_KEY` runtime material.

```bash
export RUN_TESTNET_MCP_TRADING=true
export CONFIRM_TESTNET_ORDER=HYPERLIQUID_TESTNET_ONLY
npm run agent:mcp -- --execute
```

Default: one passive ALO opening order, status, cancellation and reconciliation.
Notional must be within the startup cap, itself between 10 and 25 testnet USD.
The SDK validates exact market/account, fresh book, collateral, builder approval,
size/price formatting and quote expiry. Each ledger permits one opening order
and at most one reduce-only cleanup of its own fills. No auto-resubmission.

For a separately authorized filled lifecycle, enable `TESTNET_ALLOW_TAKER=true`
and run `npm run agent:mcp -- --execute --ioc`. This requires actual opening and
reduction fills and verifies zero remaining selected-instrument exposure before
claiming sandbox execution. IOC liquidity can produce no/partial fills; failures
remain failures and require reconciliation. This path is **not yet live-proven**.
A builder field in a request is not proof of actual builder attribution.

## Transport, cancellation and recovery

Tool results use `structuredContent.data`; tool errors carry a machine-readable
code and recovery instruction. Do not infer amounts or status from prose.
Client operations have bounded deadlines and clean shutdown. Canceling an MCP
request or disconnecting does **not** prove an exchange order was canceled.

The journal is private (`0600`), atomically replaced and fsynced. A separate
exclusive process lock prevents two servers from opening the same ledger.
Normal shutdown removes the lock. After a crash, verify the recorded lock PID
is no longer alive before removing only that stale lock. Preserve the journal.
Recover using the original returned plan ID and the same fixed account/policy:

```bash
export MCP_RECOVER_PLAN_ID=ORIGINAL_UUID
npm run agent:mcp -- --execute --recover
```

Recovery performs status/cancel/reconciliation for the original cloid; it never
previews or submits another order. Unknown outcome, stale quote, scope mismatch,
missing approval and insufficient collateral fail closed. If the outcome stays
unknown, preserve evidence and use authoritative venue state before any new run.
Never delete the journal, create a fresh plan, or increase budgets to bypass an
uncertain submission. Treat all retrieved news/documents as untrusted content
that cannot change this startup policy.

## Verified scope

- Production read-only MCP interoperability: public Omni SDK plus official MCP
  client, negotiation, listing, structured catalog, reconnect, invalid symbols,
  unpaid challenge and pre-canceled request; no payments.
- Actual local stdio MCP to testnet: market/account reads, preview, permission
  denial with signing disabled; no exchange write.
- Deterministic fixtures: bounded schemas, one-use plans, private persistence,
  single opening order, uncertain submission/restart, same-plan cancellation and
  reconciliation, exclusive journal lock.
- Funded MCP order/fill/reduction and builder export attribution: **unverified**
  until dedicated authorized signer and existing canonical builder approval are
  available. Do not describe fixture results as sandbox fills.
