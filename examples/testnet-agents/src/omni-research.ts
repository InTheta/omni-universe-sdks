import {
  createEvmPaymentClient,
  OmniMcpClient,
  OmniX402Client,
  type MarketRisk,
  type X402Symbol,
} from "@omni-terminal/sdk";

const HARD_MAX_RESEARCH_PAYMENT_USD = 0.01;

export async function loadOmniMarketRisk(
  symbol: X402Symbol,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MarketRisk> {
  if (env.RUN_PAID_RESEARCH !== "true") {
    throw new Error("RUN_PAID_RESEARCH=true is required before purchasing Omni research");
  }
  const privateKey = env.EVM_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new TypeError("EVM_PRIVATE_KEY must be a separately funded 32-byte buyer-wallet key");
  }
  const maxPaymentUsd = Number(env.X402_MAX_PAYMENT_USD || "0.01");
  if (!Number.isFinite(maxPaymentUsd) || maxPaymentUsd <= 0 || maxPaymentUsd > HARD_MAX_RESEARCH_PAYMENT_USD) {
    throw new RangeError(`X402_MAX_PAYMENT_USD must be greater than zero and at most ${HARD_MAX_RESEARCH_PAYMENT_USD}`);
  }

  const transport = env.OMNI_RESEARCH_TRANSPORT || "x402";
  if (transport === "x402") {
    const client = new OmniX402Client({
      baseUrl: env.OMNI_APP_URL,
      paymentClient: createEvmPaymentClient(privateKey as `0x${string}`, { maxPaymentUsd }),
    });
    return (await client.marketRisk(symbol, { scope: "current", limit: 5 })).data;
  }
  if (transport === "mcp") {
    const client = await new OmniMcpClient({
      url: env.OMNI_MCP_URL,
      privateKey: privateKey as `0x${string}`,
      maxPaymentUsd,
      approvePayment: () => true,
    }).connect();
    try {
      return (await client.marketRiskData({ symbol, scope: "current", limit: 5 })).data;
    } finally {
      await client.close();
    }
  }
  throw new RangeError("OMNI_RESEARCH_TRANSPORT must be x402 or mcp");
}
