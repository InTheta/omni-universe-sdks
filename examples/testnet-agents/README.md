# Omni Hyperliquid testnet agents

Runnable Node.js 22 examples for guarded agent decisions and Hyperliquid testnet execution. The package has no configurable Hyperliquid API URL: every market-data, signing, order, and cancel request is pinned to `https://api.hyperliquid-testnet.xyz` and fails closed if that boundary changes.

The examples use the community TypeScript client linked by Hyperliquid's official API documentation. Testnet asset IDs are resolved from live testnet metadata rather than copied from mainnet.

## Agents

| Agent | Research | Default behavior |
| --- | --- | --- |
| `momentum-agent.ts` | Live Hyperliquid testnet candles | Deterministic trend decision, then HOLD or a capped ALO order preview |
| `mean-reversion-agent.ts` | Live Hyperliquid testnet candles | Deterministic deviation decision, then HOLD or a capped ALO order preview |
| `omni-risk-agent.ts` | Omni `market-risk` through paid x402 REST or paid MCP | Omni guardrail decision, then HOLD or a capped Hyperliquid testnet ALO order preview |

All agents are dry-run by default and convert signals below `TESTNET_MIN_CONFIDENCE` to `HOLD`. A trade-capable run requires a funded testnet account, a testnet-only private key, and two exact opt-ins. The order lifecycle uses an add-liquidity-only order 50–500 basis points away from the midpoint, caps notional at `$25`, verifies that the order is resting, cancels it immediately, and verifies it is no longer open.

## Install and run

```bash
npm ci
cp .env.example .env
npm run verify:live
```

`verify:live` runs the two public-data agents against real testnet market data but submits no order. `npm run test:signed` generates an ephemeral unfunded key, signs a real testnet exchange request, and verifies that testnet identifies it as an unknown or unfunded account rather than rejecting the signature; no order is accepted.

Run individual agents:

```bash
npm run example:momentum
npm run example:mean-reversion
npm run example:omni-risk
```

The Omni risk example requires `RUN_PAID_RESEARCH=true`, a separately funded `EVM_PRIVATE_KEY`, and either `OMNI_RESEARCH_TRANSPORT=x402` or `mcp`. Its x402 ceiling is hard-limited to `$0.01` per research call. The EVM buyer-wallet key is never sent to Hyperliquid, and the Hyperliquid testnet key is never sent to Omni.

## Funded testnet lifecycle

Create or approve a dedicated API wallet on Hyperliquid testnet, fund the owning testnet account with testnet collateral, and set:

```dotenv
HL_TESTNET_PRIVATE_KEY=0x...
HL_TESTNET_ACCOUNT_ADDRESS=0x...
RUN_TESTNET_ORDERS=true
CONFIRM_TESTNET_ORDER=HYPERLIQUID_TESTNET_ONLY
TESTNET_MAX_NOTIONAL_USD=15
TESTNET_ORDER_OFFSET_BPS=200
TESTNET_MIN_CONFIDENCE=0.55
```

For a master-wallet key, `HL_TESTNET_ACCOUNT_ADDRESS` can be left blank. For an approved API wallet, set it to the owning testnet account address. Then run:

```bash
npm run test:order
```

For GitHub Actions, configure `HL_TESTNET_PRIVATE_KEY` and optionally `HL_TESTNET_ACCOUNT_ADDRESS` as repository secrets, manually dispatch `SDK CI`, and select `run_testnet_order_lifecycle`. Scheduled and pull-request runs never enable funded orders.

Hyperliquid's testnet faucet requires the same address to have deposited on mainnet before it can claim mock USDC. See the [official testnet faucet instructions](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet) and [official API network documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api).

Never reuse a mainnet private key. These examples are integration demonstrations, not profitable strategies or investment advice.
