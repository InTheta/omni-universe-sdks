import { CoinbaseAdvancedTradeClient } from "@omni-terminal/sdk/brokers";
import { decideFromMarketRisk } from "@omni-terminal/sdk";
import { loadMarketRisk } from "./research.js";

for (const name of ["EVM_PRIVATE_KEY", "COINBASE_API_KEY", "COINBASE_API_SECRET"] as const) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const symbol = (process.env.TRADING_SYMBOL ?? "BTC") as "BTC" | "ETH" | "SOL" | "HYPE";
const maxNotionalUsd = Number(process.env.MAX_ORDER_NOTIONAL_USD ?? "25");
const coinbase = new CoinbaseAdvancedTradeClient({
  apiKey: process.env.COINBASE_API_KEY!,
  apiSecret: process.env.COINBASE_API_SECRET!,
  liveTrading: process.env.LIVE_TRADING === "true",
  maxOrderNotionalUsd: maxNotionalUsd,
});

const { data: risk, payment, transport } = await loadMarketRisk(symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd });
console.log({ transport, payment, decision });

if (decision.side === "HOLD") {
  console.log("No order: policy returned HOLD.");
} else {
  const result = await coinbase.submitMarketOrder(`${symbol}-USD`, decision.side, decision.maxNotionalUsd);
  console.log(result);
}
