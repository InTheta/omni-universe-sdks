# Omni Universe SDKs

[![SDK CI](https://github.com/InTheta/omni-universe-sdks/actions/workflows/sdk.yml/badge.svg)](https://github.com/InTheta/omni-universe-sdks/actions/workflows/sdk.yml)

Public SDKs, connection examples, market-data integrations, and guarded trading-agent examples for the Omni ecosystem.

## Available SDKs

| SDK | Status | Runtime | Coverage |
| --- | --- | --- | --- |
| [TypeScript](packages/typescript) | Source release `0.8.0` | Node.js 20+ | Omni API-key REST/WS, x402 REST, x402 MCP, direct Hyperliquid REST/WS, Coinbase and Robinhood agent examples |

The TypeScript package is source-available here and produces `@omni-terminal/sdk`. Publishing to the npm registry is a separate release step and has not been performed yet.

## Connection model

| Connection | Access | Intended use |
| --- | --- | --- |
| Hyperliquid REST/WS | Public, direct | Instruments, candles, mids, trades, books and other commodity market data |
| Omni AI News and Ask Omni | Omni API key | Authenticated AI news, WebSocket tickets and risk questions |
| Omni x402 REST | Per-call USDC payment | Enriched news, liquidation, trader, market-risk, snapshot, resolution and carry products |
| Omni MCP + x402 | Per-call USDC payment with explicit approval | Agent-native access to the bounded market-intelligence tools |
| Coinbase / Robinhood | Broker credentials held locally | Dry-run-first order examples using Omni research signals |

Public Hyperliquid reads go directly to Hyperliquid. Omni API keys are used only for Omni-owned API products. Broker credentials and order authority are never sent to Omni.

## Examples

The TypeScript SDK includes runnable examples for:

- [API-key REST](packages/typescript/examples/rest-api-key.ts)
- [direct Hyperliquid WebSocket data](packages/typescript/examples/ws-market.ts)
- [Omni AI News WebSocket tickets](packages/typescript/examples/ws-news.ts)
- [all nine x402 REST products](packages/typescript/examples/x402-all-routes.ts)
- [the free MCP catalog and all four paid MCP tools](packages/typescript/examples/mcp-all-tools.ts)
- [Coinbase research/trading agent](packages/typescript/examples/agents/coinbase-agent.ts)
- [Robinhood research/trading agent](packages/typescript/examples/agents/robinhood-agent.ts)
- [selectable x402 REST or MCP research connection](packages/typescript/examples/agents/research.ts)

## Develop

```bash
cd packages/typescript
npm ci
npm run verify
npm run test:live
```

`test:live` spends nothing and submits no broker order. Paid examples require an explicit wallet key and opt-in flag. Broker examples default to dry-run behavior unless `LIVE_TRADING=true` is set.

See the [TypeScript SDK guide](packages/typescript/README.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

## License

MIT
