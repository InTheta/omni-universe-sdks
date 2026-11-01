export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type X402Symbol = "BTC" | "ETH" | "SOL" | "HYPE";
/** Registry-validated perpetual subscription key, including qualified dex:COIN. */
export type PublicMarketSymbol = string;
export interface PublicMarketCatalog {
  service:"omni.public_market_catalog";
  schema:"public_market_catalog.v1";
  product_version:"v1";
  generated_at:string;
  data_as_of:string|null;
  freshness:Freshness;
  snapshot_revision:number;
  rows:Array<{canonical_symbol:string;subscription_key:string;symbol:string;venue:"hyperliquid";market_type:"perp";base:string;quote:string;dex:string;eligible_products:string[];availability_evaluated:false}>;
  pagination:{offset:number;limit:number;total:number;next_offset:number|null};
  scope:"current_hyperliquid_perpetual_identities";
  private_contexts_included:false;
}
export interface PublicMarketsQuery {limit?:number;offset?:number;search?:string;dex?:string;revision?:number}

export interface MarketMicrostructure {
  service: "omni.hyperliquid_market_microstructure";
  schema: "hyperliquid_market_microstructure.v1";
  product_version: "v1";
  symbol: string;
  venue: "hyperliquid";
  generated_at: string;
  observed_through: string;
  freshness: Freshness;
  orderbook: { data_as_of: string; depth: number; bids: Array<{ price:number; size:number; order_count:number }>; asks: Array<{ price:number; size:number; order_count:number }>; spread:number; midpoint:number; depth_size_imbalance:number };
  trades: Array<{ timestamp:number; price:number; size:number; aggressor_side:"buy"|"sell" }>;
  trade_flow: { buy_notional_usd:number; sell_notional_usd:number; net_aggressor_notional_usd:number; window_seconds:number; sampled:true; complete_window:false; source_returned_count:number; returned_count:number };
  provenance: Record<string,unknown>;
}
export interface FundingHistory {
  service:"omni.hyperliquid_funding_history";
  schema:"hyperliquid_funding_history.v1";
  product_version:"v1";
  symbol:string;
  venue:"hyperliquid";
  generated_at:string;
  observed_through:string;
  freshness:Freshness;
  from_timestamp:number;
  to_timestamp:number;
  rows:Array<{timestamp:number;funding_rate:number;premium:number}>;
  quality:{expected_interval_seconds:3600;gap_count:number;gap_count_basis:"interior_of_returned_rows_only";source_window_complete:false;expected_window_observations:number;source_returned_count:number;source_missing_leading_hours_estimate:number;source_missing_trailing_hours_estimate:number;missing_window_observations_estimate:number;actual_returned_from:number|null;actual_returned_to:number|null;truncated:boolean;empty:boolean};
  semantics:{funding_rate_unit:"fraction_per_hour";historical_settled_rates:true;open_interest_history_included:false};
  provenance:Record<string,unknown>;
}
export type LiquidationWindow="1m"|"5m"|"15m"|"1h";
export type SpotCandleInterval="1m"|"5m"|"15m"|"1h"|"4h"|"1d";
export interface SpotTokenIdentity {index:number;token_id:string;name:string;size_decimals:number;is_canonical:boolean}
export interface SpotMarketIdentity {market_id:string;market_type:"spot";pair_index:number;source_coin:string;base:SpotTokenIdentity;quote:SpotTokenIdentity;is_canonical_pair:boolean}
export interface PublicSpotMarketsQuery {limit?:number;offset?:number;revision?:string}
export interface PublicSpotMarketCatalog {
  service:"omni.public_spot_market_catalog";schema:"public_spot_market_catalog.v1";product_version:"v1";
  observed_at:string;metadata_revision:string;freshness:Freshness;source_timestamp_available:false;
  rows:Array<SpotMarketIdentity&{eligible_products:string[];availability_evaluated:false}>;
  pagination:{offset:number;limit:number;total:number;next_offset:number|null};private_contexts_included:false;
}
export interface SpotMarketQuote {
  service:"omni.hyperliquid_spot_quote";schema:"hyperliquid_spot_quote.v1";product_version:"v1";market:SpotMarketIdentity;
  generated_at:string;data_as_of:string;freshness:Freshness;
  quote:{best_bid:number;best_ask:number;midpoint:number;spread:number;price_unit:"quote_token"};
  depth:{limit:number;bids:Array<{price:number;size:number;order_count:number}>;asks:Array<{price:number;size:number;order_count:number}>;complete_book:false};
  context:{mark_price:number;previous_day_price:number;day_notional_volume_in_quote:number;day_base_volume:number|null;exchange_timestamp:null;observation_received_at:string;freshness_status:"unknown"};
  quality:Record<string,unknown>;provenance:Record<string,unknown>;
}
export interface SpotCandles {
  service:"omni.hyperliquid_spot_candles";schema:"hyperliquid_spot_candles.v1";product_version:"v1";market:SpotMarketIdentity;interval:SpotCandleInterval;
  generated_at:string;source_snapshot_observed_at:string;data_as_of:string|null;freshness:Freshness;from_timestamp:number;to_timestamp:number;
  candles:Array<{open_time:number;close_time:number;open:number;high:number;low:number;close:number;volume:number;trades:number;period_complete:boolean}>;
  quality:{source_returned_count:number;returned_count:number;truncated:boolean;empty:boolean;source_window_complete:false;interior_gap_count:number;requested_interval_count:number;missing_observations_estimate:number;freshness_basis:"latest_completed_candle_period_end";current_period_included:boolean;last_mutation_timestamp_available:false};
  semantics:{price_unit:"quote_token";volume_unit:"base_token";open_period_may_change:true};provenance:Record<string,unknown>;
}
export interface L4BookSnapshot {
  service:"omni.hyperliquid_l4_snapshot";schema:"hyperliquid_l4_snapshot.v1";product_version:"v1";symbol:string;venue:"hyperliquid";generated_at:string;data_as_of:string;freshness:Freshness;snapshot_block_height:string;
  bids:Array<{order_id:string;maker_address:string;price:number;size:number;notional_usd:number;created_at:string}>;
  asks:L4BookSnapshot["bids"];
  quality:{atomic_snapshot:true;complete_book:false;orders_per_side_limit:number;returned_bid_orders:number;returned_ask_orders:number;incremental_continuity_asserted:false};
  provenance:Record<string,unknown>;
}
export interface RealizedLiquidations {
  service:"omni.hyperliquid_realized_liquidations";schema:"hyperliquid_realized_liquidations.v1";product_version:"v1";symbol:string;scope:"current"|"aggregate";venue:"hyperliquid";generated_at:string;data_as_of:string;observed_through:string;freshness:Freshness;latest_liquidation_event_at:string|null;quiet_window:boolean;
  windows:Array<{window_seconds:number;from_timestamp:number;to_timestamp:number;observed_fill_count:number;total_notional_usd:number;buy_notional_usd:number;sell_notional_usd:number;largest_notional_usd:number;oldest_event_at:string|null;newest_event_at:string|null;coverage:{sampled:true;complete_window:false;tail_truncated:boolean;source_returned_rows:number;lower_bound:true}}>;
  quality:{sampled:true;complete_window:false;duplicate_rows_removed:number;ingestion_watermark_source:"global_public_fills_stream"};provenance:Record<string,unknown>;
}

