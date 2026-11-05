# Public wallet graph extension (GH237)

This extension is source-only on the new House+graph SDK candidate. Frozen SDK17 and its published version remain unchanged. Producer activation is default-OFF until owner storage migration and runtime qualification. Legacy artifacts without original native observation clocks fail closed at the seller. Methods/types do not prove that the deployed product is active.

```ts
const graph = await x402.walletGraph("BTC", { limit: 20, edge_limit: 40 });
const pair = await x402.walletPair("BTC", fullAddressA, fullAddressB);
const links = await x402.walletLinks("BTC", fullAddressA, { limit: 20 });
const graphViaMcp = await mcp.walletGraphData("BTC", { limit: 20 });
const pairViaMcp = await mcp.walletPairData("BTC", fullAddressA, fullAddressB);
const linksViaMcp = await mcp.walletLinksData("BTC", fullAddressA, { limit: 20 });
```

All three views share `omni.public_wallet_graph` / `public_wallet_graph.v1`, collection `nodes`, fixed24h/5m source artifact. REST paths are `/api/x402/v1/wallet-graph/:symbol`, `/wallet-pair/:symbol/:address_a/:address_b`, `/wallet-links/:symbol/:address`; MCP tools are `get_wallet_graph`, `get_wallet_pair`, `get_wallet_links`. Server default price is $0.005 USDC per independently authorized call. Existing grant/payment/total ceilings apply; this example does not authorize spending or retries.

Only BTC, ETH and SOL aggregate observed perpetual base-symbol populations are supported, including included Hyperliquid dex markets. This is not a single canonical market or a complete venue population. Namespaced/single-market inputs, private model/filter controls and unsupported symbols fail before transport. Graph query limit1..50 default20 and edge_limit1..100 default40; links limit1..50 default20; pair has no query and requires distinct full42character addresses. Full syntactic public addresses (including zero syntax) are normalized lowercase; this does not prove an owned/funded account or authorize an action.

Edges are heuristic `behavioral_similarity`, `direction_alignment` or `direction_opposition`; none prove common ownership, identity, copying or coordination. `identity_confirmed=false`; correlation and timing synchronization are unavailable/null, not measured zeros. Public version/run labels identify methodology, not training quality or a commercial model approval.

Node gross/net values retain source aggregates with `notional_currency:null` and `upstream_position_value_aggregate_quote_identity_unknown`; do not label them USD, infer execution values or value a portfolio from them. Original native clearinghouse observation watermarks and qualified source row counts remain separate from artifact generation and historical database persistence bucket time. New generation does not refresh an old source; stale remains stale. Population/window completeness is unknown, complete_graph false, configured population filtering explicit without revealing private thresholds.

Pair/links derive from the same qualified thresholded graph. A missing pair is `not_present_in_observed_thresholded_graph`, not evidence of unrelated wallets. Returned nodes/edges, truncation and underlying source sizes are explicit. Client guards check view/symbol/full-wallet identity, scope, original source-clock basis, source quality, page bounds, null currency and nonidentity semantics. Malformed paid REST/MCP results require redacted reconciliation and are not automatically safe to buy again.

Focused check: `node --import tsx --test test/wallet-graph.test.ts`. Six tests cover exact REST/MCP recipes, zero-transport invalid requests, malformed paid scope/provenance/identity/currency, explicit absence, and stale original source clocks. No live graph, paid settlement, producer activation or deployed acceptance claim follows from these component tests.

## Byte budget and honest publication freshness

Requested graph/link limits are maxima. A dense valid artifact can be deterministically shortened to the configured public response-byte budget. Optional `coverage.byte_budget_truncated=true` identifies that reduction; returned node/edge counts and truncation remain accurate, and every returned edge endpoint remains present in returned nodes. A truncated graph or links page is not a complete relationship census.

Legacy trader leaderboards and liquidation analyses can declare `freshness.basis=published_analysis_snapshot`: the analysis was published recently, while its original input clocks are not proved. Optional `source_quality` carries `PublishedAnalysisInputQuality` with unknown input-observation status, null source watermark and unknown completeness/legacy clock coverage. Liquidation maps nest it under liquidations; market-risk nests the liquidation map quality; snapshots nest the optional liquidation overlay quality. Do not describe fresh publication as verified fresh native input, nor replace unknown input time with snapshot generation. These fields are additive; older responses without them remain typed, and missing quality does not establish input freshness.
