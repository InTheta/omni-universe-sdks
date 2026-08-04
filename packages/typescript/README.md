# Omni Terminal TypeScript SDK

Public TypeScript clients for Node.js 20.19+ covering Omni's AI News, enriched analytics, MCP, and x402 products; direct Hyperliquid public REST/WebSocket data; and live-capable Coinbase Advanced Trade and Robinhood Crypto agent examples.

The SDK follows the published contracts:

- REST/WS OpenAPI: `https://omniterminal.app/openapi.yaml` (observed v1.3.0)
- x402 OpenAPI: `https://omniterminal.app/openapi-x402.yaml` (observed v0.8.0)
- MCP: `https://omniterminal.app/api/x402/mcp` (Streamable HTTP, protocol `2025-06-18`)

Private deployment addresses are deliberately not embedded. Override the public defaults with `OMNI_API_URL`, `OMNI_APP_URL`, `OMNI_WS_URL`, and `OMNI_MCP_URL` in your own environment.

## Data-source boundary

- Public Hyperliquid instruments, candles, mids, recent trades, and L2 books come directly from `https://api.hyperliquid.xyz/info` and `wss://api.hyperliquid.xyz/ws`. They do not use Omni infrastructure or an Omni API key.
- Omni API keys are for Omni-owned products such as the external AI News API and Ask Omni.
- Omni x402/MCP products provide bounded, enriched outputs such as AI News Pulse, liquidation maps, public-trader analytics, joined market risk, entity resolution, and carry context.
- Broker order authority remains with Coinbase or Robinhood and is never sent to Omni.

## Install

The public source release is available in this repository. npm registry publication is a separate release step and is not complete yet. Until then, install the verified GitHub release tarball or develop from `packages/typescript`.

```bash
npm install https://github.com/InTheta/omni-universe-sdks/releases/download/v0.8.0/omni-terminal-sdk-0.8.0.tgz
```

For source development:

```bash
npm ci
cp .env.example .env
npm run verify:live
```

Every `npm run example:*` command loads `.env` when that file exists. Values already present in the process environment take precedence, so deployment and CI secrets do not need an on-disk file.

Node.js 20.19 or newer is required. The examples can also be run directly with Node's env-file support:

```bash
node --env-file=.env --import tsx examples/rest-api-key.ts
```

For a complete research-to-order walkthrough, including Coinbase and Robinhood credentials, dry-run behavior, exact live gates and custom-agent patterns, read [Building Coinbase and Robinhood agents with Omni data](docs/trading-agents.md).

## Authentication and payment

There are two Omni commercial access paths:

1. Put an Omni key in `OMNI_API_KEY`. The SDK sends it only in the `x-api-key` header for keyed routes. It never puts a News API key in the URL.
2. Put a separately funded EVM buyer-wallet key in `EVM_PRIVATE_KEY`. The official x402 v2 client handles the `402 -> PAYMENT-REQUIRED -> signed retry -> PAYMENT-RESPONSE` flow on Base Sepolia or Base. The SDK rejects any single challenge above `X402_MAX_PAYMENT_USD` (`$0.01` by default) and rejects assets other than the official Base/Base Sepolia USDC contracts.

## Direct Hyperliquid public REST

```ts
import { HyperliquidPublicClient } from "@omni-terminal/sdk";

const hl = new HyperliquidPublicClient();
const perpetuals = await hl.perpetuals();
const candles = await hl.candles("BTC", "1h");
const mids = await hl.allMids();
const book = await hl.l2Book("BTC");
```

These calls use Hyperliquid's public `POST /info` API directly. Read-only 429/502/503/504 responses are retried with bounded backoff, and the configured timeout covers the complete attempt/backoff chain. Every convenience method validates its successful response envelope before returning typed market data; malformed `200` responses fail closed with `OmniContractError`.

## Omni keyed REST

