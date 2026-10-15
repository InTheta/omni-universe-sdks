import { mkdir, writeFile, rename, readdir, readFile, open, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { GuardedTestnetExecutor, type TestnetJournal } from "@omni-terminal/sdk";
import { privateKeyToAccount } from "viem/accounts";

// The operator supplies a dedicated testnet runtime environment.
const enabled = process.env.RUN_TESTNET_ORDERS === "true";
if (!process.env.HL_TESTNET_ACCOUNT_ADDRESS || !process.env.TESTNET_SYMBOL) throw new Error("Set exact HL_TESTNET_ACCOUNT_ADDRESS and TESTNET_SYMBOL");
if (enabled && process.env.CONFIRM_TESTNET_ORDER !== "HYPERLIQUID_TESTNET_ONLY") throw new Error("Explicit testnet confirmation required");
const directory = resolve(process.env.TESTNET_JOURNAL_DIRECTORY ?? "./testnet-journals");
await mkdir(directory, { recursive: true, mode: 0o700 });
const persist = async (journal: TestnetJournal) => {
  const file = join(directory, `${journal.plan.cloid}.json`);
  const temporary = `${file}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(journal, null, 2)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
  const directoryHandle = await open(directory, "r");
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
};
const executor = new GuardedTestnetExecutor({
  accountAddress: process.env.HL_TESTNET_ACCOUNT_ADDRESS as `0x${string}`,
  symbol: process.env.TESTNET_SYMBOL,
  maxNotionalUsd: Number(process.env.TESTNET_MAX_NOTIONAL_USD ?? 15),
  builderFeeTenthsBps: Number(process.env.TESTNET_BUILDER_FEE_TENTHS_BPS ?? 25),
  enabled,
  allowTaker: process.env.TESTNET_ALLOW_IOC === "true",
  ...(enabled ? { signer: privateKeyToAccount(process.env.HL_TESTNET_PRIVATE_KEY as `0x${string}`) } : {}),
  persist,
  loadPendingJournals: async () => Promise.all((await readdir(directory)).filter(name => name.endsWith(".json")).map(async name => JSON.parse(await readFile(join(directory, name), "utf8")) as TestnetJournal)),
});
const plan = await executor.preview("BUY", Number(process.env.TESTNET_MAX_NOTIONAL_USD ?? 15), { kind: process.env.TESTNET_ALLOW_IOC === "true" ? "ioc" : "passive" });
const account = await executor.account();
if (!enabled) console.log(JSON.stringify({ mode: "live-read-only", plan, account, costUsdc: 0 }));
else {
  const lock = join(directory, ".execution-lock");
  await writeFile(lock, "One process only. If interrupted, reconcile every journal before removing this lock.\n", { flag: "wx", mode: 0o600 });
  // Existing journals require explicit recovery. A fresh process cannot silently repeat a prior run.
  const existing = (await readdir(directory)).filter(name => name.endsWith(".json") || name.endsWith(".tmp"));
  if (existing.length) throw new Error("Existing execution journals: reconcile them before a new session");
  try {
    const entry = await executor.submit(plan);
    const result = await executor.cancel(entry);
    if (result.fills?.length) {
      const reduction = await executor.previewReduction(entry);
      const cleanup = await executor.submit(reduction);
      const final = await executor.cancel(cleanup);
      console.log(JSON.stringify({ mode: "testnet-cleanup", result: final }));
      if (!final.complete || final.remainingExposure?.length) throw new Error("Cleanup incomplete; preserve recovery journal");
    }
    console.log(JSON.stringify({ mode: "testnet-executed", result }));
    if (result.complete) await unlink(lock);
  } catch {
    throw new Error("Execution interrupted or uncertain; preserve journal and lock, query status/cancel/reconcile using public SDK; never rerun blindly");
  }
}
