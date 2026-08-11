# Runnable examples

This runbook covers every public example command, what it contacts, what it can spend, and when it exits. Commands are run from `packages/typescript` unless the table says otherwise.

## Install

```bash
git clone https://github.com/InTheta/omni-universe-sdks.git
cd omni-universe-sdks/packages/typescript
npm ci
npm run verify
```

Node.js 20.19 or newer is required. Every `npm run example:*` command loads `.env` when present; values already injected into the process environment take precedence.

## Start with the no-spend demos

These commands need no credentials, make no payment, and cannot submit an order:

```bash
npm run example:news-ws:demo
npm run example:coinbase:demo
npm run example:robinhood:demo

# Runs all three and is part of npm run verify.
npm run test:examples
```

The news demo prints a representative offline frame. The broker demos use deterministic research, force `liveTrading: false`, and exercise Coinbase's preview boundary with a mocked response or Robinhood's zero-network local order plan. `--demo` refuses `LIVE_TRADING=true` even if a committed or local environment file contains the broker confirmation.

## Live but forced free/public

Use these commands when you want real connectivity without allowing an API-key call or x402 payment:

```bash
npm run example:rest:public
npm run example:ws
npm run example:x402:free
npm run example:mcp:free
```

The `:public` and `:free` commands override payment and API-key flags from `.env`. `npm run verify:live` uses only these forced-safe variants, so `RUN_PAID_EXAMPLES=true` cannot turn verification into a paid run.

## Command and side-effect matrix

| Command | Needs network | Needs credentials | Can pay Omni | Calls a broker | Can submit an order | Expected completion |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| `npm run example:rest:public` | Yes | No | No | No | No | Health, instruments and candles, then exits |
| `npm run example:rest` | Yes | `OMNI_API_KEY` only for keyed calls | No x402 payment | No | No | Public reads plus optional keyed calls, then exits |
| `npm run example:ws` | Yes | No | No | No | No | Five public Hyperliquid trades, then exits |
| `npm run example:news-ws:demo` | No | No | No | No | No | One deterministic frame, then exits |
| `npm run example:news-ws` | Yes | `OMNI_API_KEY` | No x402 payment | No | No | Five authenticated news frames, then exits |
| `npm run example:x402:free` | Yes | No | No | No | No | Two free health contracts, then exits |
| `npm run example:x402` | Yes | Buyer key only when paid mode is enabled | Only with `RUN_PAID_EXAMPLES=true` | No | No | Free health or all ten paid JSON products, then exits |
| `npm run example:mcp:free` | Yes | No | No | No | No | Free MCP catalog, then exits |
| `npm run example:mcp` | Yes | Buyer key only when paid mode is enabled | Only with `RUN_PAID_EXAMPLES=true` | No | No | Free catalog or five paid tools, then exits |
| `npm run example:ask-omni:demo` | No | No | No | No | No | Prints the 0.016-0.040 USDC bundle plan and deterministic evidence |
| `npm run example:ask-omni` | Yes | Dedicated buyer key | Only with `RUN_PAID_ASK_OMNI_BUNDLE=yes` | No | No | Executes one bounded brief/deep/visual research bundle |
| `npm run example:coinbase:demo` | No | No | No | Mocked preview | No | Deterministic BUY and preview, then exits |
| `npm run example:coinbase` | Yes | Buyer wallet and Coinbase key | One call, or two with `both` | Authenticated preview | Only with both live gates | One decision, then exits |
| `npm run example:robinhood:demo` | No | No | No | No network | No | Deterministic BUY and local order plan, then exits |
| `npm run example:robinhood` | Yes | Buyer wallet and Robinhood key | One call, or two with `both` | No network in dry-run | Only with both live gates | One decision, then exits |

## API-key AI News

Copy `.env.example` to `.env`, set `OMNI_API_KEY`, and run:

```bash
npm run example:rest
npm run example:news-ws
```

`example:rest` always reads Hyperliquid instruments and candles directly from Hyperliquid. It adds Omni AI News and Ask Omni only when the API key is present. `example:news-ws` exchanges the key for a short-lived ticket, reads five news frames, closes the stream, and exits.

## Paid x402 REST and MCP

Use a separate buyer wallet with only the funds you intend to spend:

```dotenv
EVM_PRIVATE_KEY=0x...
X402_MAX_PAYMENT_USD=0.01
X402_MAX_RESEARCH_SESSION_USD=0.013
RUN_PAID_EXAMPLES=true
```

Then choose one transport:

```bash
# Purchases each of the ten JSON REST products once.
npm run example:x402

# Purchases each of the five paid MCP tools once.
npm run example:mcp
```

The payment client enforces the configured per-call ceiling. Remove `RUN_PAID_EXAMPLES=true` immediately after the run. Use the `:free` commands to inspect discovery and health contracts without relying on the contents of `.env`.

## Coinbase and Robinhood agents

First run both safe demos. Then follow the [trading-agent guide](trading-agents.md) for broker credentials, the separate x402 buyer key, preview behavior, and exact live-order confirmation values.

```bash
npm run example:coinbase:demo
npm run example:robinhood:demo
```

The configured agents make one paid `market-risk` request by default. With `OMNI_RESEARCH_TRANSPORT=both`, they buy Market Risk over x402 REST and Market Carry over native x402 MCP for an exact maximum session spend of `0.013` USDC. Coinbase dry-run makes an authenticated preview request but never calls create-order. Robinhood Crypto dry-run constructs the exact v2 path and body locally and makes no Robinhood request. Real submission requires `LIVE_TRADING=true` plus the broker-specific `CONFIRM_LIVE_ORDER` value. For Coinbase Agentic Wallet and the official Robinhood Trading MCP, follow [agentic trading from zero to one](agentic-trading-0-to-1.md).

## Hyperliquid testnet agents

The separate Node.js 22 package is pinned to Hyperliquid testnet:

```bash
cd ../../examples/testnet-agents
npm ci
npm run verify:live

npm run example:momentum
npm run example:mean-reversion
npm run example:omni-risk:demo
```

The Omni-risk demo replaces paid research with a deterministic fixture but still reads the real Hyperliquid testnet market to construct a dry-run ALO order plan. It refuses `RUN_TESTNET_ORDERS=true`. Paid Omni research and the funded place/verify/cancel workflow are documented in the [testnet-agent guide](../../../examples/testnet-agents/README.md).

## Troubleshooting

- `.env not found. Continuing without it.` is expected when no local environment file exists.
- `OMNI_API_KEY is required` means the authenticated news stream was selected; use `example:news-ws:demo` for an offline run.
- `RUN_PAID_RESEARCH=true is required` means a configured agent was selected; use the broker `:demo` command first.
- A demo refusing a live gate is intentional. Remove `LIVE_TRADING`, `CONFIRM_LIVE_ORDER`, or `RUN_TESTNET_ORDERS` from the demo environment.
- Timeouts from the public/live commands indicate network or upstream availability problems; the offline demos should still pass.

These examples demonstrate integration contracts and safety mechanics. They are not profitable strategies or investment advice.