export interface NewsAnalysisLineage {
  schema_version: string;
  prompt_version: string;
  model: string;
  validation_status: string;
  generated_at: string | null;
}

export interface NewsRevision {
  kind: "original" | "correction" | "backfill" | "reanalysis";
  supersedes_id: string | null;
  generated_at: string | null;
}

export interface NewsEvent {
  object: "news_event.v1";
  id: string;
  event_id: string;
  timestamp: number;
  headline: string;
  summary: string;
  direction: string;
  sentiment: number;
  bias: string;
  impact: string;
  tickers: string[];
  confidence: number;
  source: string;
  analysis_type: string;
  topics: string[];
  theme: string;
  event_type: string;
  importance: number;
  analysis: NewsAnalysisLineage;
  revision: NewsRevision;
  market_context: Record<string, unknown> | null;
}

export interface NewsResponse {
  data: NewsEvent[];
  items?: Record<string, unknown>[];
  next_before_timestamp: number | null;
  has_more: boolean;
}

export interface PublicNewsResponse {
  object: "list";
  api_version: string;
  tier: "pro" | "enterprise";
  data: NewsEvent[];
  pagination: {
    limit: number;
    next_before_timestamp: number | null;
    has_more: boolean;
  };
}

export interface NewsWebSocketTicket {
  ticket: string;
  expires_in: 60;
  single_use: true;
  websocket_path: "/ws/v1/news";
  max_connections: 2 | 10;
  idle_timeout_seconds: 120;
  recommended_ping_interval_seconds: 60;
  max_client_message_bytes: 4096;
}

