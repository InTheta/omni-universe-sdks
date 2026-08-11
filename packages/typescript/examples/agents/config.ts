import type { X402Symbol } from "@omni-terminal/sdk";

export const HARD_MAX_AGENT_ORDER_NOTIONAL_USD = 100;
export const HARD_MAX_AGENT_RESEARCH_PAYMENT_USD = 0.01;
export const DUAL_TRANSPORT_RESEARCH_BUDGET_USD = 0.013;

export type BrokerAgentName = "coinbase" | "robinhood";

export interface BrokerAgentConfig {
  liveTrading: boolean;
  maxNotionalUsd: number;
  symbol: X402Symbol;
}

export interface AgentResearchConfig {
  maxPaymentUsd: number;
  maxSessionPaymentUsd: number;
  privateKey: `0x${string}`;
  transport: "both" | "mcp" | "x402";
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

export function readAgentResearchConfig(env: NodeJS.ProcessEnv = process.env): AgentResearchConfig {
  if (env.RUN_PAID_RESEARCH !== "true") {
    throw new Error("RUN_PAID_RESEARCH=true is required before purchasing Omni agent research");
  }
  const privateKey = env.EVM_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new TypeError("EVM_PRIVATE_KEY must be a separately funded 32-byte buyer-wallet key");
  }
  const maxPaymentUsd = Number(env.X402_MAX_PAYMENT_USD ?? "0.01");
  if (
    !Number.isFinite(maxPaymentUsd)
    || maxPaymentUsd <= 0
    || maxPaymentUsd > HARD_MAX_AGENT_RESEARCH_PAYMENT_USD
  ) {
    throw new RangeError(
      `X402_MAX_PAYMENT_USD must be greater than zero and at most ${HARD_MAX_AGENT_RESEARCH_PAYMENT_USD}`,
    );
  }
  const transport = env.OMNI_RESEARCH_TRANSPORT ?? "x402";
  if (transport !== "x402" && transport !== "mcp" && transport !== "both") {
    throw new Error("OMNI_RESEARCH_TRANSPORT must be x402, mcp, or both");
  }
  const maxSessionPaymentUsd = Number(
    env.X402_MAX_RESEARCH_SESSION_USD
      ?? (transport === "both" ? String(DUAL_TRANSPORT_RESEARCH_BUDGET_USD) : String(maxPaymentUsd)),
  );
  if (!Number.isFinite(maxSessionPaymentUsd) || maxSessionPaymentUsd <= 0) {
    throw new RangeError("X402_MAX_RESEARCH_SESSION_USD must be greater than zero");
  }
  if (transport === "both" && maxSessionPaymentUsd !== DUAL_TRANSPORT_RESEARCH_BUDGET_USD) {
    throw new RangeError(
      `OMNI_RESEARCH_TRANSPORT=both requires X402_MAX_RESEARCH_SESSION_USD=${DUAL_TRANSPORT_RESEARCH_BUDGET_USD}`,
    );
  }
  return {
    maxPaymentUsd,
    maxSessionPaymentUsd,
    privateKey: privateKey as `0x${string}`,
    transport,
  };
}
