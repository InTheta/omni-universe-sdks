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
