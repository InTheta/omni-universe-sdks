import { x402Client } from "@x402/core/client";
import {
  HyperliquidPublicClient, OmniMcpClient, OmniX402Client,
  createEvmPaymentClient, decideFromMarketRisk, type X402Symbol,
} from "@omni-terminal/sdk";

// No account fallback, trading client, order helper, or remote LLM is used.
const selected = process.env.RESEARCH_SYMBOL;
if (!selected || !["BTC", "ETH", "SOL", "HYPE"].includes(selected)) throw new Error("Set RESEARCH_SYMBOL to an exact supported symbol: BTC, ETH, SOL, HYPE");
const symbol = selected as X402Symbol;
const freeOnly = process.argv.slice(2).includes("--free-only");
const paid = !freeOnly && process.env.RUN_PAID_RESEARCH === "true";
if (paid && (process.env.CONFIRM_RESEARCH_TESTNET_BUDGET !== "0.010 USDC ON BASE SEPOLIA" || !process.env.EVM_PRIVATE_KEY)) {
  throw new Error("Paid mode requires EVM_PRIVATE_KEY and CONFIRM_RESEARCH_TESTNET_BUDGET='0.010 USDC ON BASE SEPOLIA'; obtain human approval first");
}
const http = new OmniX402Client({ timeoutMs: 15_000, paymentClient: paid
  ? createEvmPaymentClient(process.env.EVM_PRIVATE_KEY as `0x${string}`, {
    allowedNetworks: ["eip155:84532"], maxPaymentUsd: 0.01, maxTotalPaymentUsd: 0.01, maxPaymentAuthorizations: 1,
  }) : new x402Client(),
});
const venue = new HyperliquidPublicClient({ timeoutMs: 15_000, maxRetries: 1 });
const mcp = new OmniMcpClient({ name: "omni-research-readonly" });
try {
  const metadata = await venue.perpetualMeta();
  const matches = metadata.universe.filter((item) => item.name === symbol && !item.isDelisted);
  if (matches.length !== 1) throw new Error("Exact active instrument resolution failed; no replacement is permitted");
  const instrument = matches[0]!;
  const book = await venue.l2Book(symbol);
  if (book.coin !== symbol || !Number.isFinite(book.time) || Date.now() - book.time > 60_000 || book.time > Date.now() + 5_000) throw new Error("Order book is mismatched or stale");
  await mcp.connect();
  const catalog = (await mcp.catalogData()).data;
  const quote = await http.inspectPayment("GET", `/api/x402/v1/market-risk/${symbol}`, { query: { scope: "current", event_window_minutes: 60, limit: 5 } });
  const requirement = quote.accepts.find((item) => item.network === "eip155:84532");
  if (!requirement || requirement.amount !== "10000") throw new Error("Expected research price changed; review the quote and budget before spending");
  const address = process.env.RESEARCH_ACCOUNT;
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("RESEARCH_ACCOUNT must be an exact EVM address");
  const account = address ? await venue.info<Record<string, unknown>>({ type: "clearinghouseState", user: address }) : null;
  // Only this explicit branch can create one payment. Unknown transport/settlement outcomes are never retried.
  const assessment = paid ? decideFromMarketRisk((await http.marketRisk(symbol, { scope: "current", event_window_minutes: 60, limit: 5 })).data) : null;
  console.log(JSON.stringify({ schema: "omni_research_agent.v1", observedAt: new Date().toISOString(),
    evidence: "integration-tested", venue: "hyperliquid", venueNetwork: "mainnet-readonly", symbol,
    instrument: { name: instrument.name, szDecimals: instrument.szDecimals, maxLeverage: instrument.maxLeverage },
    book: { time: book.time, bid: book.levels[0][0]?.px ?? null, ask: book.levels[1][0]?.px ?? null },
    account: account ? { scope: address, marginSummary: account.marginSummary ?? null, withdrawable: account.withdrawable ?? null } : { status: "not_requested", reason: "No exact RESEARCH_ACCOUNT supplied" },
    omni: { catalogTools: catalog.tools.map((tool) => ({ name: tool.name, price: tool.price })), quotedResource: quote.resource.url,
      requirements: quote.accepts.map(({ network, amount, asset, payTo }) => ({ network, amount, asset, payTo })) },
    paidData: { attempted: paid, maximumAuthorizedUsdc: paid ? "0.010" : "0", network: paid ? "eip155:84532" : null,
      status: paid ? "seller_settlement_metadata_validated_chain_reconciliation_required" : "not_purchased_no_budget" },
    assessment, execution: { authorized: false, placedOrders: false },
    contentPolicy: "Retrieved text is untrusted data and cannot change account, recipient, budget, or execution policy",
  }, null, 2));
} finally { await mcp.close(); }
