import { open } from "node:fs/promises";
import { OmniMcpClient } from "@omni-terminal/sdk";

const freeOnly = process.argv.slice(2).includes("--free-only");
const runPaid = !freeOnly && process.env.RUN_PAID_EXAMPLES === "true";
const key = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
const statePath = process.env.X402_RUN_STATE;
if (runPaid && (!key || !statePath || process.env.X402_CONFIRM_TESTNET_BUDGET !== "0.124")) {
  throw new Error("No payment made. Paid MCP mode requires EVM_PRIVATE_KEY, a new X402_RUN_STATE path and X402_CONFIRM_TESTNET_BUDGET=0.124. This example is Base Sepolia only.");
}
const client = new OmniMcpClient({
  url: process.env.OMNI_MCP_URL,
  privateKey: runPaid ? key : undefined,
  allowedNetworks: ["eip155:84532"], maxPaymentUsd: 0.100,
  maxTotalPaymentUsd: 0.124, maxPaymentAuthorizations: 5,
  approvePayment: () => runPaid,
});
const journal = runPaid ? await open(statePath!, "wx", 0o600) : undefined;
try {
  await client.connect();
  console.log("tools", await client.listTools());
  console.log("catalog", (await client.catalogData()).data);
  if (!runPaid) {
    console.log("No paid tool called. The opt-in plan covers five tools at most 0.124 test USDC total. Free-only mode overrides funded environment settings.");
  } else {
    const calls = [
      ["events", () => client.marketMovingEventsData({ symbol: "BTC", market: "crypto", limit: 3 })],
      ["risk", () => client.marketRiskData({ symbol: "BTC", scope: "current", limit: 3 })],
      ["resolution", () => client.resolveEntitiesData(["bitcoin", "BTC-PERP"])],
      ["carry", () => client.marketCarryData("BTC")],
      ["premarket", () => client.premarketRoundupData(1)],
    ] as const;
    for (const [product, call] of calls) {
      await journal!.write(JSON.stringify({ product, phase: "authorization_may_start", network: "eip155:84532" }) + "\n");
      await journal!.sync();
      const result = await call();
      const evidence = { product, phase: "seller_receipt_returned", transaction: result.payment?.transaction, schema: result.data.schema };
      await journal!.write(JSON.stringify(evidence) + "\n");
      await journal!.sync();
      console.log(evidence);
    }
  }
} finally {
  try { await client.close(); } finally { await journal?.close(); }
}
