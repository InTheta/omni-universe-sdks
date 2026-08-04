import { readTestnetExecutionConfig } from "../src/config.js";
import { HyperliquidTestnetExecutor } from "../src/hyperliquid-testnet.js";
import { meanReversionIntent } from "../src/strategies.js";

const config = readTestnetExecutionConfig();
const testnet = new HyperliquidTestnetExecutor();
const candles = await testnet.candles(config.symbol, "5m", 12 * 60 * 60 * 1_000);
const intent = meanReversionIntent(config.symbol, candles.slice(-12), config.maxNotionalUsd);
console.log(JSON.stringify(await testnet.run(intent, config), null, 2));
