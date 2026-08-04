import { OmniClient, OmniWebSocketClient } from "@omni-terminal/sdk";

if (!process.env.OMNI_API_KEY) throw new Error("OMNI_API_KEY is required");

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
