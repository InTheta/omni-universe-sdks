/** Local stdio server. Signing stays in this client process, never in Omni's seller MCP. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GuardedTestnetExecutor, type TestnetJournal } from "@omni-terminal/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createGuardedTradingMcpServer } from "./mcp-trading.js";

const accountAddress = process.env.HL_TESTNET_ACCOUNT_ADDRESS;
const symbol = process.env.TESTNET_SYMBOL;
const journalPath = process.env.OMNI_TESTNET_MCP_JOURNAL;
if (!accountAddress || !/^0x[0-9a-f]{40}$/i.test(accountAddress) || !symbol || !journalPath) throw new Error("Explicit HL_TESTNET_ACCOUNT_ADDRESS, TESTNET_SYMBOL and OMNI_TESTNET_MCP_JOURNAL required; no account or symbol defaults");
const enabled = process.env.RUN_TESTNET_MCP_TRADING === "true";
if (enabled && process.env.CONFIRM_TESTNET_ORDER !== "HYPERLIQUID_TESTNET_ONLY") throw new Error("Explicit testnet order confirmation required");
const key = process.env.HL_TESTNET_PRIVATE_KEY;
if (enabled && (!key || !/^0x[0-9a-f]{64}$/i.test(key))) throw new Error("Dedicated approved HL_TESTNET_PRIVATE_KEY required");
const server = createGuardedTradingMcpServer((persist, loadPendingJournals) => new GuardedTestnetExecutor({
  accountAddress: accountAddress as `0x${string}`,
  symbol,
  maxNotionalUsd: Number(process.env.TESTNET_MAX_NOTIONAL_USD ?? "15"),
  builderFeeTenthsBps: Number(process.env.TESTNET_BUILDER_FEE_TENTHS_BPS ?? "10"),
  enabled,
  allowTaker: process.env.TESTNET_ALLOW_TAKER === "true",
  signer: enabled && key ? privateKeyToAccount(key as `0x${string}`) : undefined,
  persist,
  loadPendingJournals: async () => await loadPendingJournals() as readonly TestnetJournal[],
}), journalPath);
const close = async () => { await server.close(); process.exit(0); };
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
await server.connect(new StdioServerTransport());
