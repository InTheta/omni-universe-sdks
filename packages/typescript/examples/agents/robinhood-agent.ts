import { RobinhoodCryptoClient } from "@omni-terminal/sdk/brokers";
import { decideFromMarketRisk } from "@omni-terminal/sdk";
import { readBrokerAgentConfig } from "./config.js";
import { loadMarketRisk } from "./research.js";

const config = readBrokerAgentConfig("robinhood");
for (const name of ["EVM_PRIVATE_KEY", "ROBINHOOD_API_KEY", "ROBINHOOD_PRIVATE_KEY", "ROBINHOOD_ACCOUNT_NUMBER"] as const) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const robinhood = new RobinhoodCryptoClient({
  apiKey: process.env.ROBINHOOD_API_KEY!,
  privateKey: process.env.ROBINHOOD_PRIVATE_KEY!,
  accountNumber: process.env.ROBINHOOD_ACCOUNT_NUMBER!,
  liveTrading: config.liveTrading,
  maxOrderNotionalUsd: config.maxNotionalUsd,
});

const { data: risk, payment, transport } = await loadMarketRisk(config.symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd: config.maxNotionalUsd });
console.log({ transport, payment, decision });

if (decision.side === "HOLD") {
  console.log("No order: policy returned HOLD.");
} else {
  const result = await robinhood.submitMarketOrder(
    `${config.symbol}-USD`,
    decision.side.toLowerCase() as "buy" | "sell",
    decision.maxNotionalUsd,
  );
  console.log(result);
}
