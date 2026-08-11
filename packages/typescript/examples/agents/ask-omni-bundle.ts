import { wrapFetchWithPayment } from "@x402/fetch";
import {
  createAskOmniBundlePlan,
  createEvmPaymentClient,
  OmniMcpClient,
  OmniX402Client,
  type AskOmniBundleTier,
  type X402Symbol,
} from "@omni-terminal/sdk";

const args = new Set(process.argv.slice(2));
const demo = args.has("--demo");
const paid = !demo && process.env.RUN_PAID_ASK_OMNI_BUNDLE === "yes";
const symbol = (process.env.OMNI_SYMBOL ?? "BTC").toUpperCase() as X402Symbol;
const tier = (process.env.OMNI_ASK_OMNI_TIER ?? "deep") as AskOmniBundleTier;
const mention = process.env.OMNI_MARKET_MENTION?.trim() || undefined;
const plan = createAskOmniBundlePlan({ symbol, tier, mention });

console.log("plan", JSON.stringify(plan, null, 2));

if (!paid) {
  console.log(JSON.stringify({
    schema: "ask_omni_bundle.v1",
    mode: "demo",
    paid: false,
    plan: plan.schema,
    evidence: {
      published_roundup: "demo_premarket_roundup.v1",
      moving_events: "demo_news_pulse.v1",
      market_risk: "demo_market_risk_snapshot.v1",
      optional_completed: tier === "brief" ? [] : ["market_carry", "market_snapshot", "liquidation_map"],
    },
    synthesis: {
      instruction: "Compare the published thesis with live catalysts and mark-anchored risk. State agreements, contradictions, freshness, and missing optional evidence.",
      execution: "No order was previewed or placed.",
    },
  }, null, 2));
  console.log("No payment was made. Set RUN_PAID_ASK_OMNI_BUNDLE=yes and a dedicated EVM_PRIVATE_KEY to run live.");
  process.exit(0);
}
const privateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) throw new Error("EVM_PRIVATE_KEY is required for a paid bundle");
const budgetUsd = Number(process.env.X402_BUNDLE_MAX_USD ?? "0.030");
if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 0.05) {
  throw new RangeError("X402_BUNDLE_MAX_USD must be greater than zero and at most 0.05");
}
if (plan.maxCostAtomic > Math.floor(budgetUsd * 1_000_000)) {
  throw new Error(`Bundle costs at most ${plan.estimatedCostUsdc} USDC, above X402_BUNDLE_MAX_USD=${budgetUsd}`);
}
const network = process.env.OMNI_X402_NETWORK === "eip155:8453" ? "eip155:8453" : "eip155:84532";
const baseUrl = (process.env.OMNI_APP_URL ?? "https://omniterminal.app").replace(/\/$/, "");
const paymentClient = createEvmPaymentClient(privateKey, {
  maxPaymentUsd: 0.01,
  allowedNetworks: [network],
});
const http = new OmniX402Client({ baseUrl, paymentClient });
const mcp = await new OmniMcpClient({
  url: process.env.OMNI_MCP_URL ?? `${baseUrl}/api/x402/mcp`,
  privateKey,
  maxPaymentUsd: 0.01,
  approvePayment: () => true,
}).connect();

try {
  const resolution = mention ? await mcp.resolveEntitiesData([mention]) : null;
  const [roundup, events, risk] = await Promise.all([
    mcp.premarketRoundupData(1),
    mcp.marketMovingEventsData({ symbol, market: "crypto", limit: 5, event_window_minutes: 60 }),
    mcp.marketRiskData({ symbol, scope: "current", event_window_minutes: 60, limit: 5 }),
  ]);
  const deep = tier === "brief" ? null : await Promise.all([
    mcp.marketCarryData(symbol),
    http.marketSnapshot(symbol, { interval: "1h", limit: 120, scope: "aggregate", include_liquidations: true }),
    http.liquidationMap(symbol, { scope: "current", view: "clusters", order: "nearest", limit: 20, side: "all" }),
  ]);
  let visual: { contentType: string; bytes: number; paymentResponse: boolean } | null = null;
  if (tier === "visual") {
    const paidFetch = wrapFetchWithPayment(globalThis.fetch, paymentClient);
    const response = await paidFetch(
      `${baseUrl}/api/x402/v1/screenshots/liquidation-levels/${symbol}?interval=1d&scope=aggregate&layout=standard`,
    );
    if (!response.ok) throw new Error(`Visual route returned HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.headers.get("content-type") !== "image/png" || bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      throw new Error("Visual route did not return a valid PNG");
    }
    visual = {
      contentType: "image/png",
      bytes: bytes.length,
      paymentResponse: response.headers.has("payment-response"),
    };
  }
  console.log(JSON.stringify({
    schema: "ask_omni_bundle.v1",
    mode: "live",
    paid: true,
    network,
    symbol,
    tier,
    evidence: {
      resolution: resolution?.data ?? null,
      published_roundup: roundup.data,
      moving_events: events.data,
      market_risk: risk.data,
      market_carry: deep?.[0].data ?? null,
      market_snapshot: deep?.[1].data ?? null,
      liquidation_map: deep?.[2].data ?? null,
      liquidation_visual: visual,
    },
    settlements: {
      resolution: resolution?.payment ?? null,
      published_roundup: roundup.payment,
      moving_events: events.payment,
      market_risk: risk.payment,
      market_carry: deep?.[0].payment ?? null,
      market_snapshot: deep?.[1].payment ?? null,
      liquidation_map: deep?.[2].payment ?? null,
      liquidation_visual: visual?.paymentResponse ?? null,
    },
    synthesis: {
      instruction: "Compare the published morning thesis with live catalysts, carry, price structure, and every mark-anchored liquidation level. Cite canonical URLs, state freshness and contradictions, then return a separate broker handoff proposal.",
      execution: "Research only. A broker must independently preview and approve any order.",
    },
  }, null, 2));
} finally {
  await mcp.close();
}
