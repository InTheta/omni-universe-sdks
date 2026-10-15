# Recent testnet execution, fee and funding reconciliation

This source-only capability is not present in the existing published v0.8.0 SDK.
Use the reviewed source tarball until a release explicitly includes
`GuardedTestnetExecutor.recentReconciliation`. Run on Linux with Node 22.12+:

```sh
cd packages/typescript
npm ci
npm run build
npm pack
```

For a clean package-boundary check, run `npm init -y` in a new directory, install
the generated tarball using its absolute path, then import only from
`@omni-terminal/sdk`. The included runnable example is
`examples/agents/reconciliation-readonly.ts`.

## First free report

Choose the exact owning testnet account and validator perpetual symbol. An agent
signer's address is not the owning account. Reading an address does not prove
ownership or trading authority. This method never loads a key, signs, pays for
data, approves builders, places orders or touches mainnet.

```sh
export HL_TESTNET_ACCOUNT_ADDRESS=0xYOUR_EXACT_PUBLIC_TESTNET_ACCOUNT
export TESTNET_SYMBOL=BTC
export RECONCILIATION_END_MS=$(node -e 'process.stdout.write(String(Date.now()))')
export RECONCILIATION_START_MS=$(node -e 'process.stdout.write(String(Number(process.env.RECONCILIATION_END_MS)-3600000))')
npm run example:reconciliation:free
```

Expected: JSON with `mode: live-read-only`, `paidUsageUsdc: 0`, exact account,
symbol and `hyperliquid-testnet`. Fills and funding may legitimately be empty.
The frozen inclusive time window must end in the past and span at most seven
days. The report contains current position and unrealized PnL as a separately
dated snapshot; it is not an end-of-window balance reconstruction.

```ts
import { GuardedTestnetExecutor } from "@omni-terminal/sdk";
// Use the same exact fixed account/symbol policy as the public example.
const report = await executor.recentReconciliation({
  startTime, endTime, maxRequests: 12, timeoutMs: 20_000,
  expectedOrderIds: [openingOrderId, cleanupOrderId],
});
```

`expectedOrderIds` only reports observed/missing matches. It does not filter
the instrument-period totals, prove every partial fill was indexed, or assign
period funding to a particular order.

## Accounting and coverage

Amounts remain decimal strings and sum using integer decimal arithmetic. Signed
`fee` values include rebates; `closedPnl` is realized fill PnL. Total `fee`
already includes the optional `builderFee`. Builder fees are an informational
subset and are never subtracted twice. The reported signed funding transfer is
summed directly. For USDC-only fees, observed realized net cash PnL equals closed
PnL minus fees plus signed funding. Non-USDC fees remain separate and make that
USDC net value `null`; the report never invents a conversion.

Coverage operates on account-wide raw pages before exact-symbol filtering.
Saturated pages are split into disjoint inclusive millisecond ranges. Stable
identities deduplicate overlapping parent/child observations; conflicting rows
fail the contract check. A saturated single millisecond remains an explicit
gap, as do request-budget exhaustion, timeouts and upstream failures. Requests
are bounded to 4..64 total (default 12), split between fills and funding after
metadata and snapshot reads. Total deadline defaults to 20 seconds.

`requestedWindowFetched` only means all partition requests returned below the
conservative pagination threshold. It does not prove historical retention.
The venue exposes only its latest 10,000 fills, and absent or short responses
cannot prove older history is absent. Consequently
`retentionVerified: false`, `fullLedgerReconciled: false` and builder credit
`unverified` remain explicit even for an empty successful report. Historical
order snapshots, transfers, deposits, withdrawals and complete account equity
reconstruction are outside this report. Funding attribution is account +
instrument + period, not order.

The venue contract is documented in the official
[info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
and [perpetual funding history](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals).
Builder fill fields do not identify the credited builder: obtain authoritative
builder accounting before claiming attribution.

## Recovery and verification

Exit code 2 means an explicit coverage gap exists; retain the report, inspect
its range/reason, and deliberately request a smaller historical window if useful.
No retry submits an order or spends USDC. Abort signals stop reads. Invalid
contracts throw a controlled error without retaining upstream response bodies.

```sh
node --import tsx --test test/reconciliation-report.test.ts
npm run typecheck
npm run build
```

Fixtures verify arithmetic, rebates, funding signs, fee-token separation,
pagination boundaries, truncation, duplicate conflicts and request failures.
They are deterministic tests, not funded execution or full-ledger proof.

