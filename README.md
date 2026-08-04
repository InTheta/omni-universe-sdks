# Omni Universe SDKs

[![SDK CI](https://github.com/InTheta/omni-universe-sdks/actions/workflows/sdk.yml/badge.svg)](https://github.com/InTheta/omni-universe-sdks/actions/workflows/sdk.yml)

Public SDKs, connection examples, market-data integrations, and guarded trading-agent examples for the Omni ecosystem.

## Available SDKs

| SDK | Status | Runtime | Coverage |
| --- | --- | --- | --- |
| [TypeScript](packages/typescript) | Source release `0.8.0` | Node.js 20+ | Omni API-key REST/WS, x402 REST, x402 MCP, direct Hyperliquid REST/WS, Coinbase and Robinhood agent examples |

The TypeScript package is source-available here and produces `@omni-terminal/sdk`. Publishing to the npm registry is a separate release step and has not been performed yet.

Install the verified `v0.8.0` release tarball directly from GitHub until npm publication is complete:

```bash
npm install https://github.com/InTheta/omni-universe-sdks/releases/download/v0.8.0/omni-terminal-sdk-0.8.0.tgz
```

## Connection model

| Connection | Access | Intended use |
| --- | --- | --- |
| Hyperliquid REST/WS | Public, direct | Instruments, candles, mids, trades, books and other commodity market data |
| Omni AI News and Ask Omni | Omni API key | Authenticated AI news, WebSocket tickets and risk questions |
| Omni x402 REST | Per-call USDC payment | Enriched news, liquidation, trader, market-risk, snapshot, resolution and carry products |
| Omni MCP + x402 | Per-call USDC payment with explicit approval | Agent-native access to the bounded market-intelligence tools |
| Coinbase / Robinhood | Broker credentials held locally | Dry-run-first order examples using Omni research signals |

Public Hyperliquid reads go directly to Hyperliquid. Omni API keys are used only for Omni-owned API products. Broker credentials and order authority are never sent to Omni.

## Documentation

| Guide | Contents |
| --- | --- |
| [TypeScript SDK reference](packages/typescript/README.md) | Installation, every REST/WS/x402/MCP connection, runtime validation and verification |
| [Coinbase and Robinhood agent guide](packages/typescript/docs/trading-agents.md) | Complete setup, data flow, credentials, dry runs, live gates, custom agents and test matrix |
| [Hyperliquid testnet agents](examples/testnet-agents/README.md) | Momentum, mean-reversion and Omni risk agents with a capped place/verify/cancel lifecycle |
| [Security policy](SECURITY.md) | Private reporting and production credential guidance |

## Examples

| Example | Command | Default external effect |
| --- | --- | --- |
| [API-key REST and direct Hyperliquid reads](packages/typescript/examples/rest-api-key.ts) | `npm run example:rest` | Public reads; keyed calls only when a key is supplied |
| [Direct Hyperliquid WebSocket](packages/typescript/examples/ws-market.ts) | `npm run example:ws` | Public market-data stream |
| [Omni AI News WebSocket](packages/typescript/examples/ws-news.ts) | `npm run example:news-ws` | Requires an Omni API key and ticket |
| [All nine x402 REST products](packages/typescript/examples/x402-all-routes.ts) | `npm run example:x402` | Free health only; no payment by default |
| [All MCP tools](packages/typescript/examples/mcp-all-tools.ts) | `npm run example:mcp` | Free catalog; paid tools require explicit setup |
| [Coinbase agent](packages/typescript/examples/agents/coinbase-agent.ts) | `npm run example:coinbase` | One explicitly approved research call; preview only |
| [Robinhood agent](packages/typescript/examples/agents/robinhood-agent.ts) | `npm run example:robinhood` | One explicitly approved research call; local order plan only |
| [Hyperliquid testnet momentum agent](examples/testnet-agents/agents/momentum-agent.ts) | `npm run example:momentum` in its package | Dry-run or HOLD |
| [Hyperliquid testnet mean-reversion agent](examples/testnet-agents/agents/mean-reversion-agent.ts) | `npm run example:mean-reversion` in its package | Dry-run or HOLD |
| [Omni risk to Hyperliquid testnet](examples/testnet-agents/agents/omni-risk-agent.ts) | `npm run example:omni-risk` in its package | Explicitly approved research; testnet dry-run by default |

The [testnet-agent package](examples/testnet-agents) runs on Node.js 22.12+ and is pinned to Hyperliquid testnet. It defaults to dry-run previews, hard-caps testnet orders at `$25`, and includes read-only live tests, a signed unfunded contract probe, and an opt-in funded `place -> verify -> cancel` lifecycle.

## Develop

```bash
cd packages/typescript
npm ci
npm run verify
npm run test:live
```

`test:live` spends nothing and submits no broker order. Broker agents require `RUN_PAID_RESEARCH=true` before their single capped research purchase. A real broker order additionally requires `LIVE_TRADING=true` and the broker-specific `CONFIRM_LIVE_ORDER` value documented in the [agent guide](packages/typescript/docs/trading-agents.md).

`npm run verify` also packs the SDK, installs that tarball into a clean temporary consumer project, and imports both the root SDK and broker entrypoint. This catches missing build output, export drift, accidental source/test publication, and package-version mismatches before release.

See the [TypeScript SDK guide](packages/typescript/README.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

## License

MIT
