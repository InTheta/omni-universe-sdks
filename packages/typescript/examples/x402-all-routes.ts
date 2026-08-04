import { createEvmPaymentClient, OmniX402Client } from "@omni-terminal/sdk";

if (!process.env.EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY is required for x402 payments");

const client = new OmniX402Client({
  baseUrl: process.env.OMNI_APP_URL,
  paymentClient: createEvmPaymentClient(process.env.EVM_PRIVATE_KEY as `0x${string}`, {
    maxPaymentUsd: Number(process.env.X402_MAX_PAYMENT_USD ?? "0.01"),
  }),
});

console.log("news health", await client.newsHealth());
console.log("trader profile health", await client.traderProfileHealth());

if (process.env.RUN_PAID_EXAMPLES !== "true") {
  console.log("Set RUN_PAID_EXAMPLES=true to purchase each route once. No paid call was made.");
  process.exit(0);
}

const address = process.env.HL_ADDRESS ?? "0x0ddf9bae2af4b874b96d287a5ad42eb47138a902";
const calls = [
  ["symbol news", () => client.symbolNews("BTC", { limit: 3, event_window_minutes: 60 })],
  ["market news", () => client.marketNews("equities", { limit: 3 })],
  ["trader profile", () => client.traderProfile(address, { range: "30d", view: "summary" })],
  ["liquidation map", () => client.liquidationMap("BTC", { scope: "current", view: "summary" })],
  ["trader leaderboard", () => client.traderLeaderboard("BTC", { rank: "risk", limit: 5 })],
  ["market risk", () => client.marketRisk("BTC", { scope: "current", limit: 5 })],
  ["market snapshot", () => client.marketSnapshot("BTC", { interval: "1h", limit: 20 })],
  ["entity resolution", () => client.resolveSymbols(["bitcoin", "BTC-PERP"])],
  ["market carry", () => client.marketCarry("BTC")],
] as const;

for (const [name, call] of calls) {
  const result = await call();
  console.log(name, JSON.stringify(result, null, 2));
}
