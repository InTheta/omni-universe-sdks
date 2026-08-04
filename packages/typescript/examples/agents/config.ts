import type { X402Symbol } from "@omni-terminal/sdk";

export const HARD_MAX_AGENT_ORDER_NOTIONAL_USD = 100;

export type BrokerAgentName = "coinbase" | "robinhood";

export interface BrokerAgentConfig {
  liveTrading: boolean;
  maxNotionalUsd: number;
  symbol: X402Symbol;
}

const confirmations: Record<BrokerAgentName, string> = {
  coinbase: "COINBASE_LIVE_ORDER",
  robinhood: "ROBINHOOD_LIVE_ORDER",
};

export function readBrokerAgentConfig(
  broker: BrokerAgentName,
  env: NodeJS.ProcessEnv = process.env,
): BrokerAgentConfig {
  const symbol = (env.TRADING_SYMBOL ?? "BTC").trim().toUpperCase();
  if (!(["BTC", "ETH", "SOL", "HYPE"] as string[]).includes(symbol)) {
    throw new RangeError("TRADING_SYMBOL must be BTC, ETH, SOL, or HYPE");
  }

  const maxNotionalUsd = Number(env.MAX_ORDER_NOTIONAL_USD ?? "25");
  if (
    !Number.isFinite(maxNotionalUsd)
    || maxNotionalUsd <= 0
    || maxNotionalUsd > HARD_MAX_AGENT_ORDER_NOTIONAL_USD
  ) {
    throw new RangeError(
      `MAX_ORDER_NOTIONAL_USD must be greater than zero and at most ${HARD_MAX_AGENT_ORDER_NOTIONAL_USD}`,
    );
  }

  if (env.LIVE_TRADING && env.LIVE_TRADING !== "true" && env.LIVE_TRADING !== "false") {
    throw new Error("LIVE_TRADING must be exactly true or false");
  }
  const liveTrading = env.LIVE_TRADING === "true";
  if (liveTrading && env.CONFIRM_LIVE_ORDER !== confirmations[broker]) {
    throw new Error(`CONFIRM_LIVE_ORDER must equal ${confirmations[broker]} when LIVE_TRADING=true`);
  }

  return { liveTrading, maxNotionalUsd, symbol: symbol as X402Symbol };
}
