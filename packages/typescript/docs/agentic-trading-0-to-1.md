# Agentic trading from zero to one

This runbook connects three deliberately separate capabilities:

1. Coinbase Agentic Wallet discovers Omni in Bazaar and pays one bounded x402 request.
2. Omni returns read-only market evidence over x402 HTTP or native x402 MCP.
3. Coinbase Advanced Trade, Robinhood Trading MCP, or Robinhood Crypto receives only a bounded
   order intent. Omni never receives broker credentials or trading authority.

The first run stops at a preview or local order plan. It is an integration test, not a strategy or
investment recommendation.

## Path A: Coinbase Agentic Wallet + Robinhood Agentic Trading

Use this path for a tool-using agent and a dedicated Robinhood Agentic account.

### 1. Install the Coinbase payment MCP

```bash
npx @coinbase/payments-mcp
```

Select the current MCP client, restart it, ask `Show me my wallet`, authenticate by email, fund the
wallet with a small Base USDC balance, and set these wallet-side limits:

- maximum per call: `0.010 USDC`;
- maximum per session: `0.013 USDC` for one Market Risk plus one Market Carry result.

The agent can respect these limits but cannot raise them.

### 2. Connect Robinhood Trading MCP

For Codex CLI:

```bash
codex mcp add robinhood-trading --url https://agent.robinhood.com/mcp/trading
```

For another Streamable HTTP MCP host, add the same URL. Authenticate in the desktop browser and
finish Robinhood's dedicated Agentic-account onboarding. The agent may read all connected Robinhood
accounts, but Robinhood restricts order placement to the dedicated Agentic account.

Connect Omni for free tool discovery:

```bash
codex mcp add omni-x402 --url https://omniterminal.app/api/x402/mcp
```

A generic MCP host can call `get_market_catalog` for free. Paid native Omni tools require an
x402-aware MCP client. Coinbase Agentic Wallet can instead pay the equivalent HTTP product with its
`make an x402 request` capability.

### 3. Run the no-order proof

Give the agent this prompt:

```text
Use Omni MCP get_market_catalog to confirm the published products, schemas, networks and prices.
Use Coinbase Agentic Wallet to search Bazaar for Omni Terminal market risk.
Inspect the exact URL, schema, receiver, Base network and price before paying.
Spend no more than 0.010 USDC on one BTC Market Risk result.
Require market_risk_snapshot.v1, fresh top-level and component timestamps, complete liquidation
levels, margin stress, funding and news. Stop if any check fails.

Then use Robinhood Trading MCP read-only tools to inspect the dedicated Agentic account's buying
power, positions and the venue's current BTC availability. Produce one bounded proposed order or
HOLD. Do not place, submit, replace or cancel any order. Show the Omni receipt, evidence timestamp,
account scope, side, symbol, order type, notional and the exact reason for HOLD or the proposal.
```

Verify that the result contains one Omni settlement receipt and no order ID. If it does not, stop.

### 4. First live order gate

Only after reviewing the no-order proof, send a separate instruction that names the exact symbol,
side, type and maximum notional and requires the agent to show Robinhood's final order terms before
submission. Keep the first notional immaterial, monitor the dedicated account, and cancel the flow
if the evidence is stale or the account/symbol differs. Do not use a blanket instruction such as
"trade whenever you think it is best" during integration testing.

Robinhood warns that an agent can place trades without per-order confirmation if instructed to do
so. The approval step above is therefore an application policy, not a broker guarantee.

## Path B: runnable TypeScript broker adapters

This path is reproducible in CI and does not depend on an interactive MCP OAuth session.

```bash
git clone https://github.com/InTheta/omni-universe-sdks.git
cd omni-universe-sdks/packages/typescript
npm ci
cp .env.example .env
npm run verify
```

The combined research mode makes two fixed purchases: Market Risk over x402 REST (`0.010`) and
Market Carry over native x402 MCP (`0.003`). It requires the exact `0.013` session declaration.

```dotenv
OMNI_RESEARCH_TRANSPORT=both
RUN_PAID_RESEARCH=true
EVM_PRIVATE_KEY=0x...
X402_MAX_PAYMENT_USD=0.010
X402_MAX_RESEARCH_SESSION_USD=0.013
LIVE_TRADING=false
MAX_ORDER_NOTIONAL_USD=25
TRADING_SYMBOL=BTC
```

Run Coinbase Advanced Trade preview:

```bash
npm run example:coinbase
```

Run the separate Robinhood Crypto signed local plan:

```bash
npm run example:robinhood
```

These are different Robinhood integrations. `example:robinhood` uses the official Crypto Trading
API and does not represent the OAuth-based Robinhood Trading MCP. With `LIVE_TRADING=false`, Coinbase
calls only its authenticated preview endpoint and Robinhood Crypto makes no network request.

## Required production controls

- Separate the Coinbase x402 wallet, Coinbase broker key, Robinhood connection and Omni API key.
- Pin Omni's canonical receiver, Base network, USDC asset, resource URL and current challenge price.
- Treat a payment receipt as research settlement only, never as order permission.
- Reject stale/incomplete evidence, unavailable symbols, unexpected account scope and preview errors.
- Add duplicate-order protection, daily loss/notional limits, monitoring and a kill switch.
- Reconcile a timeout after payment or order submission before retrying either side effect.

Official references:

- Coinbase Agentic Wallet MCP quickstart: https://docs.cdp.coinbase.com/payments-mcp/quickstart
- Coinbase x402 Bazaar MCP: https://docs.cdp.coinbase.com/x402/bazaar
- Coinbase Advanced Trade preview: https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders
- Robinhood Agentic Trading: https://robinhood.com/us/en/support/articles/agentic-trading-overview/
- Robinhood Crypto Trading API: https://docs.robinhood.com/crypto/trading/
