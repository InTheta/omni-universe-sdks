# Ask Omni research bundles

An Ask Omni bundle is an agent recipe over separately settled Omni x402 products. It is not one opaque paid endpoint: the agent sees each resource, price, schema, freshness field, and settlement receipt before it synthesizes an answer.

This follows the bundle pattern used by Agentic Market: quote a bounded run cost, name every service, run independent calls in parallel, make enrichments optional, and define a no-retry fallback.

## Bundle menu

| Bundle | Evidence | Cost with a canonical symbol | Cost with entity resolution |
| --- | --- | ---: | ---: |
| Ask Omni Market Brief | Published roundup + live moving events + Market Risk | 0.016 USDC | 0.017 USDC |
| Ask Omni Deep Market Research | Brief + Carry + Market Snapshot + full Liquidation Map | 0.029 USDC | 0.030 USDC |
| Ask Omni Visual Risk Pack | Deep + liquidation-level PNG | 0.039 USDC | 0.040 USDC |

The prices above are the current maximum list-price sum. The unpaid challenge is the authority for current terms. Do not sign if a route, asset, network, recipient, or amount differs from policy.

## Services used

| Service | Transport | Price | Role |
| --- | --- | ---: | --- |
| `resolve_market_entities` | Omni MCP + x402 | 0.001 | Optional normalization of names such as `bitcoin` or `BTC-PERP` |
| `get_premarket_roundup` | Omni MCP + x402 | 0.005 | Latest (default) or exact-date published morning thesis, sanitized excerpt, and canonical article URL |
| `get_market_moving_events` | Omni MCP + x402 | 0.001 | Fresh catalysts, sentiment, impact, confidence, and affected tickers |
| `get_market_risk_context` | Omni MCP + x402 | 0.010 | Required mark-anchored liquidation pressure, margin stress, carry, and news gate |
| `get_market_carry` | Omni MCP + x402 | 0.003 | Dedicated 1h funding and mechanical 8h, 1d, and APR cross-check |
| `/market-snapshot/{symbol}` | HTTP + x402 | 0.005 | Price structure, OHLCV, funding, and liquidation overlay |
| `/liquidations/{symbol}` | HTTP + x402 | 0.005 | Every bounded published level with explicit position-side and liquidation-flow semantics |
| `/screenshots/liquidation-levels/{symbol}` | HTTP + x402 | 0.010 | Optional visual price/liquidation artifact |

`get_market_risk_context` already contains bounded news, carry, liquidations, and stress. The brief stops there. Deep and visual tiers intentionally buy dedicated products as independent cross-checks; an agent that does not need that redundancy should use the brief.

## Workflow

1. Call the free `get_market_catalog` tool and verify the route inventory, prices, networks, and schemas.
2. If the user supplied a name rather than an allowlisted symbol, call `resolve_market_entities` first. Stop on ambiguity.
3. Run the published roundup, moving-events, and Market Risk calls in parallel.
4. For deep research, run Carry, Market Snapshot, and Liquidation Map in parallel. They are optional enrichments.
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

For a tiny funded Base Sepolia run, use a dedicated low-balance buyer wallet:

```bash
OMNI_X402_NETWORK=eip155:84532 \
OMNI_ASK_OMNI_TIER=deep \
OMNI_SYMBOL=BTC \
OMNI_MARKET_MENTION=bitcoin \
X402_BUNDLE_MAX_USD=0.030 \
RUN_PAID_ASK_OMNI_BUNDLE=yes \
EVM_PRIVATE_KEY=0x... \
npm run example:ask-omni
```

The example checks the full bundle ceiling before the first paid call and enforces 0.010 USDC per call. It returns `ask_omni_bundle.v1` evidence and settlement objects; it does not call a broker.

Base mainnet is available only when `OMNI_X402_NETWORK=eip155:8453` is set explicitly and the dedicated wallet is funded. Start on Sepolia. Never use a broker, treasury, receiver, or general-purpose wallet as the payer.

## Agent prompt

```text
Name: Ask Omni Deep Market Research
Tagline: Published morning thesis plus live catalysts, carry, liquidations, and market structure
Cost per run: 0.029-0.030 USDC
Success model: required core evidence; optional enrichments are omitted without automatic retry

You are a market-risk analyst. For the user's market question:

1. Call Omni's free get_market_catalog and verify current prices and schemas.
2. Resolve a non-canonical market name with resolve_market_entities. Stop if it is ambiguous.
3. In parallel, call get_premarket_roundup(limit=1), get_market_moving_events(symbol=<symbol>, limit=5, event_window_minutes=60), and get_market_risk_context(symbol=<symbol>, scope=current, limit=5). For a historical brief, pass `date=YYYY-MM-DD` to the roundup tool.
4. For deep research, also run get_market_carry plus the HTTP Market Snapshot and Liquidation Map products in parallel.
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
