# Runnable examples

For an installed archive with no development dependencies, start with [installed SDK quickstarts](installed-quickstarts.md). This runbook describes source-checkout npm commands, what they contact, what they can spend, and when they exit. Commands run from `packages/typescript` after its build unless stated otherwise.

## Install

```bash
git clone --branch v0.8.4 https://github.com/InTheta/omni-universe-sdks.git
cd omni-universe-sdks/packages/typescript
npm ci
npm run verify
```

Node.js 22.12 or newer is required for v0.8.4. Every `npm run example:*` command loads `.env` when present; values already injected into the process environment take precedence.

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
| `npm run example:x402` | Yes | Buyer key only when paid mode is enabled | Only with `RUN_PAID_EXAMPLES=true` | No | No | Free health or 13 paid HTTP products; explicit Sepolia confirmation required |
| `npm run example:mcp:free` | Yes | No | No | No | No | Free MCP catalog, then exits |
| `npm run example:mcp` | Yes | Buyer key only when paid mode is enabled | Only with `RUN_PAID_EXAMPLES=true` | No | No | Free catalog or five paid tools; explicit Sepolia confirmation required |
| `npm run example:ask-omni:demo` | No | No | No | No | No | Prints the current 0.120-0.144 USDC plan; paid mode preflights the preserved 0.030 total/0.010 per-call defaults and rejects before work |
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

`example:rest` always reads Hyperliquid instruments and candles directly from Hyperliquid. It adds Omni AI News when the API key is present. Ask Omni is separate: enable `RUN_ASK_OMNI=true` only with general API-plan access; a News-only entitlement is not sufficient. The example supplies the server-required `presetId`. `example:news-ws` exchanges the key for a short-lived ticket, reads five news frames, closes the stream, and exits.

## Paid x402 REST and MCP

Use a separate Base Sepolia buyer wallet. Both examples stay free by default.
The 13-product HTTP plan totals at most 0.182 test USDC; the five-tool MCP plan
totals at most 0.124. Each allows at most 0.100 per call for published premarket
research. The generic SDK default remains 0.010 and is not raised by discovery.

After independently approving one exact plan, configure the protected environment:

```dotenv
EVM_PRIVATE_KEY=0x...
RUN_PAID_EXAMPLES=true
X402_CONFIRM_TESTNET_BUDGET=0.182
X402_BUCKET_PRICE=<current published liquidation level>
X402_RUN_STATE=<new private journal path>
```

Run `npm run example:x402` for exactly 13 HTTP products (ten JSON and three PNG).
For `npm run example:mcp`, instead confirm `X402_CONFIRM_TESTNET_BUDGET=0.124` and
use a different new journal path; the bucket price is not needed. A dated roundup
is a query variant, not an additional product purchase in either matrix.

These examples pin Base Sepolia, canonical USDC and Omni's receiver through the
payment policy. They reserve aggregate authorization budgets before signing,
limit authorization counts to 13 or five, record request starts and returned
receipt identifiers in exclusive mode-0600 journals, and stop on failures.
They do not implement restart/resume or prove settlement exactly once. Reconcile
the existing journal and chain state before any separately approved new run.
Never blindly rerun with a new journal to reset an uncertain budget. No private
key, signed proof or raw MCP envelope is logged. The protected payer is local to
the process; no key enters the seller service.

Remove `RUN_PAID_EXAMPLES=true` after the run. The `:free` commands override it
and perform only free health/catalog reads without constructing a payer.

## Coinbase and Robinhood agents

First run both safe demos. Then follow the [trading-agent guide](trading-agents.md) for broker credentials, the separate x402 buyer key, preview behavior, and exact live-order confirmation values.

```bash
npm run example:coinbase:demo
npm run example:robinhood:demo
```

The configured agents make one paid `market-risk` request by default. With `OMNI_RESEARCH_TRANSPORT=both`, they buy Market Risk over x402 REST and Market Carry over native x402 MCP for an exact maximum session spend of `0.013` USDC. Coinbase dry-run makes an authenticated preview request but never calls create-order. Robinhood Crypto dry-run constructs the exact v2 path and body locally and makes no Robinhood request. Real submission requires `LIVE_TRADING=true` plus the broker-specific `CONFIRM_LIVE_ORDER` value. For Coinbase Agentic Wallet and the official Robinhood Trading MCP, follow [agentic trading from zero to one](agentic-trading-0-to-1.md).

## Hyperliquid testnet and local MCP agents (source checkout)

The separate `examples/testnet-agents` package is not part of the installed SDK
archive. In the matching tagged repository, build the SDK first and then install
that sibling example:

```bash
# From omni-universe-sdks/packages/typescript in the cloned v0.8.4 source:
npm ci
npm run build
cd ../../examples/testnet-agents
npm ci
npm run typecheck
npm run test:mcp
```

The [testnet-agent source guide](https://github.com/InTheta/omni-universe-sdks/blob/v0.8.4/examples/testnet-agents/README.md)
and [local MCP agent guide](https://github.com/InTheta/omni-universe-sdks/blob/v0.8.4/examples/testnet-agents/MCP_TRADING.md)
provide exact scope and permission prerequisites. Their `verify:live` also runs a
separately labelled signed unfunded-account probe; do not select it for an
unsigned-only run. A paid Omni research purchase and a funded order lifecycle
remain separately authorised operations.

Installed archives include unsigned real research, guarded previews and an
unsigned deterministic lifecycle/recovery runner under `dist-examples/`; use the
[installed commands](installed-quickstarts.md) without cloning source or adding
`tsx`.

## Troubleshooting

- `.env not found. Continuing without it.` is expected when no local environment file exists.
- `OMNI_API_KEY is required` means the authenticated news stream was selected; use `example:news-ws:demo` for an offline run.
- `RUN_PAID_RESEARCH=true is required` means a configured agent was selected; use the broker `:demo` command first.
- A demo refusing a live gate is intentional. Remove `LIVE_TRADING`, `CONFIRM_LIVE_ORDER`, or `RUN_TESTNET_ORDERS` from the demo environment.
- Timeouts from the public/live commands indicate network or upstream availability problems; the offline demos should still pass.

These examples demonstrate integration contracts and safety mechanics. They are not profitable strategies or investment advice.
