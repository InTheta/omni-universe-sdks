import { decideFromMarketRisk, type X402Symbol } from "@omni-terminal/sdk";
import { readTestnetExecutionConfig } from "../src/config.js";
import { HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";
import { loadOmniMarketRisk } from "../src/omni-research.js";

const config = readTestnetExecutionConfig();
if (!["BTC", "ETH", "SOL", "HYPE"].includes(config.symbol)) {
  throw new RangeError("The Omni market-risk product supports BTC, ETH, SOL, or HYPE");
}
const risk = await loadOmniMarketRisk(config.symbol as X402Symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd: config.maxNotionalUsd });
const testnet = new HyperliquidTestnetExecutor();
console.log(JSON.stringify(await testnet.run(decision, config), null, 2));