```ts
import { OmniClient } from "@omni-terminal/sdk";

const omni = new OmniClient({ apiKey: process.env.OMNI_API_KEY });
const news = await omni.newsForSymbol("BTC", { limit: 10, lookback_days: 1 });
```

Implemented REST operations:

| Access | Method and route | SDK method |
| --- | --- | --- |
| Free | `GET /health` | `health()` |
| Free | `GET /api/v1/news/health` | `newsHealth()` |
| API key | `GET /api/v1/news[/{symbol}]` | `news*()` |
| API key | `POST /api/v1/news/ws-ticket` | `createNewsWebSocketTicket()` |
| API key | `POST /api/v1/ask-omni` | `askOmni()` |
| Free | `GET /api/hl/public-profile` | `publicProfile()` |
| Optional secret | `GET /integrations/defillama/v1/builder-fees` | `builderFees()` |

Authenticated methods fail locally when `OMNI_API_KEY` is missing. News filters, symbols, wallet addresses, Ask Omni inputs, and builder-fee windows are validated before fetch; successful News list and WebSocket-ticket responses are checked against their published runtime contracts before being returned.

## WebSocket

```ts
import { HyperliquidWebSocketClient, OmniWebSocketClient } from "@omni-terminal/sdk";

const hlWs = new HyperliquidWebSocketClient();
for await (const event of hlWs.trades("BTC")) {
  console.log(event.data);
}
```

The direct Hyperliquid client supports `allMids`, `candle`, `l2Book`, and `trades`, automatically resubscribes up to the configured lifetime reconnect limit, ignores stale-socket events, and caps its in-memory event queue. Omni paid AI News uses a separate single-use ticket:

```ts
const ws = new OmniWebSocketClient();
const ticket = await omni.createNewsWebSocketTicket();
for await (const event of ws.news(ticket)) console.log(event.data);
```

The news client sends a JSON ping every 55 seconds, inside the documented 60-second recommendation and 120-second idle timeout. Its receive queue is bounded to 1,000 frames by default and can be changed with `maxQueueSize`; when full, the oldest frame is discarded.

## x402 REST — all nine paid routes

```ts
import { createEvmPaymentClient, OmniX402Client } from "@omni-terminal/sdk";

const paid = new OmniX402Client({
  paymentClient: createEvmPaymentClient(process.env.EVM_PRIVATE_KEY as `0x${string}`, {
    maxPaymentUsd: 0.01,
  }),
});
const { data, payment } = await paid.marketRisk("BTC", { scope: "current", limit: 5 });
```

| x402 target | SDK method |
| --- | --- |
| `GET /api/x402/v1/news/{symbol}` | `symbolNews()` |
| `GET /api/x402/v1/news` | `marketNews()` |
| `GET /api/x402/v1/trader-profile/{address}` | `traderProfile()` |
| `GET /api/x402/v1/liquidations/{symbol}` | `liquidationMap()` |
| `GET /api/x402/v1/traders/{symbol}` | `traderLeaderboard()` |
| `GET /api/x402/v1/market-risk/{symbol}` | `marketRisk()` |
| `GET /api/x402/v1/market-snapshot/{symbol}` | `marketSnapshot()` |
| `POST /api/x402/v1/symbols/resolve` | `resolveSymbols()` |
| `GET /api/x402/v1/market-carry/{symbol}` | `marketCarry()` |

Paid methods return contract-shaped TypeScript objects. They validate runtime symbols, addresses, limits, filters, timestamps, and entity batches before invoking the payment-aware fetch layer, then verify product service/schema discriminants and require a successful `PAYMENT-RESPONSE` settlement with a transaction and network. Invalid requests cannot trigger avoidable payment attempts, and response or settlement-contract drift fails closed.

Run `npm run example:x402`. It makes only the two free health calls unless `RUN_PAID_EXAMPLES=true` is explicitly set; with that flag it purchases every route once.

## MCP — every tool

