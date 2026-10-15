# Guarded Hyperliquid testnet execution

`GuardedTestnetExecutor` is included in the coordinated v0.8.1 release. Install its tagged archive or build the matching source revision; publication availability is described in the [release notes](releases/0.8.1.md). Historical v0.8.0 does **not** export this API.

Migration: v0.8.1 requires Node >=22.12; the execution dependency raises the previous Node >=20.19 minimum. Historical v0.8.0 consumers retain their published runtime contract. Upgrade Node before upgrading the SDK.

From this source revision on Linux with Node >=22.12:

```sh
cd packages/typescript
npm ci
npm run build
npm pack
```

To test the actual package boundary, create a clean directory, `npm init -y`, and `npm install /absolute/path/omni-terminal-sdk-0.8.2.tgz`. Import exclusively from `@omni-terminal/sdk`. Its execution client uses the pinned public `@nktkas/hyperliquid` SDK. Neither client sends private keys to Omni or MCP servers; a local MCP adapter must remain under the signer's control.

For the included runner set the **exact** testnet account and validator perpetual symbol:

```sh
export HL_TESTNET_ACCOUNT_ADDRESS=0xYOUR_TESTNET_OWNER_ADDRESS
export TESTNET_SYMBOL=BTC
export TESTNET_MAX_NOTIONAL_USD=15
export TESTNET_BUILDER_FEE_TENTHS_BPS=25
npm run example:guarded-execution
```

The default run uses free real testnet book, metadata, clearinghouse, and builder-approval reads. `account().margin` reports the exact instrument margin mode/leverage, venue initial margin, cross-account maintenance margin and withdrawable collateral in USD. Instrument maintenance margin is `null` because this endpoint does not supply it separately; cross-account MM must not be presented as isolated-instrument MM. Missing or invalid collateral fails closed before submission. It submits nothing and costs no USDC. This is integration testing, not an executed order lifecycle. There is no BTC or account fallback. Missing instruments and stale books fail explicitly.

Execution additionally requires a dedicated testnet-only signer approved by the specified owning account, funded testnet collateral, a flat position in that exact instrument, and pre-existing approval of the disclosed Omni builder fee. The client does not grant agent access, approve builder fees, fund accounts, change margin mode, withdraw, or move collateral.

```sh
# Supply this through your protected local runtime; never put it in source or shell history.
# HL_TESTNET_PRIVATE_KEY=<dedicated approved testnet key>
export RUN_TESTNET_ORDERS=true
export CONFIRM_TESTNET_ORDER=HYPERLIQUID_TESTNET_ONLY
export TESTNET_JOURNAL_DIRECTORY=/absolute/private/new-testnet-session
npm run example:guarded-execution
```

The default entry is ALO at 2% from midpoint, with a maximum $25 hard ceiling and immediate cancellation. This does not prove fills or builder attribution. Set `TESTNET_ALLOW_IOC=true` only for an explicitly authorised bounded testnet fill: entry uses IOC at a 10 bp price bound, then the runner attempts IOC reduce-only cleanup of exactly its own entry fills. No existing position is closed. If the price moves outside the cleanup allowance, fills are not indexed, exposure changes concurrently, or any order outcome is uncertain, the runner preserves journals and fails for recovery. It never widens limits or silently repeats an entry. IOC can partially fill or fail to fill; inspect the final fills and exposure before claiming execution success.

Fee `25` means 25 tenths of a basis point = 2.5 bp, applied with public builder `0x733f40a4fa0cd13d59abade04b9ed2e9acac6457`. The owner must separately approve at least that fee on testnet. Smaller configured fees require explicit owner policy and an appropriate approval; the client never changes the destination builder. Paying for x402 data confers no trading or builder approval.

Every write has a client order ID and a journal persisted before submission. If interrupted, preserve the session directory and lock. Load the journal JSON into `executor.status(journal)`, `executor.cancel(journal)`, and `executor.reconcile(journal)` using the same exact policy/account. A new process must recover outstanding journals before starting a new session. `unknownOid` is an uncertain outcome, not permission to retry. This package's runner refuses any existing journal directory containing prior JSON journals. The persistence callback is an operator trust boundary: implement atomic private durable storage and a process/session lock as the example does. An in-memory callback is appropriate only for labelled fixtures.

Reconciliation returns authoritative order status, order-filtered fills, fee fields and account exposure. A request containing a builder field proves only request construction. Fill `builderFee` fields alone do not identify the credited builder. Verify the venue's builder export or other authoritative builder accounting before claiming attribution. An unfilled resting order cannot establish settled builder attribution.

Run deterministic rejection/stale data/insufficient collateral/disconnect/unknown-outcome and fill/close fixtures with:

```sh
node --import tsx --test test/guarded-testnet.test.ts
```

Those fixtures make no venue writes and are not sandbox-executed evidence. A funded lifecycle remains unverified until the protected testnet signer, owning account, builder approval and actual order/fill evidence are available.


Cancellation uses authoritative order status and current exact-symbol asset metadata; it does not require a fresh order book. Missing or ambiguous metadata, an asset-index mismatch, unknown order status or invalid signer authority still stops cancellation for explicit recovery. No fallback asset is submitted.

The example runner reports success and removes its session lock only after complete reconciliation and flat final exposure. A filled status without indexed fills, unexplained exposure, incomplete cleanup or missing reconciliation fields preserves the lock and journals. Restore visibility and reconcile those same journals before a new entry.

Current execution scope does not include amendment/cancel-replace or vault/subaccount execution. The separate [recent reconciliation report](recent-reconciliation.md) summarizes observed instrument-period fills, fees and funding; it is not a complete account ledger or proof of builder credit. Funded execution and authoritative builder-export reconciliation remain separate verification requirements.

See [Read-only builder attribution](builder-attribution.md) for exact native order/fill and aggregate-credit commands, Mainnet export matching, and explicit testnet proof limits.