export interface NewsQuery {
  object_version?: "news_event.v1";
  limit?: number;
  lookback_days?: number;
  before_timestamp?: number;
  market?: "crypto" | "tradfi";
  analysis_type?: string;
  topics?: string | string[];
}

export type AskOmniPreset =
  | "risk_overview" | "liquidation_check" | "leverage_check" | "performance_review"
  | "global_sentiment" | "tradfi_sentiment" | "energy_sentiment" | "btc_sentiment"
  | "oil_sentiment" | "hedge_first";

export interface AskOmniRequest {
  question?: string;
  presetId: AskOmniPreset;
  extraContext?: string;
  scopeAddress?: string;
  selectedSymbol?: string;
  liquidationScope?: string;
}

export interface X402NewsQuery {
  limit?: number;
  lookback_hours?: number;
  event_window_minutes?: 15 | 60;
  mode?: "latest" | "window" | "context";
  order?: "recent" | "impact";
  offset?: number;
  nearest_timestamp?: number;
  sentiment?: "bullish" | "bearish" | "neutral";
  impact?: "high" | "medium" | "low";
  min_confidence?: number;
}

export interface X402Health {
  status: "ready" | "configuration_required";
  service: "omni-x402-gateway";
  product?: string;
  protocol: "x402-v2";
  network: string;
  payment_enabled: boolean;
  bazaar_metadata?: boolean;
  discovery_catalog?: string;
  readiness_scope?: "payment_transport";
}

export interface X402AnalysisLineage {
  schema_version: string;
  prompt_version: string;
  model: string;
  validation_status: string;
}

export interface X402NewsItem {
  id: string;
  timestamp: number | null;
  headline: string;
  summary: string;
  direction: string;
  sentiment: number | null;
  impact: string;
  importance: number | null;
  confidence: number | null;
  impact_basis?: "unknown" | "source_importance_1_10_and_financial_event_evidence";
  lineage?: X402PublicNewsLineage;
  tickers: string[];
  topics: string[];
  theme: string;
  analysis_type: string;
  analysis: X402AnalysisLineage;
}

export interface X402PublicNewsLineage {
  event_id:string;content_hash:string;source_revision:string|null;source_event_at:string|null;
  generated_at:string|null;ingested_at:string|null;schema_version:string|null;
}

export interface X402ContextEvent {
  summary?: string;
  direction?: string;
  sentiment_rating?: number;
  confidence?: number;
  category?: string;
  tickers?: string[];
}

export interface X402MarketContext {
  object: "market_context.v1";
  generated_at: string;
  cadence_minutes: number;
  source_data_as_of?:string|null;
  source_coverage?:{oldest_event_at:string|null;newest_event_at:string|null;known_count:number|null;unknown_count:number|null};
  lineage?:X402PublicNewsLineage;
  source_window_hours: number | null;
  summary: string;
  direction: string;
  sentiment_rating: number | null;
  confidence: number | null;
  notable_tickers: string[];
  topics: string[];
  timeline: X402ContextEvent[];
}

