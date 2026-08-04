import type { AgentDecision, MarketRisk } from "./types.js";

export interface DecisionPolicy {
  minConfidence?: number;
  maxNotionalUsd?: number;
  maxAbsoluteHourlyFunding?: number;
}

export function decideFromMarketRisk(
  risk: MarketRisk,
  policy: DecisionPolicy = {},
): AgentDecision {
  const minConfidence = policy.minConfidence ?? 0.72;
  const maxNotionalUsd = policy.maxNotionalUsd ?? 25;
  const events = risk.news.items ?? [];
  const weighted = events.map((event) => {
    const sentiment = typeof event.sentiment === "number" ? clamp(event.sentiment / 10, -1, 1) : directionScore(event.direction);
    const confidence = typeof event.confidence === "number" ? event.confidence : 0;
    return sentiment * confidence;
  });
  const newsScore = weighted.length ? weighted.reduce((sum, value) => sum + value, 0) / weighted.length : 0;
  const confidence = Math.min(1, Math.abs(newsScore));
  const funding = risk.funding?.carry?.funding_rate_per_hour ?? 0;
  const maxFunding = policy.maxAbsoluteHourlyFunding ?? 0.001;
  const rationale = [
    `news_score=${newsScore.toFixed(4)}`,
    `hourly_funding=${funding.toFixed(6)}`,
    `freshness=${JSON.stringify(risk.freshness)}`,
  ];

  if (confidence < minConfidence) {
    return { symbol: risk.symbol, side: "HOLD", confidence, rationale: [...rationale, "below confidence threshold"], maxNotionalUsd };
  }
  if (Math.abs(funding) > maxFunding) {
    return { symbol: risk.symbol, side: "HOLD", confidence, rationale: [...rationale, "funding guardrail triggered"], maxNotionalUsd };
  }
  return {
    symbol: risk.symbol,
    side: newsScore > 0 ? "BUY" : "SELL",
    confidence,
    rationale,
    maxNotionalUsd,
  };
}

function directionScore(direction: unknown): number {
  if (direction === "bullish" || direction === "up") return 1;
  if (direction === "bearish" || direction === "down") return -1;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
