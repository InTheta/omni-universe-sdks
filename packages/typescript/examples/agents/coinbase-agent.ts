import { CoinbaseAdvancedTradeClient } from "@omni-terminal/sdk/brokers";
import { decideFromMarketRisk } from "@omni-terminal/sdk";
import { readBrokerAgentConfig } from "./config.js";
import { assertDemoIsDryRun, createDemoCoinbaseClient, isDemoRun } from "./demo.js";
import { loadMarketRisk } from "./research.js";

const demo = isDemoRun();
if (demo && process.env.LIVE_TRADING === "true") {
  throw new Error("--demo refuses LIVE_TRADING=true; remove the live gate before running a demo");
}
const config = readBrokerAgentConfig("coinbase");
assertDemoIsDryRun(demo, config.liveTrading);
if (!demo) {
  for (const name of ["EVM_PRIVATE_KEY", "COINBASE_API_KEY", "COINBASE_API_SECRET"] as const) {
    if (!process.env[name]) {
      throw new Error(`${name} is required; run npm run example:coinbase:demo for the no-spend demo`);
    }
  }
}

const coinbase = demo
  ? createDemoCoinbaseClient(config.maxNotionalUsd)
  : new CoinbaseAdvancedTradeClient({
      apiKey: process.env.COINBASE_API_KEY!,
      apiSecret: process.env.COINBASE_API_SECRET!,
      liveTrading: config.liveTrading,
      maxOrderNotionalUsd: config.maxNotionalUsd,
    });

const { data: risk, payment, supportingEvidence, supportingPayment, transport } = await loadMarketRisk(config.symbol, { demo });
const decision = decideFromMarketRisk(risk, { maxNotionalUsd: config.maxNotionalUsd });
console.log({
  mode: demo ? "demo" : "configured",
  transport,
  payments: { primary: payment, supporting: supportingPayment },
  supportingSchema: supportingEvidence?.schema,
  decision,
});

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
