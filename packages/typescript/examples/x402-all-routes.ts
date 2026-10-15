import { x402Client } from "@x402/core/client";
import { createEvmPaymentClient, OmniX402Client } from "@omni-terminal/sdk";
import { open } from "node:fs/promises";

const freeOnly = process.argv.slice(2).includes("--free-only");
const runPaidExamples = !freeOnly && process.env.RUN_PAID_EXAMPLES === "true";
const privateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
const totalTestUsdc = "0.182";
const bucketPrice = Number(process.env.X402_BUCKET_PRICE);
const runStatePath = process.env.X402_RUN_STATE;

if (runPaidExamples && (!privateKey || !runStatePath || process.env.X402_CONFIRM_TESTNET_BUDGET !== totalTestUsdc || !Number.isFinite(bucketPrice) || bucketPrice <= 0 || bucketPrice > 1_000_000_000)) {
  throw new Error("No purchase made. Paid mode requires EVM_PRIVATE_KEY, a new X402_RUN_STATE path, X402_CONFIRM_TESTNET_BUDGET=0.182 and a current published X402_BUCKET_PRICE. This example is Base Sepolia only.");
}

const client = new OmniX402Client({
  baseUrl: process.env.OMNI_APP_URL,
  paymentClient: runPaidExamples ? createEvmPaymentClient(privateKey!, {
    allowedNetworks: ["eip155:84532"], maxPaymentUsd: 0.100,
    maxTotalPaymentUsd: Number(totalTestUsdc), maxPaymentAuthorizations: 13,
  }) : new x402Client(),
});

console.log("news health", await client.newsHealth());
console.log("trader profile health", await client.traderProfileHealth());
if (!runPaidExamples) {
  console.log("No paid call made. The opt-in plan covers 13 HTTP products, at most 0.182 test USDC total on Base Sepolia. Free-only mode overrides funded environment settings.");
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
  ["market snapshot", () => client.marketSnapshot("BTC", { interval: "1h", limit: 120 })],
  ["entity resolution", () => client.resolveSymbols(["bitcoin", "BTC-PERP"])],
  ["market carry", () => client.marketCarry("BTC")],
  ["pre-market roundup", () => client.premarketRoundup(1)],
  ["liquidation levels PNG", () => client.liquidationLevelsScreenshot("BTC", { interval: "1d", scope: "aggregate" })],
  ["liquidation bucket PNG", () => client.liquidationBucketScreenshot("BTC", { price: bucketPrice, side: "all", scope: "aggregate" })],
  ["trader profile PNG", () => client.traderProfileScreenshot(address, { range: "30d" })],
] as const;

// A failure stops this process. Never rerun the matrix blindly: reconcile settled
// receipts and any uncertain authorization before preparing a new approved run.
const journal = await open(runStatePath!, "wx", 0o600);
try {
  for (const [name, call] of calls) {
    await journal.write(JSON.stringify({ product: name, phase: "authorization_may_start", network: "eip155:84532" }) + "\n");
    await journal.sync();
    const result = await call();
    const evidence = { product: name, phase: "seller_receipt_returned", transaction: result.payment?.transaction,
      ...( "bytes" in result.data ? { byteLength: result.data.byteLength } : { schema: result.data.schema }) };
    await journal.write(JSON.stringify(evidence) + "\n");
    await journal.sync();
    console.log(evidence);
  }
} finally { await journal.close(); }
