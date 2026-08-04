import { generateKeyPairSync } from "node:crypto";
import type { MarketRisk, X402Symbol } from "@omni-terminal/sdk";
import { CoinbaseAdvancedTradeClient, RobinhoodCryptoClient } from "@omni-terminal/sdk/brokers";

const DEMO_ROBINHOOD_SEED = "xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=";

export function isDemoRun(argv: readonly string[] = process.argv.slice(2)): boolean {
  return argv.includes("--demo");
}

export function assertDemoIsDryRun(demo: boolean, liveTrading: boolean): void {
  if (demo && liveTrading) {
    throw new Error("--demo refuses LIVE_TRADING=true; remove the live gate before running a demo");
  }
}

export function demoMarketRisk(symbol: X402Symbol): MarketRisk {
  return {
    symbol,
    freshness: { mode: "deterministic-demo-fixture" },
    funding: { carry: { funding_rate_per_hour: 0.0001 } },
    news: {
      items: [{
        confidence: 0.95,
        direction: "bullish",
        headline: "Deterministic demo event — not live market data",
        sentiment: 8,
      }],
    },
  } as unknown as MarketRisk;
}

export function createDemoCoinbaseClient(maxOrderNotionalUsd: number): CoinbaseAdvancedTradeClient {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return new CoinbaseAdvancedTradeClient({
    apiKey: "organizations/demo/apiKeys/demo",
    apiSecret: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    liveTrading: false,
    maxOrderNotionalUsd,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path !== "/api/v3/brokerage/orders/preview" || init?.method !== "POST") {
        throw new Error(`Coinbase demo blocked unexpected request: ${init?.method} ${path}`);
      }
      return Response.json({ errs: [], preview_id: "demo-preview" });
    },
  });
}

export function createDemoRobinhoodClient(maxOrderNotionalUsd: number): RobinhoodCryptoClient {
  return new RobinhoodCryptoClient({
    accountNumber: "demo-account",
    apiKey: "demo-api-key",
    privateKey: DEMO_ROBINHOOD_SEED,
    liveTrading: false,
    maxOrderNotionalUsd,
    fetch: async () => {
      throw new Error("Robinhood demo must remain a zero-network local order plan");
    },
  });
}
