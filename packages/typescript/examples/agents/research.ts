import {
  createEvmPaymentClient,
  OmniMcpClient,
  OmniX402Client,
  type MarketRisk,
  type X402Symbol,
} from "@omni-terminal/sdk";
import { readAgentResearchConfig } from "./config.js";
import { demoMarketRisk } from "./demo.js";

export async function loadMarketRisk(symbol: X402Symbol, options: { demo?: boolean } = {}): Promise<{
  data: MarketRisk;
  payment: unknown;
  transport: "demo-fixture" | "x402-rest" | "x402-mcp";
}> {
  if (options.demo) {
    return { data: demoMarketRisk(symbol), payment: null, transport: "demo-fixture" };
  }
  const config = readAgentResearchConfig();

  if (config.transport === "mcp") {
    const mcp = await new OmniMcpClient({
      url: process.env.OMNI_MCP_URL,
      privateKey: config.privateKey,
      maxPaymentUsd: config.maxPaymentUsd,
      approvePayment: () => true,
    }).connect();
    try {
      const result = await mcp.marketRiskData({ symbol, scope: "current", limit: 5 });
      return { data: result.data, payment: result.payment, transport: "x402-mcp" };
    } finally {
      await mcp.close();
    }
  }

  const client = new OmniX402Client({
    baseUrl: process.env.OMNI_APP_URL,
    paymentClient: createEvmPaymentClient(config.privateKey, { maxPaymentUsd: config.maxPaymentUsd }),
  });
  const result = await client.marketRisk(symbol, { scope: "current", limit: 5 });
  return { data: result.data, payment: result.payment, transport: "x402-rest" };
}
