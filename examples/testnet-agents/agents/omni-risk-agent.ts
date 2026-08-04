import { decideFromMarketRisk, type MarketRisk, type X402Symbol } from "@omni-terminal/sdk";
import { readTestnetExecutionConfig } from "../src/config.js";
import { HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";
import { loadOmniMarketRisk } from "../src/omni-research.js";

const demo = process.argv.slice(2).includes("--demo");
if (demo && process.env.RUN_TESTNET_ORDERS === "true") {
  throw new Error("--demo refuses RUN_TESTNET_ORDERS=true; remove the live testnet-order gate");
}
const config = readTestnetExecutionConfig();
if (!["BTC", "ETH", "SOL", "HYPE"].includes(config.symbol)) {
  throw new RangeError("The Omni market-risk product supports BTC, ETH, SOL, or HYPE");
}
const risk = demo
  ? ({
      symbol: config.symbol,
      freshness: { mode: "deterministic-demo-fixture" },
      funding: { carry: { funding_rate_per_hour: 0.0001 } },
      news: { items: [{ confidence: 0.95, direction: "bullish", sentiment: 8 }] },
    } as unknown as MarketRisk)
  : await loadOmniMarketRisk(config.symbol as X402Symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd: config.maxNotionalUsd });
const testnet = new HyperliquidTestnetExecutor();
console.log(JSON.stringify({
  research: demo ? "demo-fixture" : "paid-omni",
  result: await testnet.run(decision, config),
}, null, 2));