export interface NewsPulse {
  service: "omni.ai_news_pulse";
  product_version: "v1";
  schema: "news_pulse.v1";
  symbol?: string;
  market: string;
  generated_at: string;
  data_as_of: string | null;
  freshness: Freshness & {
    components?:{events:Freshness;context:Freshness|null;ingestion:Freshness};observed_through?:string|null;
    latest_event_at?:string|null;latest_event_age_seconds?:number|null;quiet_window?:boolean;
    complete_window?:"unknown";analysis_catch_up?:"unknown";analysis_progress?:{persisted_at:string|null;source_event_at:string|null};
  };
  availability?:{events:"available"|"unavailable";context:"available"|"unavailable"|"not_requested"};
  market_context: X402MarketContext | null;
  items: X402NewsItem[];
  usage: {
    item_count: number;
    lookback_hours: number;
    event_window_minutes: 15 | 60;
  };
}

export type ScalarMap = Record<string, JsonPrimitive>;

export interface TraderPosition {
  coin?: string | null;
  size?: string | number | null;
  side?: string | null;
  entry_price?: string | number | null;
  position_value?: string | number | null;
  unrealized_pnl?: string | number | null;
  return_on_equity?: string | number | null;
  liquidation_price?: string | number | null;
  margin_used?: string | number | null;
  leverage?: ScalarMap | string | number | null;
  dex?: string | null;
}

export interface TraderSpotBalance {
  coin?: string | null;
  total?: string | number | null;
  held?: string | number | null;
  mark_price?: string | number | null;
  usd_value?: string | number | null;
}

export interface TraderProfile {
  service: "omni.trader_profile";
  product_version: "v1";
  schema: "trader_profile.v1";
  address: string;
  range: "1d" | "7d" | "30d" | "all";
  scope: "wallet";
  view: "summary" | "positions" | "balances" | "full";
  symbol?: string;
  generated_at: string;
  data_as_of: string | number | null;
  freshness: Freshness;
  market_reference: Record<string, unknown>;
  summary: ScalarMap;
  components: ScalarMap;
  positions: TraderPosition[];
  spot_balances: TraderSpotBalance[];
  activity: ScalarMap;
  quality: {
    degraded_sources?: string[]; portfolio_history_used?: JsonPrimitive;
    valuation_complete?:boolean;valuation_status?:"complete"|"partial"|"unavailable";missing_valuation_fields?:string[];
    positions?:{source_returned_count:number;returned_count:number;omitted_by_view:boolean;truncated_by_limit:boolean;source_collection_complete:false};
    spot_balances?:{source_returned_count:number;returned_count:number;omitted_by_view:boolean;truncated_by_limit:boolean;source_collection_complete:false};
  };
  usage: { position_count: number; spot_balance_count: number };
}

export interface LiquidationLevel {
  liquidation_price: number | null;
  position_side: "long" | "short";
  liquidation_flow: "buy" | "sell";
  reference_price: number;
  reference_price_source: "hyperliquid_mark_px";
  distance_from_reference_usd: number | null;
  distance_from_reference_pct: number | null;
  distance_from_reference_bps: number | null;
  absolute_distance_from_reference_pct: number | null;
  relative_to_reference: "below" | "at" | "above" | null;
  size: number | null;
  value: number | null;
  position_count: number | null;
  long_position_count?: number | null;
  short_position_count?: number | null;
}

export interface LiquidationLevels {
  buy: LiquidationLevel[];
  sell: LiquidationLevel[];
  side_meaning: Record<"buy" | "sell", string>;
  side_semantics: Record<"buy" | "sell", { position_side: "long" | "short"; liquidation_flow: "buy" | "sell" }>;
  order: "strongest" | "nearest" | "price";
  published_buy_count: number;
  published_sell_count: number;
  available_buy_count: number;
  available_sell_count: number;
  complete: boolean;
}

export interface LiquidationMap {
  service: "omni.hyperliquid_liquidation_map";
  product_version: "v1";
  schema: "hyperliquid_liquidation_map.v1";
  symbol: string;
  scope: "current" | "aggregate";
  view: "summary" | "buckets" | "clusters" | "flow";
  generated_at: string;
  data_as_of: string | number | null;
  freshness: Freshness;
  summary: Record<string, unknown>;
  levels: LiquidationLevels;
  margin_stress: Record<string, unknown> | null;
  nearest?: Array<Record<string, unknown>>;
  largest?: Array<Record<string, unknown>>;
  buckets?: Array<Record<string, unknown>>;
  clusters?: Record<string, unknown>;
  flow?: Array<Record<string, unknown>>;
  usage: Record<string, unknown>;
}