```ts
import { OmniMcpClient } from "@omni-terminal/sdk";

const mcp = await new OmniMcpClient({
  privateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
  maxPaymentUsd: 0.01,
  approvePayment: ({ paymentRequired }) => {
    console.log(paymentRequired.accepts);
    return true;
  },
}).connect();

console.log((await mcp.catalogData()).data);       // free, parsed and validated
console.log(await mcp.marketMovingEventsData({ symbol: "BTC" }));
console.log(await mcp.marketRiskData({ symbol: "BTC" }));
console.log(await mcp.resolveEntitiesData(["bitcoin"]));
console.log(await mcp.marketCarryData("BTC"));
await mcp.close();
```

Paid MCP calls are denied by default. Supply an `approvePayment` callback so the application owns the spending decision. The payment client independently enforces `maxPaymentUsd`, even if the callback approves a larger challenge. The SDK validates every live tool's required fields, ranges, enums, batch sizes, and allowed property names before the payment-aware MCP client is invoked. Paid results must contain a successful settlement receipt, and the `*Data()` helpers parse and validate each product's JSON service/schema contract. Raw `callTool()` and non-`Data` helpers remain available. The free catalog is never allowed to trigger payment. `npm run example:mcp` targets the free catalog and all four paid tools.

## Trading agents

The Coinbase and Robinhood examples use Omni only for read-only research. Broker credentials remain with their broker client, and Omni receives no order authority.

```bash
npm run example:coinbase
npm run example:robinhood
```

Both agents:

- purchase `market-risk` through x402 REST by default, or through Omni MCP when `OMNI_RESEARCH_TRANSPORT=mcp`;
- require `RUN_PAID_RESEARCH=true` before that single purchase and hard-cap it at `$0.01`;
- apply a deterministic confidence and funding guardrail;
- cap order notional with `MAX_ORDER_NOTIONAL_USD` and refuse an example ceiling above `$100`;
- return `HOLD` when the signal is weak or funding is extreme;
- require `LIVE_TRADING=true` plus `CONFIRM_LIVE_ORDER=COINBASE_LIVE_ORDER` or `ROBINHOOD_LIVE_ORDER` before submitting an order.

Coinbase always calls the authenticated order-preview endpoint first, including in dry-run mode. Live submissions fail closed unless the preview contains an `errs` array with no failures and a `preview_id`, which is forwarded to order creation. Robinhood has no preview endpoint in its public Crypto Trading API, so dry-run mode returns the exact v2 order path and body without transmitting or signing it. Robinhood live execution signs the exact transmitted body and uses the documented v2 order route. The signature implementation is tested against Robinhood's published Ed25519 test vector.

These are integration examples, not a profitable strategy or investment advice. Use separate least-privilege keys, wallet spending limits, broker-side limits, and human approval for material orders.

See the [full trading-agent guide](docs/trading-agents.md) for copy-paste environment templates, Coinbase ECDSA key setup and static sandbox notes, Robinhood Ed25519 setup, transport selection, side-effect matrix, extension examples and deployment checklist.

## Verification

```bash
npm run typecheck
npm run test:agents
npm run test:docs
npm test
npm run test:live
npm audit --omit=dev
```

`test:live` spends nothing. It verifies Omni health, direct Hyperliquid instruments/candles/WebSocket data, the published REST/x402 route boundary, every MCP tool, and valid unpaid challenges from all nine x402 routes.

`npm run verify` additionally creates the real npm tarball, checks its allowlisted contents, installs it into a clean temporary consumer project, and imports the public root and broker subpath exports. This is stronger than a packaging dry run and detects version/export drift from the artifact consumers actually receive.

## Public references

- Omni docs: https://omniterminal.app/docs
- Hyperliquid Info endpoint: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Hyperliquid WebSocket subscriptions: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- x402 buyer quickstart: https://docs.x402.org/getting-started/quickstart-for-buyers
- MCP TypeScript client: https://ts.sdk.modelcontextprotocol.io/client
- Coinbase Advanced Trade: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api
- Robinhood Crypto Trading API: https://docs.robinhood.com/crypto/trading/
