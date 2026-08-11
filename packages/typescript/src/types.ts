export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type X402Symbol = "BTC" | "ETH" | "SOL" | "HYPE";

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

export interface AskOmniRequest {
  question?: string;
  presetId?: string;
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
}

export interface X402AnalysisLineage {
  schema_version: string;
  prompt_version: string;
  model: string;
  validation_status: string;
}

export interface X402NewsItem {
  id: string;
  timestamp: number;
  headline: string;
  summary: string;
  direction: string;
  sentiment: number;
  impact: string;
  importance: number;
  confidence: number;
  tickers: string[];
  topics: string[];
  theme: string;
  analysis_type: string;
  analysis: X402AnalysisLineage;
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
  cadence_minutes: 15;
  source_window_hours: number | null;
  summary: string;
  direction: string;
  sentiment_rating: number;
  confidence: number;
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
  data_as_of: string;
  freshness: Freshness;
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
  quality: { degraded_sources?: string[]; portfolio_history_used?: JsonPrimitive };
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
