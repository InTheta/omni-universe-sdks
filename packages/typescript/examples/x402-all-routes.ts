import { x402Client } from "@x402/core/client";
import { createEvmPaymentClient, OmniX402Client } from "@omni-terminal/sdk";

const freeOnly = process.argv.slice(2).includes("--free-only");
const runPaidExamples = !freeOnly && process.env.RUN_PAID_EXAMPLES === "true";
const privateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;

if (runPaidExamples && !privateKey) {
  throw new Error("EVM_PRIVATE_KEY is required when RUN_PAID_EXAMPLES=true");
}

const client = new OmniX402Client({
  baseUrl: process.env.OMNI_APP_URL,
  paymentClient: runPaidExamples
    ? createEvmPaymentClient(privateKey!, {
        maxPaymentUsd: Number(process.env.X402_MAX_PAYMENT_USD ?? "0.01"),
      })
    : new x402Client(),
});

console.log("news health", await client.newsHealth());
console.log("trader profile health", await client.traderProfileHealth());

if (!runPaidExamples) {
  console.log(freeOnly
    ? "Free-only mode: paid x402 routes were disabled regardless of environment."
    : "Set RUN_PAID_EXAMPLES=true to purchase each route once. No paid call was made.");
  process.exit(0);
}

const address = process.env.HL_ADDRESS || "0x0ddf9bae2af4b874b96d287a5ad42eb47138a902";
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
  ["pre-market roundup", () => client.premarketRoundup(1)],
  ["dated pre-market roundup", () => client.premarketRoundup({ date: "2026-08-11" })],
] as const;

for (const [name, call] of calls) {
  const result = await call();
  console.log(name, JSON.stringify(result, null, 2));
}
