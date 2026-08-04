export type AgentSide = "BUY" | "SELL" | "HOLD";

export interface CandleInput {
  c: string;
}

export interface AgentIntent {
  confidence: number;
  maxNotionalUsd: number;
  rationale: string[];
  side: AgentSide;
  symbol: string;
}

export function momentumIntent(
  symbol: string,
  candles: readonly CandleInput[],
  maxNotionalUsd: number,
  threshold = 0.002,
): AgentIntent {
  const closes = validatedCloses(candles, 4);
  const start = closes[0]!;
  const end = closes.at(-1)!;
  const change = (end - start) / start;
  const confidence = Math.min(1, Math.abs(change) / 0.01);
  const side: AgentSide = Math.abs(change) < threshold ? "HOLD" : change > 0 ? "BUY" : "SELL";
  return {
    confidence,
    maxNotionalUsd,
    rationale: [`lookback_return=${change.toFixed(6)}`, `threshold=${threshold.toFixed(6)}`],
    side,
    symbol,
  };
}

export function meanReversionIntent(
  symbol: string,
  candles: readonly CandleInput[],
  maxNotionalUsd: number,
  threshold = 0.003,
): AgentIntent {
  const closes = validatedCloses(candles, 6);
  const latest = closes.at(-1)!;
  const history = closes.slice(0, -1);
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;
  const deviation = (latest - average) / average;
  const confidence = Math.min(1, Math.abs(deviation) / 0.015);
  const side: AgentSide = Math.abs(deviation) < threshold ? "HOLD" : deviation > 0 ? "SELL" : "BUY";
  return {
    confidence,
    maxNotionalUsd,
    rationale: [`mean_deviation=${deviation.toFixed(6)}`, `threshold=${threshold.toFixed(6)}`],
    side,
    symbol,
  };
}

function validatedCloses(candles: readonly CandleInput[], minimum: number): number[] {
  if (candles.length < minimum) throw new RangeError(`at least ${minimum} candles are required`);
  return candles.map((candle, index) => {
    const close = Number(candle.c);
    if (!Number.isFinite(close) || close <= 0) throw new TypeError(`candles[${index}].c must be a positive number`);
    return close;
  });
}