export interface TraderLeaderboard {
  service: "omni.hyperliquid_trader_leaderboard";
  product_version: "v1";
  schema: "hyperliquid_trader_leaderboard.v1";
  symbol: string;
  scope: "current" | "aggregate";
  rank: "best" | "worst" | "largest" | "largest_size" | "wallet_size" | "risk" | "closest";
  generated_at: string;
  data_as_of: string | number | null;
  freshness: Freshness;
  rows: Array<Record<string, unknown>>;
  ranking?: { basis: string; order: "ascending" | "descending"; pnl_currency: "USD"; realized_pnl_included: false; historical_performance_included: false };
  provenance?: { venue: "hyperliquid"; dataset: "public_position_snapshot"; population: string; observed_position_count: number | null; published_ranking_count: number; exhaustive_all_wallets: false };
  usage: Record<string, unknown>;
}

export interface MarketSnapshotCandle {
  open_time: number | null;
  close_time: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  trades: number | null;
}

export interface MarketSnapshot {
  service: "omni.hyperliquid_market_snapshot";
  product_version: "v1";
  schema: "hyperliquid_market_snapshot.v1";
  symbol: string;
  interval: string;
  scope: "current" | "aggregate";
  generated_at: string;
  observed_through?: string;
  latest_candle_period_end?: string | null;
  data_as_of: string | null;
  freshness: Freshness;
  candles: MarketSnapshotCandle[];
  funding: MarketCarry;
  liquidation_overlay?: LiquidationMap | null;
  usage: Record<string, unknown>;
}

export interface EntityResolutionItem {
  input: string;
  normalized_alias: string;
  resolution_status: "resolved" | "unsupported";
  canonical_symbol: string | null;
  eligible_products?:string[];
  availability_evaluated?:false;
  venue?: "hyperliquid";
  base?: string;
  quote?: string;
  settle?: string;
  market_type?: string;
  dex?: string;
  subscription_key?: string;
  asset_id?: number | null;
  match_kind?: "canonical" | "alias" | "name_alias";
  confidence: number;
  alternatives: string[];
  product_supported: boolean;
}

export interface EntityResolution {
  service: "omni.market_entity_resolution";
  product_version: "v1";
  schema: "market_entity_resolution.v1";
  generated_at: string;
  data_as_of: string | null;
  freshness: Freshness;
  registry: {
    version: "hl_meta_ctx.v1";
    snapshot_revision: number | null;
    temporal_mode: "current";
    historical_as_of_supported: false;
  };
  venue: "hyperliquid";
  results: EntityResolutionItem[];
  usage: { mention_count: number; resolved_count: number; mention_limit: 20 };
}

export interface Freshness {
  status: "fresh" | "stale" | "historical" | "unknown";
  data_as_of?: string | null;
  age_seconds: number | null;
  max_age_seconds: number;
}

export interface MarketCarry {
  service: "omni.hyperliquid_market_carry";
  product_version: "v1";
  schema: "hyperliquid_market_carry.v1";
  symbol: string;
  canonical_symbol: string;
  venue: "hyperliquid";
  market_type: "perp";
  dex: string;
  quote: string;
  generated_at: string;
  data_as_of: string | null;
  freshness: Freshness;
  carry: {
    funding_rate_per_hour: number;
    funding_rate_8h: number;
    funding_rate_1d: number;
    funding_apr_pct: number;
    funding_annualized_pct: number;
    annualization_method: "simple_current_hourly_rate_x_8760";
    projection_basis: "current_hourly_rate_mechanical_projection";
    settlement_interval: "1h";
    funding_direction: "longs_pay_shorts" | "shorts_pay_longs" | "balanced";
    premium: number | null;
  };
  positioning: {
    open_interest_base?: number;
    open_interest_usd?: number;
    day_base_volume?: number | null;
    day_notional_volume_usd?: number | null;
  };
  prices: {
    mark?: number;
    oracle?: number | null;
    midpoint?: number | null;
    previous_day?: number | null;
    mark_oracle_basis_bps?: number | null;
    price_change_24h_pct?: number | null;
  };
  usage: { current_snapshot_only: true; historical_series_included: false };
}

