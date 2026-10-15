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
  for (const [name, value] of Object.entries({ minConfidence, maxNotionalUsd, maxAbsoluteHourlyFunding: policy.maxAbsoluteHourlyFunding ?? 0.001 })) {
    if (!Number.isFinite(value) || value < 0 || (name === "minConfidence" && value > 1)) throw new RangeError(`Invalid decision policy: ${name}`);
  }
  const hold = (reason: string): AgentDecision => ({ symbol: risk.symbol, side: "HOLD", confidence: 0, rationale: [reason], maxNotionalUsd });
  // Retrieved prose is untrusted evidence. Only bounded numeric fields influence this assessment;
  // this function never authorizes account access, signing or execution.
  for (const [name, freshness] of Object.entries({ market: risk.freshness, news: risk.news?.freshness, liquidations: risk.liquidations?.freshness, funding: risk.funding?.freshness })) {
    if (!freshness || freshness.status !== "fresh") return hold(`${name} data is not fresh`);
    const age = freshness.age_seconds;
    const maximum = freshness.max_age_seconds;
    if (typeof age === "number" && (!Number.isFinite(age) || age < 0 || typeof maximum !== "number" || !Number.isFinite(maximum) || age > maximum)) return hold(`${name} freshness age is invalid or expired`);
  }
  const fundingValue = risk.funding?.carry?.funding_rate_per_hour;
  if (typeof fundingValue !== "number" || !Number.isFinite(fundingValue)) return hold("funding is unavailable");
  const events = risk.news.items ?? [];
  if (events.some((event) => typeof event.confidence !== "number" || !Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1 || (typeof event.sentiment === "number" && !Number.isFinite(event.sentiment)))) return hold("invalid news evidence");
  const weighted = events.map((event) => {
    const sentiment = typeof event.sentiment === "number" ? clamp(event.sentiment / 10, -1, 1) : directionScore(event.direction);
    const confidence = typeof event.confidence === "number" ? event.confidence : 0;
    return sentiment * confidence;
  });
  const newsScore = weighted.length ? weighted.reduce((sum, value) => sum + value, 0) / weighted.length : 0;
  const confidence = Math.min(1, Math.abs(newsScore));
  const funding = fundingValue;
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
