# Ask Omni research bundles

An Ask Omni bundle is an agent recipe over separately settled Omni x402 products. It is not one opaque paid endpoint: the agent sees each resource, price, schema, freshness field, and settlement receipt before it synthesizes an answer.

Each recipe names every service and price. The SDK's guarded runner executes items sequentially, reserves the entire known total before work, and never retries a paid item automatically.

## Bundle menu

| Bundle | Evidence | Cost with a canonical symbol | Cost with entity resolution |
| --- | --- | ---: | ---: |
| Ask Omni Market Brief | Published roundup + live moving events + Market Risk | 0.120 USDC | 0.121 USDC |
| Ask Omni Deep Market Research | Brief + Carry + Market Snapshot + full Liquidation Map | 0.133 USDC | 0.134 USDC |
| Ask Omni Visual Risk Pack | Deep + liquidation-level PNG | 0.143 USDC | 0.144 USDC |

The prices above are the current maximum list-price sum. The unpaid challenge is the authority for current terms. Do not sign if a route, asset, network, recipient, or amount differs from policy.

## Services used

| Service | Transport | Price | Role |
| --- | --- | ---: | --- |
| `resolve_market_entities` | Omni MCP + x402 | 0.001 | Optional normalization of names such as `bitcoin` or `BTC-PERP` |
| `get_premarket_roundup` | Omni MCP + x402 | 0.100 | Latest (default) or exact-date published morning thesis, sanitized excerpt, and canonical article URL |
| `get_market_moving_events` | Omni MCP + x402 | 0.010 | Fresh catalysts, sentiment, impact, confidence, and affected tickers |
| `get_market_risk_context` | Omni MCP + x402 | 0.010 | Required mark-anchored liquidation pressure, margin stress, carry, and news gate |
| `get_market_carry` | Omni MCP + x402 | 0.003 | Dedicated 1h funding and mechanical 8h, 1d, and APR cross-check |
| `/market-snapshot/{symbol}` | HTTP + x402 | 0.005 | Price structure, OHLCV, funding, and liquidation overlay |
| `/liquidations/{symbol}` | HTTP + x402 | 0.005 | Every bounded published level with explicit position-side and liquidation-flow semantics |
| `/screenshots/liquidation-levels/{symbol}` | HTTP + x402 | 0.010 | Optional visual price/liquidation artifact |

`get_market_risk_context` already contains bounded news, carry, liquidations, and stress. The brief stops there. Deep and visual tiers intentionally buy dedicated products as independent cross-checks; an agent that does not need that redundancy should use the brief.

## Workflow

1. Call the free `get_market_catalog` tool and verify the route inventory, prices, networks, and schemas.
2. Preflight every item and the complete known charge against the caller's explicit total/per-call limits before resolution or any other paid work. The default example budget is 0.030 USDC total, 0.010 per call; it rejects all current bundles.
3. If the user supplied a name rather than an allowlisted symbol, resolve first. Stop on ambiguity. Then request the roundup, moving events and Market Risk.
4. Deep research adds Carry, Market Snapshot and Liquidation Map. By default any failure stops remaining items. Only `{ allowPartial: true }` permits continuing after an optional `omit_without_retry` item fails; required failures still stop.
5. For the visual tier, request the PNG only after the JSON evidence passes validation.
6. Require the expected service/schema, acceptable freshness, a successful settlement receipt, and canonical article URLs.
7. Synthesize agreements and contradictions. Cite the published roundup and distinguish editorial thesis from live observations.
8. Return a separate broker handoff proposal or `HOLD`. The bundle never places an order.

Do not automatically retry a paid call after a timeout or uncertain settlement. Omit an optional enrichment and reconcile its receipt or transaction first. A required roundup, moving-events, or Market Risk failure stops synthesis.

## Run from scratch

```bash
git clone https://github.com/InTheta/omni-universe-sdks.git
cd omni-universe-sdks/packages/typescript
npm ci
npm run example:ask-omni:demo
```

The demo uses deterministic placeholders, performs no external request, and makes no payment.