export interface MarketRisk {
  service: "omni.market_risk_snapshot";
  product_version: "v1";
  schema: "market_risk_snapshot.v1";
  symbol: string;
  scope: "current" | "aggregate";
  generated_at: string;
  data_as_of: string | null;
  freshness: Record<string, unknown>;
  liquidations: LiquidationMap;
  funding: MarketCarry;
  news: NewsPulse;
  usage: { event_window_minutes: 15 | 60; component_limit: number };
}

export interface PublishedPremarketRoundup {
  title: string;
  subtitle: string;
  excerpt: string;
  published_at: string;
  canonical_url: string;
  kind: "pre_market_roundup";
  topics: string[];
  word_count: number | null;
}

export interface PremarketRoundupQuery {
  /** Number of matching roundups to return (1-5). */
  limit?: number;
  /** Exact publication date in YYYY-MM-DD. Omit for the latest published roundup. */
  date?: string;
}

export interface PremarketRoundup {
  service: "omni.premarket_roundup";
  product_version: "v1";
  schema: "premarket_roundup.v1";
  generated_at: string;
  data_as_of: string;
  freshness: Freshness;
  publication: {
    name: "OmniTerminal";
    archive_url: string;
  };
  items: PublishedPremarketRoundup[];
  usage: {
    selection_mode: "latest" | "date";
    requested_date: string | null;
    item_count: number;
    item_limit: number;
    examined_count: number;
    excerpt_character_limit: number;
    full_article_included: false;
  };
}

export interface PaymentReceipt {
  success?: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  [key: string]: unknown;
}

export interface PaidResult<T> {
  data: T;
  payment: PaymentReceipt | null;
  requestId: string | null;
}

export interface WebSocketEvent<T = unknown> {
  data: T;
  receivedAt: number;
}

export type OrderSide = "BUY" | "SELL";

export interface AgentDecision {
  symbol: string;
  side: OrderSide | "HOLD";
  confidence: number;
  rationale: string[];
  maxNotionalUsd: number;
}

/** Curated, sampled public events; availability requires a qualified DEV/successor seller. */
export type PublicMarketAlertType = "large_liquidation" | "large_trader_action";
export interface PublicMarketAlertsQuery { limit?:number; lookback_hours?:number; before_timestamp?:number; types?:readonly PublicMarketAlertType[] }
export type PublicMarketAlertEvent = {
  id:string;address:string;symbol:string;event_at:string;freshness:Freshness;
} & ({kind:"liquidation_fill";source_alert_type:"large_liquidation";source_timestamp_basis:"hyperliquid_native_fill_time";trade_id:string;execution_side:"buy"|"sell";liquidated_position_side:"long"|"short";price:number;base_size:number;notional_usd:number|null;quote_currency:string|null;notional_quote:number|null;notional_basis:"USDC_settled_protocol_price_times_size"|"quote_identity_not_proven_USDC"}
 | {kind:"observed_position_change";source_alert_type:"large_trader_action";source_timestamp_basis:"observed_position_row_version";before_observed_at:string;before_base_size:number;after_base_size:number;change:"opening"|"closing"|"reversing"|"increasing"|"reducing";execution_cause:"unconfirmed"});
export interface PublicMarketAlerts {
  service:"omni.public_market_alerts";schema:"public_market_alerts.v1";product_version:"v1";symbol:string;canonical_symbol:string|null;venue:"hyperliquid";market_type:"perp";
  generated_at:string;data_as_of:string|null;freshness:Freshness;events:PublicMarketAlertEvent[];
  coverage:{sampled:true;complete_window:"unknown";quiet_window_proven:false;source_limit:500;market_filter_applied_after_source_limit:true;source_limit_reached:boolean;invalid_source_rows_excluded:boolean};
  query:{limit:number;lookback_hours:number;before_timestamp:number|null;types:PublicMarketAlertType[]};
  provenance:Record<string,unknown>;capabilities:Record<string,unknown>;
}

