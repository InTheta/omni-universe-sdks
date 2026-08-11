import type { X402Symbol } from "./types.js";

export type AskOmniBundleTier = "brief" | "deep" | "visual";
export type AskOmniBundleTransport = "mcp+x402" | "http+x402";

export interface AskOmniBundleStep {
  id:
    | "resolve_entities"
    | "published_roundup"
    | "moving_events"
    | "market_risk"
    | "market_carry"
    | "market_snapshot"
    | "liquidation_map"
    | "liquidation_visual";
  transport: AskOmniBundleTransport;
  tool?: string;
  resource?: string;
  schema: string;
  priceUsdc: string;
  priceAtomic: number;
  required: boolean;
  parallelGroup: number;
  purpose: string;
  failurePolicy: "stop" | "omit_without_retry";
}

export interface AskOmniBundlePlan {
  schema: "ask_omni_bundle_plan.v1";
  name: string;
  tagline: string;
  tier: AskOmniBundleTier;
  symbol: X402Symbol;
  mention?: string;
  estimatedCostUsdc: string;
  maxCostAtomic: number;
  steps: AskOmniBundleStep[];
  executionBoundary: {
    researchOnly: true;
    placesOrders: false;
    brokerHandoffRequiresSeparateApproval: true;
  };
}

const step = (
  value: Omit<AskOmniBundleStep, "priceUsdc">,
): AskOmniBundleStep => ({
  ...value,
  priceUsdc: (value.priceAtomic / 1_000_000).toFixed(3),
});

const coreSteps = (symbol: X402Symbol): AskOmniBundleStep[] => [
  step({
    id: "published_roundup",
    transport: "mcp+x402",
    tool: "get_premarket_roundup",
    schema: "premarket_roundup.v1",
    priceAtomic: 5_000,
    required: true,
    parallelGroup: 1,
    purpose: "Add the latest citable Omni morning thesis and canonical publication link.",
    failurePolicy: "stop",
  }),
  step({
    id: "moving_events",
    transport: "mcp+x402",
    tool: "get_market_moving_events",
    schema: "news_pulse.v1",
    priceAtomic: 1_000,
    required: true,
    parallelGroup: 1,
    purpose: "Find fresh catalysts, sentiment, impact, confidence, and affected tickers.",
    failurePolicy: "stop",
  }),
  step({
    id: "market_risk",
    transport: "mcp+x402",
    tool: "get_market_risk_context",
    schema: "market_risk_snapshot.v1",
    priceAtomic: 10_000,
    required: true,
    parallelGroup: 1,
    purpose: `Gate ${symbol} decisions with mark-anchored liquidation pressure, margin stress, carry, and news.`,
    failurePolicy: "stop",
  }),
];

const deepSteps = (symbol: X402Symbol): AskOmniBundleStep[] => [
  step({
    id: "market_carry",
    transport: "mcp+x402",
    tool: "get_market_carry",
    schema: "hyperliquid_market_carry.v1",
    priceAtomic: 3_000,
    required: false,
    parallelGroup: 1,
    purpose: "Cross-check 1h funding plus mechanical 8h, 1d, and APR projections.",
    failurePolicy: "omit_without_retry",
  }),
  step({
    id: "market_snapshot",
    transport: "http+x402",
    resource: `/api/x402/v1/market-snapshot/${symbol}?interval=1h&limit=120&scope=aggregate&include_liquidations=true`,
    schema: "hyperliquid_market_snapshot.v1",
    priceAtomic: 5_000,
    required: false,
    parallelGroup: 1,
    purpose: "Add bounded price structure, OHLCV, funding, and liquidation overlay.",
    failurePolicy: "omit_without_retry",
  }),
  step({
    id: "liquidation_map",
    transport: "http+x402",
    resource: `/api/x402/v1/liquidations/${symbol}?scope=current&view=clusters&order=nearest&limit=20&side=all`,
    schema: "hyperliquid_liquidation_map.v1",
    priceAtomic: 5_000,
    required: false,
    parallelGroup: 1,
    purpose: "Cross-check every bounded published level and explicit liquidation-flow direction.",
    failurePolicy: "omit_without_retry",
  }),
];

export function createAskOmniBundlePlan(options: {
  tier?: AskOmniBundleTier;
  symbol: X402Symbol;
  mention?: string;
}): AskOmniBundlePlan {
  const tier = options.tier ?? "deep";
  if (!["brief", "deep", "visual"].includes(tier)) {
    throw new RangeError("tier must be one of: brief, deep, visual");
  }
  if (!["BTC", "ETH", "SOL", "HYPE"].includes(options.symbol)) {
    throw new RangeError("symbol must be one of: BTC, ETH, SOL, HYPE");
  }
  const mention = options.mention?.trim();
  if (mention !== undefined && (mention.length < 1 || mention.length > 100)) {
    throw new RangeError("mention must contain 1 to 100 characters");
  }
  const steps = coreSteps(options.symbol);
  if (mention) {
    steps.unshift(
      step({
        id: "resolve_entities",
        transport: "mcp+x402",
        tool: "resolve_market_entities",
        schema: "market_entity_resolution.v1",
        priceAtomic: 1_000,
        required: true,
        parallelGroup: 0,
        purpose: `Resolve ${mention} to the canonical ${options.symbol} market before paid research.`,
        failurePolicy: "stop",
      }),
    );
  }
  if (tier === "deep" || tier === "visual") steps.push(...deepSteps(options.symbol));
  if (tier === "visual") {
    steps.push(
      step({
        id: "liquidation_visual",
        transport: "http+x402",
        resource: `/api/x402/v1/screenshots/liquidation-levels/${options.symbol}?interval=1d&scope=aggregate&layout=standard`,
        schema: "omni_screenshot.v1",
        priceAtomic: 10_000,
        required: false,
        parallelGroup: 2,
        purpose: "Add a visual price-and-liquidation artifact after the JSON evidence is available.",
        failurePolicy: "omit_without_retry",
      }),
    );
  }
  const maxCostAtomic = steps.reduce((total, item) => total + item.priceAtomic, 0);
  return {
    schema: "ask_omni_bundle_plan.v1",
    name: tier === "brief" ? "Ask Omni Market Brief" : tier === "deep" ? "Ask Omni Deep Market Research" : "Ask Omni Visual Risk Pack",
    tagline: "Published morning thesis plus live catalysts, carry, liquidations, and market structure",
    tier,
    symbol: options.symbol,
    ...(mention ? { mention } : {}),
    estimatedCostUsdc: (maxCostAtomic / 1_000_000).toFixed(3),
    maxCostAtomic,
    steps,
    executionBoundary: {
      researchOnly: true,
      placesOrders: false,
      brokerHandoffRequiresSeparateApproval: true,
    },
  };
}
