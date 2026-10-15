import { HyperliquidPublicClient, OmniClient } from "@omni-terminal/sdk";

const publicOnly = process.argv.slice(2).includes("--public-only");
const client = new OmniClient({
  baseUrl: process.env.OMNI_API_URL,
  apiKey: publicOnly ? undefined : process.env.OMNI_API_KEY,
});
const hyperliquid = new HyperliquidPublicClient({ baseUrl: process.env.HYPERLIQUID_API_URL });

console.log("health", await client.health());
console.log("Hyperliquid perpetuals", (await hyperliquid.perpetuals()).slice(0, 10));
console.log("Hyperliquid candles", (await hyperliquid.candles("BTC", "1h")).slice(-3));

if (!publicOnly && process.env.OMNI_API_KEY) {
  console.log("paid news", await client.newsForSymbol("BTC", { limit: 5, lookback_days: 1 }));
  if (process.env.RUN_ASK_OMNI === "true") {
    console.log("Ask Omni", await client.askOmni({
      presetId: "risk_overview",
      question: "Summarize current BTC market risk using public market context.",
      selectedSymbol: "BTC",
    }));
  } else {
    console.log("Ask Omni skipped: set RUN_ASK_OMNI=true only with general API plan access; a News-only entitlement is not sufficient.");
  }
} else {
  console.log(publicOnly
    ? "Public-only mode: keyed AI News and Ask Omni calls were disabled."
    : "Set OMNI_API_KEY for keyed AI News. Ask Omni additionally needs RUN_ASK_OMNI=true and general API plan access.");
}
