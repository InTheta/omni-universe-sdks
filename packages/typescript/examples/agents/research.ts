import {
  createEvmPaymentClient,
  OmniMcpClient,
  OmniX402Client,
  type MarketRisk,
  type X402Symbol,
} from "@omni-terminal/sdk";

export async function loadMarketRisk(symbol: X402Symbol): Promise<{
  data: MarketRisk;
  payment: unknown;
  transport: "x402-rest" | "x402-mcp";
}> {
  const privateKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
  const maxPaymentUsd = Number(process.env.X402_MAX_PAYMENT_USD ?? "0.01");
  const transport = process.env.OMNI_RESEARCH_TRANSPORT ?? "x402";

  if (transport === "mcp") {
    const mcp = await new OmniMcpClient({
      url: process.env.OMNI_MCP_URL,
      privateKey,
      maxPaymentUsd,
      approvePayment: () => true,
    }).connect();
    try {
      const result = await mcp.marketRiskData({ symbol, scope: "current", limit: 5 });
      return { data: result.data, payment: result.payment, transport: "x402-mcp" };
    } finally {
      await mcp.close();
    }
  }

  if (transport !== "x402") throw new Error("OMNI_RESEARCH_TRANSPORT must be x402 or mcp");
  const client = new OmniX402Client({
    baseUrl: process.env.OMNI_APP_URL,
    paymentClient: createEvmPaymentClient(privateKey, { maxPaymentUsd }),
  });
  const result = await client.marketRisk(symbol, { scope: "current", limit: 5 });
  return { data: result.data, payment: result.payment, transport: "x402-rest" };
}
