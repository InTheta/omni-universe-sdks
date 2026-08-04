import { readTestnetExecutionConfig } from "../src/config.js";
import { HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";
import { momentumIntent } from "../src/strategies.js";

const config = readTestnetExecutionConfig();
const testnet = new HyperliquidTestnetExecutor();
const candles = await testnet.candles(config.symbol, "15m");
const intent = momentumIntent(config.symbol, candles.slice(-8), config.maxNotionalUsd);
console.log(JSON.stringify(await testnet.run(intent, config), null, 2));
