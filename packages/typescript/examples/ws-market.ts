import { HyperliquidWebSocketClient } from "@omni-terminal/sdk";

const client = new HyperliquidWebSocketClient({ baseUrl: process.env.HYPERLIQUID_WS_URL });
let seen = 0;

for await (const event of client.trades("BTC")) {
  console.log(event);
  if (++seen === 5) break;
}
