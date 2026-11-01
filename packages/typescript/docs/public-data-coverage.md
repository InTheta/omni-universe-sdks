# Public data coverage (unreleased)

These recipes target the expanded seller contract. They do not claim that a deployed seller has
already enabled it. Discover the free catalog and inspect the seller's capability metadata first.

`OmniX402Client.marketInstruments()` and `OmniMcpClient.marketInstrumentsData()` list current
Hyperliquid perpetual identities without signing or paying. Queries are bounded to 50 rows with
literal search/DEX filters, an offset and optional snapshot revision binding. Reuse the returned
revision while paging; refetch on revision change. Rows declare eligible products, not live data
availability. Registry-derived analytics accept `PublicMarketSymbol`, including `xyz:SPCX`.

`marketMicrostructure(symbol, { depth, trade_limit, trade_window_seconds })` and
`fundingHistory(symbol, { lookback_hours, limit })` return paid versioned products. Recent trade
flow is explicitly sampled and cannot establish complete interval volume. Funding history reports
its actual returned range, interior gaps and estimated missing boundary hours; a fresh last row
does not establish a complete historical window. No historical OI is implied.

`l4BookSnapshot(symbol, { orders_per_side })` returns a bounded atomic book, exact maker addresses
and string order IDs. `realizedLiquidations(symbol, { scope, windows })` returns sampled lower-bound
windows (`1m`, `5m`, `15m`, `1h`), actual event bounds and source watermark semantics. Their MCP
counterparts are `l4BookSnapshotData` and `realizedLiquidationsData`. The seller rejects an older,
unqualified liquidation source contract rather than labeling its windows complete.

Spot uses separate explicit pair identities: `spotMarketInstruments()` returns a bounded free
catalog with pair index, token IDs and SHA-256 metadata revision. `spotMarketQuote(pairIndex)` and
`spotCandles(pairIndex, { interval, limit })` never infer a perpetual ticker. MCP uses the matching
`spotMarketInstrumentsData`, `spotMarketQuoteData` and `spotCandlesData` methods. Book timestamps
qualify quote freshness; attached context has observation-only freshness. Candle freshness uses
the last completed period; the included current candle can change. Metadata has no invented source
timestamp. Prices and notionals are in the quote token, not necessarily US dollars.

MCP adds direct profile, leaderboard, liquidation map and market snapshot JSON recipes. Use
`screenshotData(toolName, args)` for the three native image tools. The client requires a successful
settlement, bounded PNG bytes and metadata matching the exact product. A valid PNG is not proof
that every account valuation is complete; inspect the rendered quality warning.

News, composite news/risk, screenshot symbols and profile filters retain their explicit admitted
symbols until their own identities are qualified. The SDK never strips a HIP-3 namespace to query
an unrelated ticker. Leaderboard PnL is current unrealized position PnL, not lifetime realized
performance. Full public addresses are preserved.

Direct commodity Hyperliquid reads remain in the existing direct public API client. Paid recipes
add bounded normalization, quality checks, derived flow or coverage semantics rather than replacing
that direct API boundary. This source change neither authorizes spending nor changes payer policy.

## Optional broker authentication and security qualification

Public data consumers do not install Coinbase's custody SDK. The separate `@omni-terminal/sdk/brokers`
entry remains importable, including Robinhood, without it. Coinbase requests require an explicitly
installed optional peer, `@coinbase/cdp-sdk@^1.60.0`; a missing peer fails before any broker request.
Development tests retain the peer so broker behavior is exercised.

The Coinbase peer remains **unqualified for release security**: its latest dependency tree retains
upstream Zod 3/abitype advisories. Making it optional does not repair those dependencies or qualify
Coinbase trading. The packed public-data-only consumer is independently audited; package development
audits must still disclose the optional broker dependency findings. No custody or trading acceptance
is implied by public-data verification.
