import {
  createEvmPaymentClient,
  OmniMcpClient,
  OmniX402Client,
  type MarketRisk,
  type X402Symbol,
} from "@omni-terminal/sdk";

export const HARD_MAX_AGENT_RESEARCH_PAYMENT_USD = 0.01;

export interface AgentResearchConfig {
  maxPaymentUsd: number;
  privateKey: `0x${string}`;
  transport: "mcp" | "x402";
}

export function readAgentResearchConfig(env: NodeJS.ProcessEnv = process.env): AgentResearchConfig {
  if (env.RUN_PAID_RESEARCH !== "true") {
    throw new Error("RUN_PAID_RESEARCH=true is required before purchasing Omni agent research");
  }
  const privateKey = env.EVM_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new TypeError("EVM_PRIVATE_KEY must be a separately funded 32-byte buyer-wallet key");
  }
  const maxPaymentUsd = Number(env.X402_MAX_PAYMENT_USD ?? "0.01");
  if (
    !Number.isFinite(maxPaymentUsd)
    || maxPaymentUsd <= 0
    || maxPaymentUsd > HARD_MAX_AGENT_RESEARCH_PAYMENT_USD
  ) {
    throw new RangeError(
      `X402_MAX_PAYMENT_USD must be greater than zero and at most ${HARD_MAX_AGENT_RESEARCH_PAYMENT_USD}`,
    );
  }
  const transport = env.OMNI_RESEARCH_TRANSPORT ?? "x402";
  if (transport !== "x402" && transport !== "mcp") {
    throw new Error("OMNI_RESEARCH_TRANSPORT must be x402 or mcp");
  }
  return { maxPaymentUsd, privateKey: privateKey as `0x${string}`, transport };
}

export async function loadMarketRisk(symbol: X402Symbol): Promise<{
  data: MarketRisk;
  payment: unknown;
  transport: "x402-rest" | "x402-mcp";
}> {
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
