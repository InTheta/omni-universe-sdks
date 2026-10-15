> Source migration: execution now delegates to the public `GuardedTestnetExecutor` from the sibling SDK source, rather than the old v0.8.0 tarball. Build `packages/typescript` first, then install this example. Exact owner account, a fresh private `TESTNET_JOURNAL_DIRECTORY`, 200 bp offset, flat instrument position and pre-existing Omni builder approval of 25 tenths bp (2.5 bp) are required. Keys stay local. The new guarded guide is `../../packages/typescript/docs/guarded-testnet.md`. No older release is claimed to export this API.

# Omni Hyperliquid testnet agents

Runnable Node.js 22 examples for guarded agent decisions and Hyperliquid testnet execution. The package has no configurable Hyperliquid API URL: every market-data, signing, order, and cancel request is pinned to `https://api.hyperliquid-testnet.xyz` and fails closed if that boundary changes.

The examples use the community TypeScript client linked by Hyperliquid's official API documentation. Testnet asset IDs are resolved from live testnet metadata rather than copied from mainnet.

## Agents

| Agent | Research | Default behavior |
| --- | --- | --- |
| `momentum-agent.ts` | Live Hyperliquid testnet candles | Deterministic trend decision, then HOLD or a capped ALO order preview |
| `mean-reversion-agent.ts` | Live Hyperliquid testnet candles | Deterministic deviation decision, then HOLD or a capped ALO order preview |
| `omni-risk-agent.ts` | Omni `market-risk` through paid x402 REST or paid MCP | Omni guardrail decision, then HOLD or a capped Hyperliquid testnet ALO order preview |

All agents are dry-run by default and convert signals below `TESTNET_MIN_CONFIDENCE` to `HOLD`. A trade-capable run requires a funded testnet account, a testnet-only private key, and two exact opt-ins. Dry-run plans allow offsets of 50–500 basis points. The enabled order lifecycle requires an add-liquidity-only order exactly 200 basis points away from the midpoint, caps notional at `$25`, verifies that the order is resting, cancels it immediately, and verifies it is no longer open.

## Install and run

```bash
npm --prefix ../../packages/typescript ci
npm --prefix ../../packages/typescript run build
npm ci
cp .env.example .env
npm run verify:live
```

`verify:live` runs the two public-data agents against real testnet market data and generates an ephemeral unfunded key for a signed exchange-contract probe. Testnet must identify that request as coming from an unknown or unfunded account rather than reject its signature; no order is accepted. The probe is also available separately as `npm run test:signed`.

Run individual agents:

```bash
npm run example:momentum
npm run example:mean-reversion
npm run example:omni-risk:demo
npm run example:omni-risk
```

`example:omni-risk:demo` uses deterministic research, makes no payment, and reads the live Hyperliquid testnet market only to produce a dry-run order plan. It refuses `RUN_TESTNET_ORDERS=true`. The configured Omni risk example requires `RUN_PAID_RESEARCH=true`, a separately funded `EVM_PRIVATE_KEY`, and either `OMNI_RESEARCH_TRANSPORT=x402` or `mcp`. Its x402 ceiling is hard-limited to `$0.01` per research call. The EVM buyer-wallet key is never sent to Hyperliquid, and the Hyperliquid testnet key is never sent to Omni.

## Funded testnet lifecycle

Create or approve a dedicated API wallet on Hyperliquid testnet, fund the owning testnet account with testnet collateral, and set:

```dotenv
HL_TESTNET_PRIVATE_KEY=0x...
HL_TESTNET_ACCOUNT_ADDRESS=0x...
TESTNET_JOURNAL_DIRECTORY=/absolute/private/new-session
RUN_TESTNET_ORDERS=true
CONFIRM_TESTNET_ORDER=HYPERLIQUID_TESTNET_ONLY
TESTNET_MAX_NOTIONAL_USD=15
TESTNET_ORDER_OFFSET_BPS=200
TESTNET_MIN_CONFIDENCE=0.55
```

Set `HL_TESTNET_ACCOUNT_ADDRESS` explicitly for both a dedicated owner-wallet key and an approved API wallet. It must name the exact owning testnet account. Directional intent symbols must match the configured instrument before market access or execution. Then run:

```bash
npm run test:order
```

For GitHub Actions, configure `HL_TESTNET_PRIVATE_KEY` and `HL_TESTNET_ACCOUNT_ADDRESS` as repository secrets, manually dispatch `SDK CI`, and select `run_testnet_order_lifecycle`. Scheduled and pull-request runs never enable funded orders.

Hyperliquid's testnet faucet requires the same address to have deposited on mainnet before it can claim mock USDC. See the [official testnet faucet instructions](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet) and [official API network documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api).

Never reuse a mainnet private key. These examples are integration demonstrations, not profitable strategies or investment advice.

## Local guarded MCP agent

See [MCP trading and recovery](MCP_TRADING.md) for the separate stdio adapter,
public SDK prerequisite, exact policy, permission probe, execution opt-in and
journal recovery. The deployed `/api/x402/mcp` remains read-only; paying for data
never grants trading authority. Current live proof covers read-only integration
and a disabled-execution denial. Filled MCP lifecycle and builder attribution
require a dedicated approved testnet signer and existing builder approval.
