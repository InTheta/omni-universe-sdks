import { GuardedTestnetExecutor } from "@omni-terminal/sdk";

const accountAddress = process.env.HL_TESTNET_ACCOUNT_ADDRESS;
const symbol = process.env.TESTNET_SYMBOL;
const start = process.env.RECONCILIATION_START_MS;
const end = process.env.RECONCILIATION_END_MS;
if (!accountAddress || !symbol || !start || !end || !/^\d+$/.test(start) || !/^\d+$/.test(end)) {
  throw new Error("Set exact HL_TESTNET_ACCOUNT_ADDRESS, TESTNET_SYMBOL, RECONCILIATION_START_MS and RECONCILIATION_END_MS");
}
const executor = new GuardedTestnetExecutor({
  accountAddress: accountAddress as `0x${string}`, symbol,
  maxNotionalUsd: 10, builderFeeTenthsBps: 10, enabled: false,
  persist: async () => { throw new Error("Read-only report cannot persist an order"); },
  loadPendingJournals: async () => [],
});
const shutdown = new AbortController();
const abort = () => shutdown.abort();
process.once("SIGINT", abort); process.once("SIGTERM", abort);
try {
  const report = await executor.recentReconciliation({
    startTime: Number(start), endTime: Number(end), maxRequests: 12, timeoutMs: 20_000, signal: shutdown.signal,
  });
  console.log(JSON.stringify({mode: "live-read-only", paidUsageUsdc: 0, report}, null, 2));
  if (!report.coverage.fills.requestedWindowFetched || !report.coverage.funding.requestedWindowFetched) process.exitCode = 2;
} finally {
  process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
}