The example is qualified with hermetic tests and the no-spend demo, not a funded
run. Its existing default aggregate budget is 0.030 USDC, not 0.050 (the old
example's upper validation bound). Its default per-call cap remains 0.010 USDC.
Neither is silently raised. Paid opt-in alone is insufficient. A caller may
explicitly configure `X402_BUNDLE_MAX_USD` and `X402_MAX_PAYMENT_USD` after reviewing
prices; the selected plan still must fit both before any connection/payment.

To integrate a real bundle, first inspect the free catalog, select the exact
products, and obtain an explicit aggregate and per-call budget. Use the single
Market Risk example in the README for a smaller deliberately approved request.
The example retains settlement/schema validation, no-retry reconciliation and
broker separation. Each payment client is restricted to its item ceiling and
one authorization; even a library recovery path cannot create a second payment
payload. A changed challenge above an item ceiling fails closed.

### Reservation and failure contract

`BundleBudget.execute(operationId, plan, adapter, options)` synchronously reserves
the sum of all item ceilings before calling the adapter. Over-budget errors are
`BundleBudgetError` with code `BUNDLE_BUDGET_EXCEEDED`, `requiredAtomic`,
`availableAtomic`, `boundary` (`bundle` or `per_call`) and optional `stepId`.
Amounts are integer micro-USDC. No items are omitted to make a plan affordable.

Share one budget instance across concurrent requests. Reuse the same operation
ID and unchanged plan for retries; the original promise/result is returned with
no new work. A different plan with the same ID is rejected. This is in-memory
only: restarting, using another instance/process or a new ID is NOT a safe retry.
Use a durable caller ledger and independently reconcile ambiguous settlements
before any new authorization. No refund or financial atomicity is promised.

Adapters must bound signing to `step.priceAtomic` and at most one authorization.
Return `chargedAtomic` only when the actual charge is proven. Unknown amounts or
exceptions retain the full attempted item ceiling as `uncertainAtomic`; they are
not called actual charges and are never made available again in this instance.
Unattempted item reservations and proven unused amounts are released. The
example's receipts do not consistently expose exact amounts, so it retains the
ceiling even after a successful response. Partial results include item statuses,
proven charges, uncertain authorizations and unstarted items. Defaults stop on
failure; opt-in partial mode continues only after optional failures.

```ts
import { BundleBudget, createAskOmniBundlePlan } from "@omni-terminal/sdk";

const budget = new BundleBudget({ budgetUsd: 0.030, maxPaymentUsd: 0.010 });
const plan = createAskOmniBundlePlan({ symbol: "BTC", tier: "brief" });
// This throws before adapter execution: required 120000, available 30000.
// Use an adapter with step-specific/one-shot payment policies in a real integration.
await budget.execute("persisted-research-intent-id", plan, async () => {
  throw new Error("Not reached at these deliberately insufficient defaults");
});
```

Base mainnet is available only when `OMNI_X402_NETWORK=eip155:8453` is set explicitly and the dedicated wallet is funded. Start on Sepolia. Never use a broker, treasury, receiver, or general-purpose wallet as the payer.

## Agent prompt

```text
Name: Ask Omni Deep Market Research
Tagline: Published morning thesis plus live catalysts, carry, liquidations, and market structure
Cost per run: 0.133-0.134 USDC (current list prices; inspect live terms)
Success model: required core evidence; optional enrichments are omitted without automatic retry

You are a market-risk analyst. For the user's market question:

1. Call Omni's free get_market_catalog and verify current prices and schemas.
2. Resolve a non-canonical market name with resolve_market_entities. Stop if it is ambiguous.
3. Preflight the complete cost and every per-call ceiling, then call get_premarket_roundup(limit=1), get_market_moving_events(symbol=<symbol>, limit=5, event_window_minutes=60), and get_market_risk_context(symbol=<symbol>, scope=current, limit=5). For a historical brief, pass `date=YYYY-MM-DD` to the roundup tool.
4. For deep research, add get_market_carry plus the HTTP Market Snapshot and Liquidation Map. Continue after optional failures only if partial mode was explicitly selected.
5. Validate every schema, freshness object, and settlement receipt. Never treat a 402, timeout, malformed result, missing receipt, or stale required input as neutral evidence.
6. Produce:
   - Executive view: 2-3 sentences answering the question.
   - Published thesis: what the latest OmniTerminal roundup argues, with its canonical URL.
   - Live catalysts: 4-6 deduplicated findings with confidence and affected tickers.
   - Price and carry: mark, structure, 1h/8h/1d/APR funding, basis, and crowding.
   - Liquidation and margin stress: all relevant levels, flow direction, and +/-1/2/5/10% scenarios.
   - Agreements and contradictions: where the editorial thesis and live data differ.
   - Evidence table: schema, data_as_of, freshness, network, and transaction for each paid result.
   - Broker handoff: HOLD or a proposed symbol/side/type/max-notional for separate approval.
7. Keep editorial claims, live observations, inferences, and missing evidence visibly separate.
8. Never place an order and never send broker credentials or private account data to Omni.
```

## Other bundle use cases

- Pre-open watchlist: roundup + equities moving events; map affected tickers to the broker watchlist locally.
- Liquidation-risk alert: Market Risk + dedicated Liquidation Map; alert only when both agree and are fresh.
- Funding/carry monitor: Market Carry across supported symbols; compare mechanically projected 8h, 1d, and APR values.
- Visual review: Deep bundle + liquidation PNG for a visual-capable agent or human approval screen.
- Post-event audit: historical News Pulse window + current Market Risk, clearly labelling historical versus current evidence.
