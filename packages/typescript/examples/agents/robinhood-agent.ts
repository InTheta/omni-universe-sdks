import { RobinhoodCryptoClient } from "@omni-terminal/sdk/brokers";
import { decideFromMarketRisk } from "@omni-terminal/sdk";
import { loadMarketRisk } from "./research.js";

for (const name of ["EVM_PRIVATE_KEY", "ROBINHOOD_API_KEY", "ROBINHOOD_PRIVATE_KEY", "ROBINHOOD_ACCOUNT_NUMBER"] as const) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const symbol = (process.env.TRADING_SYMBOL ?? "BTC") as "BTC" | "ETH" | "SOL" | "HYPE";
const maxNotionalUsd = Number(process.env.MAX_ORDER_NOTIONAL_USD ?? "25");
const robinhood = new RobinhoodCryptoClient({
  apiKey: process.env.ROBINHOOD_API_KEY!,
  privateKey: process.env.ROBINHOOD_PRIVATE_KEY!,
  accountNumber: process.env.ROBINHOOD_ACCOUNT_NUMBER!,
  liveTrading: process.env.LIVE_TRADING === "true",
  maxOrderNotionalUsd: maxNotionalUsd,
});

const { data: risk, payment, transport } = await loadMarketRisk(symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd });
console.log({ transport, payment, decision });

if (decision.side === "HOLD") {
  console.log("No order: policy returned HOLD.");
} else {
  const result = await robinhood.submitMarketOrder(`${symbol}-USD`, decision.side.toLowerCase() as "buy" | "sell", decision.maxNotionalUsd);
  console.log(result);
}
