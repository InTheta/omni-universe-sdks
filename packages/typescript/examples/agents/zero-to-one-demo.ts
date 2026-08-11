import { decideFromMarketRisk } from "@omni-terminal/sdk";
import {
  createDemoCoinbaseClient,
  createDemoRobinhoodClient,
  demoMarketRisk,
} from "./demo.js";

const symbol = "BTC" as const;
const maxNotionalUsd = 25;

// Deterministic stand-ins for the two discovery surfaces. Configured runs use the live
// Coinbase Bazaar/Omni challenge and native Omni MCP clients documented in the runbook.
const discovery = {
  coinbaseBazaar: {
    service: "Omni Market Risk Snapshot — BTC",
    resource: "https://omniterminal.app/api/x402/v1/market-risk/BTC?scope=current",
    network: "eip155:8453",
    priceUsdc: 0.010,
    schema: "market_risk_snapshot.v1",
  },
  omniMcp: {
    server: "https://omniterminal.app/api/x402/mcp",
    tool: "get_market_carry",
    priceUsdc: 0.003,
    schema: "hyperliquid_market_carry.v1",
  },
};

const risk = demoMarketRisk(symbol);
const decision = decideFromMarketRisk(risk, { maxNotionalUsd });
if (decision.side === "HOLD") throw new Error("Demo fixture unexpectedly returned HOLD");

const coinbase = createDemoCoinbaseClient(maxNotionalUsd);
const robinhood = createDemoRobinhoodClient(maxNotionalUsd);
const [coinbasePreview, robinhoodPlan] = await Promise.all([
  coinbase.submitMarketOrder(`${symbol}-USD`, decision.side, decision.maxNotionalUsd),
  robinhood.submitMarketOrder(
    `${symbol}-USD`,
    decision.side.toLowerCase() as "buy" | "sell",
    decision.maxNotionalUsd,
  ),
]);

console.log(JSON.stringify({
  ok: true,
  mode: "offline_zero_to_one_demo",
  discovery,
  paymentPlan: {
    calls: 2,
    maximumPerCallUsdc: 0.010,
    maximumSessionUsdc: 0.013,
    paid: false,
  },
  evidence: {
    source: "deterministic_fixture",
    schema: "market_risk_snapshot.v1",
    symbol,
  },
  decision,
  brokers: {
    coinbaseAdvancedTrade: coinbasePreview,
    robinhoodCrypto: robinhoodPlan,
    robinhoodTradingMcp: {
      attempted: false,
      reason: "interactive OAuth and dedicated Agentic-account authorization are operator-owned",
    },
  },
  guardrails: {
    walletRequired: false,
    brokerCredentialsRequired: false,
    liveMarketDataUsed: false,
    paymentCreated: false,
    orderCreated: false,
  },
}, null, 2));