/** Historical House disclosures. Reported amounts are strings/ranges, not execution values. */
export interface PublicCongressQuery { limit?:number; offset?:number; public_revision?:string }
export interface PublicCongressRow {
 id:string;row_index:number;asset:string;ticker:string|null;ticker_resolution:"reported_in_filing"|"unresolved";asset_type:string;
 transaction_type:"buy"|"sell"|"exchange";reported_amount:string;amount_currency:"USD";amount_basis:"reported_disclosure_range_or_amount";
 transaction_date:string;notification_date:string;owner_code:"SP"|"JT"|"DC"|null;sale_kind:"partial"|"total"|"full"|null;
}
export interface PublicCongressFiling {
 service:"omni.public_congress_filing";schema:"public_congress_filing.v1";product_version:"v1";source:"house_clerk";chamber:"House";
 doc_id:string;member:string;official_url:string;disclosure_date:string;parsed_at:string;public_revision:string;rows:PublicCongressRow[];
 pagination:{limit:number;offset:number;source_row_count:number;returned_count:number;next_offset:number|null};
 freshness:{status:"historical";data_as_of:string;source_poll_status:"unknown";timestamp_precision:"date"};
 coverage:{parser_completed:true;document_rows_complete:"unknown";global_completeness:"unknown";amendment_status:"unknown";source_parsed_row_count:number};
 capabilities:{chambers:readonly ["House"]|readonly string[];source:"house_clerk";lookup:"official_document_id";discovery:"not_available";coverage:"cached_parsed_documents_only";document_rows_complete:"unknown";global_completeness:"unknown";amendment_status:"unknown";amount_semantics:"reported_USD_range_or_amount_not_execution_value";senate:"unqualified"};
}

export type PublicWalletGraphSymbol="BTC"|"ETH"|"SOL";
export interface PublicWalletGraphQuery {limit?:number;edge_limit?:number}
export interface PublicWalletLinksQuery {limit?:number}
export interface PublicWalletGraphNode {address:string;gross_source_notional:number;net_source_notional:number;notional_currency:null;notional_basis:"upstream_position_value_aggregate_quote_identity_unknown"}
export interface PublicWalletGraphEdge {source:string;target:string;relation:"behavioral_similarity"|"direction_alignment"|"direction_opposition";heuristic_score:number;overlap_score:number;size_similarity_score:number;identity_confirmed:false;correlation:null;timing_synchronization:null;unavailable_metrics:readonly ["correlation","timing_synchronization"]}
export interface PublicWalletGraphMetadata {
 service:"omni.public_wallet_graph";schema:"public_wallet_graph.v1";product_version:"v1";symbol:PublicWalletGraphSymbol;window:"24h";bucket:"5m";
 generated_at:string;artifact_generated_at:string;data_as_of:string;freshness:Freshness&{basis:"hyperliquid_clearinghouse_state_time_v1"};
 market_scope:"observed_hyperliquid_perpetual_base_symbol_across_dexes";
 methodology:{method:"nearest_neighbor_exposure_behavior_heuristic";run_id:string;graph_version:string;feature_version:string;model_version:string;algo_version:string;identity_proof:false;history_bucket_basis:"database_persistence_time"};
 source_quality:{source_observed_min:string;source_observed_through:string;history_observed_min:string;history_observed_through:string;live_rows:number;qualified_live_rows:number;history_rows:number;qualified_history_rows:number;population_complete:"unknown";complete_window:"unknown";excluded_population:"configured_observed_population_filter"};
 nodes:PublicWalletGraphNode[];
 coverage:{source_nodes:number;source_edges:number;returned_nodes:number;returned_edges:number;truncated:boolean;complete_graph:false;absence_means?:"not_present_in_observed_thresholded_graph"};
}
export interface PublicWalletGraph extends PublicWalletGraphMetadata {view:"graph";edges:PublicWalletGraphEdge[]}
export interface PublicWalletPair extends PublicWalletGraphMetadata {view:"pair";wallet_a:string;wallet_b:string;pair:PublicWalletGraphEdge|null}
export interface PublicWalletLinks extends PublicWalletGraphMetadata {view:"links";address:string;links:PublicWalletGraphEdge[]}
export type PublicWalletGraphResult=PublicWalletGraph|PublicWalletPair|PublicWalletLinks;
