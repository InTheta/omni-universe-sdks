import { CoinbaseAdvancedTradeClient } from "@omni-terminal/sdk/brokers";
import { decideFromMarketRisk } from "@omni-terminal/sdk";
import { readBrokerAgentConfig } from "./config.js";
import { loadMarketRisk } from "./research.js";

const config = readBrokerAgentConfig("coinbase");
for (const name of ["EVM_PRIVATE_KEY", "COINBASE_API_KEY", "COINBASE_API_SECRET"] as const) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const coinbase = new CoinbaseAdvancedTradeClient({
  apiKey: process.env.COINBASE_API_KEY!,
  apiSecret: process.env.COINBASE_API_SECRET!,
  liveTrading: config.liveTrading,
  maxOrderNotionalUsd: config.maxNotionalUsd,
});

const { data: risk, payment, transport } = await loadMarketRisk(config.symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd: config.maxNotionalUsd });
console.log({ transport, payment, decision });

if (decision.side === "HOLD") {
  console.log("No order: policy returned HOLD.");
} else {
  const result = await coinbase.submitMarketOrder(
    `${config.symbol}-USD`,
    decision.side,
    decision.maxNotionalUsd,
  );
  console.log(result);
}
