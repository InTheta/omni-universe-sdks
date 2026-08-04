import { OmniMcpClient } from "@omni-terminal/sdk";

const freeOnly = process.argv.slice(2).includes("--free-only");
const client = await new OmniMcpClient({
  url: process.env.OMNI_MCP_URL,
  privateKey: freeOnly ? undefined : process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined,
  maxPaymentUsd: Number(process.env.X402_MAX_PAYMENT_USD ?? "0.01"),
  approvePayment: ({ paymentRequired }) => {
    const accepted = paymentRequired?.accepts?.[0];
    console.log("approving", accepted?.amount, accepted?.network);
    return !freeOnly && process.env.RUN_PAID_EXAMPLES === "true";
  },
}).connect();

try {
  console.log("tools", await client.listTools());
  console.log("catalog", (await client.catalogData()).data);

  if (freeOnly || !process.env.EVM_PRIVATE_KEY || process.env.RUN_PAID_EXAMPLES !== "true") {
    console.log(freeOnly
      ? "Free-only mode: paid MCP tools were disabled regardless of environment."
      : "Set EVM_PRIVATE_KEY and RUN_PAID_EXAMPLES=true to purchase the four paid MCP tools.");
    process.exitCode = 0;
  } else {
    console.log("events", await client.marketMovingEventsData({ symbol: "BTC", market: "crypto", limit: 3 }));
    console.log("risk", await client.marketRiskData({ symbol: "BTC", scope: "current", limit: 3 }));
    console.log("resolution", await client.resolveEntitiesData(["bitcoin", "BTC-PERP"]));
    console.log("carry", await client.marketCarryData("BTC"));
  }
} finally {
  await client.close();
}
