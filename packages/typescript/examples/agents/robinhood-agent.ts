import { RobinhoodCryptoClient } from "@omni-terminal/sdk/brokers";
import { decideFromMarketRisk } from "@omni-terminal/sdk";
import { readBrokerAgentConfig } from "./config.js";
import { assertDemoIsDryRun, createDemoRobinhoodClient, isDemoRun } from "./demo.js";
import { loadMarketRisk } from "./research.js";

const demo = isDemoRun();
if (demo && process.env.LIVE_TRADING === "true") {
  throw new Error("--demo refuses LIVE_TRADING=true; remove the live gate before running a demo");
}
const config = readBrokerAgentConfig("robinhood");
assertDemoIsDryRun(demo, config.liveTrading);
if (!demo) {
  for (const name of ["EVM_PRIVATE_KEY", "ROBINHOOD_API_KEY", "ROBINHOOD_PRIVATE_KEY", "ROBINHOOD_ACCOUNT_NUMBER"] as const) {
    if (!process.env[name]) {
      throw new Error(`${name} is required; run npm run example:robinhood:demo for the no-spend demo`);
    }
  }
}

const robinhood = demo
  ? createDemoRobinhoodClient(config.maxNotionalUsd)
  : new RobinhoodCryptoClient({
      apiKey: process.env.ROBINHOOD_API_KEY!,
      privateKey: process.env.ROBINHOOD_PRIVATE_KEY!,
      accountNumber: process.env.ROBINHOOD_ACCOUNT_NUMBER!,
      liveTrading: config.liveTrading,
      maxOrderNotionalUsd: config.maxNotionalUsd,
    });

const { data: risk, payment, transport } = await loadMarketRisk(config.symbol, { demo });
const decision = decideFromMarketRisk(risk, { maxNotionalUsd: config.maxNotionalUsd });
console.log({ mode: demo ? "demo" : "configured", transport, payment, decision });

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
