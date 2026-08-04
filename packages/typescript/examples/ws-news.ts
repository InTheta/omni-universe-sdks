import { OmniClient, OmniWebSocketClient } from "@omni-terminal/sdk";

const demo = process.argv.slice(2).includes("--demo");

if (demo) {
  console.log({
    mode: "demo",
    event: {
      data: { direction: "bullish", headline: "Deterministic demo event — not live Omni data", symbol: "BTC" },
      receivedAt: 0,
    },
  });
} else {
  if (!process.env.OMNI_API_KEY) {
    throw new Error("OMNI_API_KEY is required; run npm run example:news-ws:demo for the offline demo");
  }

  const rest = new OmniClient({
    baseUrl: process.env.OMNI_API_URL,
    apiKey: process.env.OMNI_API_KEY,
  });
  const ws = new OmniWebSocketClient({ baseUrl: process.env.OMNI_WS_URL ?? "wss://api.omniterminal.app" });
  const ticket = await rest.createNewsWebSocketTicket();
  let seen = 0;

  for await (const event of ws.news(ticket)) {
    console.log(event);
    if (++seen === 5) break;
  }
}
