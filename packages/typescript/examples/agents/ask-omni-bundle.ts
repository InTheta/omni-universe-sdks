import { wrapFetchWithPayment } from "@x402/fetch";
import { x402HTTPClient } from "@x402/core/client";
import {
  BundleBudget, createAskOmniBundlePlan, createEvmPaymentClient,
  OmniMcpClient, OmniX402Client,
  validatePaymentSettlement, type AskOmniBundleTier, type X402Symbol,
} from "@omni-terminal/sdk";

const args = new Set(process.argv.slice(2));
const paid = !args.has("--demo") && process.env.RUN_PAID_ASK_OMNI_BUNDLE === "yes";
const symbol = (process.env.OMNI_SYMBOL ?? "BTC").toUpperCase() as X402Symbol;
const tier = (process.env.OMNI_ASK_OMNI_TIER ?? "deep") as AskOmniBundleTier;
const mention = process.env.OMNI_MARKET_MENTION?.trim() || undefined;
const plan = createAskOmniBundlePlan({ symbol, tier, mention });
console.log("plan", JSON.stringify(plan, null, 2));
if (!paid) {
  console.log(JSON.stringify({ schema: "ask_omni_bundle.v1", mode: "demo", paid: false, plan,
    execution: "Plan only. No payment, broker preview, or order was made." }, null, 2));
  console.log("Paid mode requires explicit opt-in and total/per-call preflight before connecting. Defaults remain 0.030 USDC total and 0.010 USDC per call; current bundles exceed both.");
  process.exit(0);
}
const budget = new BundleBudget({
  budgetUsd: Number(process.env.X402_BUNDLE_MAX_USD ?? "0.030"),
  maxPaymentUsd: Number(process.env.X402_MAX_PAYMENT_USD ?? "0.010"),
});
const privateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) throw new Error("EVM_PRIVATE_KEY is required for a paid bundle");
const network = process.env.OMNI_X402_NETWORK === "eip155:8453" ? "eip155:8453" : "eip155:84532";
const baseUrl = (process.env.OMNI_APP_URL ?? "https://omniterminal.app").replace(/\/$/, "");

// Admission happens before adapter execution/connection. Reuse the SAME budget
// instance and operation ID for retries. This CLI is not a durable payment ledger.
const result = await budget.execute("ask-omni-cli", plan, async (step) => {
  const maxPaymentUsd = step.priceAtomic / 1_000_000;
  const paymentClient = createEvmPaymentClient(privateKey, { maxPaymentUsd, allowedNetworks: [network], maxPaymentAuthorizations: 1 });
  const http = new OmniX402Client({ baseUrl, paymentClient });
  const mcp = new OmniMcpClient({
    url: process.env.OMNI_MCP_URL ?? `${baseUrl}/api/x402/mcp`, privateKey,
    maxPaymentUsd, allowedNetworks: [network], maxPaymentAuthorizations: 1, approvePayment: () => true,
  });
  try {
    if (step.transport === "mcp+x402") await mcp.connect();
    const value = await (async (): Promise<unknown> => {
      switch (step.id) {
        case "resolve_entities": {
          const resolved = await mcp.resolveEntitiesData([mention!]);
          const match = resolved.data.results[0];
          if (resolved.data.results.length !== 1 || match?.resolution_status !== "resolved" || !match.product_supported || match.base?.toUpperCase() !== symbol) {
            throw new Error("Market mention did not resolve unambiguously to the selected supported symbol");
          }
          return resolved;
        }
        case "published_roundup": return mcp.premarketRoundupData(1);
        case "moving_events": return mcp.marketMovingEventsData({ symbol, market: "crypto", limit: 5, event_window_minutes: 60 });
        case "market_risk": return mcp.marketRiskData({ symbol, scope: "current", event_window_minutes: 60, limit: 5 });
        case "market_carry": return mcp.marketCarryData(symbol);
        case "market_snapshot": return http.marketSnapshot(symbol, { interval: "1h", limit: 120, scope: "aggregate", include_liquidations: true });
        case "liquidation_map": return http.liquidationMap(symbol, { scope: "current", view: "clusters", order: "nearest", limit: 20, side: "all" });
        case "liquidation_visual": {
          const response = await wrapFetchWithPayment(globalThis.fetch, paymentClient)(`${baseUrl}${step.resource}`);
          if (!response.ok || !response.headers.has("payment-response")) throw new Error("Visual payment/result was not confirmed");
          const receipt = new x402HTTPClient(paymentClient).getPaymentSettleResponse((name) => response.headers.get(name));
          validatePaymentSettlement(step.resource!, receipt);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!response.headers.get("content-type")?.startsWith("image/png") || bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("Visual route did not return PNG");
          return { contentType: "image/png", bytes: bytes.length };
        }
      }
    })();
    // These transports do not consistently expose the actual amount. Preserve
    // the authorization as uncertainAtomic instead of inventing chargedAtomic.
    return { value };
  } finally { await mcp.close(); }
});
console.log(JSON.stringify({ schema: "ask_omni_bundle.v1", mode: "live", network, symbol, tier,
  result, execution: "Research only. No order was previewed or placed." }, null, 2));
if (!result.complete) process.exitCode = 1;
