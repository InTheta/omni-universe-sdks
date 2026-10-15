import type { InfoClient } from "@nktkas/hyperliquid";
import { OmniContractError } from "./errors.js";

export interface RecentReconciliationOptions {
  /** Explicit inclusive Unix milliseconds; at most seven days, ending in the past. */
  startTime: number; endTime: number;
  /** Total request ceiling including metadata and current-position reads; 4..64. */
  maxRequests?: number;
  /** Whole-report deadline; 1..60000 milliseconds. */
  timeoutMs?: number; signal?: AbortSignal;
  /** Matching evidence only; never filters instrument-period accounting. */
  expectedOrderIds?: readonly number[];
}
export interface ReconciliationFill {
  coin: string; oid: number; tid: number; hash: string; time: number;
  side: "B" | "A"; px: string; sz: string; startPosition: string; dir: string;
  closedPnl: string; fee: string; feeToken: string; builderFee?: string;
}
export interface ReconciliationFunding {
  time: number; hash: string;
  delta: { type: "funding"; coin: string; usdc: string; szi: string; fundingRate: string; nSamples: number | null };
}
type Window = { startTime: number; endTime: number };
export interface ReconciliationCoverage {
  requests: number; accountRowsObserved: number; instrumentRowsObserved: number;
  /** Request coverage only; does not prove upstream retention or ledger completeness. */
  requestedWindowFetched: boolean; retentionVerified: false;
  gaps: Array<Window & { reason: "request_budget_exhausted" | "same_timestamp_saturation" | "request_failed" | "deadline_exceeded" }>;
}
export interface RecentReconciliationReport {
  schema: "omni.hyperliquid_recent_reconciliation.v1"; network: "hyperliquid-testnet";
  accountAddress: string; symbol: string; observedAt: number;
  window: Window & { inclusive: true }; fullLedgerReconciled: false;
  fills: ReconciliationFill[]; funding: ReconciliationFunding[];
  expectedOrders: { requested: number[]; observed: number[]; missing: number[] };
  totals: { scope: "observed_instrument_period"; closedPnlUsdc: string; fundingNetUsdc: string;
    feesByToken: Record<string, string>;
    /** Informational subset already included in feesByToken. Never subtract twice. */
    builderFeesIncludedByToken: Record<string, string>; realizedNetCashPnlUsdc: string | null;
    netCashPnlUnavailableReason: "non_usdc_fees" | null };
  snapshot: { observedAt: number; venueTime: number | null;
    position: { coin: string; szi: string; unrealizedPnl: string } | null };
  coverage: { fills: ReconciliationCoverage; funding: ReconciliationCoverage };
  limits: { conservativePageThreshold: 500; fillRetention: "latest_10000_fills";
    builderCredit: "unverified"; fundingAttribution: "account_instrument_period_not_order" };
}
function invalid(): never { throw new OmniContractError("Invalid recent reconciliation response", "hyperliquid:recent-reconciliation"); }
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) return invalid(); return v as Record<string, unknown>; }
function integer(v: unknown): number { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return invalid(); return v; }
function text(v: unknown): string { if (typeof v !== "string" || !v.length || v.length > 128 || v !== v.trim()) return invalid(); return v; }
function decimal(v: unknown): string { if (typeof v !== "string" || v.length > 128 || !/^-?\d+(?:\.\d{1,36})?$/.test(v)) return invalid(); return v; }
function hash(v: unknown): string { if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/i.test(v)) return invalid(); return v; }
function sum(values: readonly string[]): string {
  let units = 0n, scale = 0;
  for (const value of values) {
    const [whole, fraction = ""] = decimal(value).split("."), nextScale = Math.max(scale, fraction.length);
    units = units * 10n ** BigInt(nextScale - scale) + BigInt(whole! + fraction) * 10n ** BigInt(nextScale - fraction.length);
    scale = nextScale;
  }
  const negative = units < 0n, digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const formatted = scale ? (digits.slice(0, -scale) + "." + digits.slice(-scale)).replace(/\.?0+$/, "") : digits;
  return (negative ? "-" : "") + formatted;
}
function negate(v: string): string { return v.startsWith("-") ? v.slice(1) : "-" + v; }
function fill(v: unknown): ReconciliationFill {
  const r = record(v); if (r.side !== "B" && r.side !== "A") return invalid();
  return {coin: text(r.coin), oid: integer(r.oid), tid: integer(r.tid), hash: hash(r.hash), time: integer(r.time), side: r.side,
    px: decimal(r.px), sz: decimal(r.sz), startPosition: decimal(r.startPosition), dir: text(r.dir),
    closedPnl: decimal(r.closedPnl), fee: decimal(r.fee), feeToken: text(r.feeToken),
    ...(r.builderFee === undefined ? {} : {builderFee: decimal(r.builderFee)})};
}
function funding(v: unknown): ReconciliationFunding {
  const r = record(v), d = record(r.delta); if (d.type !== "funding") return invalid();
  return {time: integer(r.time), hash: hash(r.hash), delta: {type: "funding", coin: text(d.coin), usdc: decimal(d.usdc),
    szi: decimal(d.szi), fundingRate: decimal(d.fundingRate), nSamples: d.nSamples === null ? null : integer(d.nSamples)}};
}
/** Bound even adapters that ignore AbortSignal; retain no upstream error as a cause. */
function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException("Reconciliation read interrupted", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, {once: true});
    Promise.resolve().then(() => { if (signal.aborted) throw new DOMException("Reconciliation read interrupted", "AbortError"); return operation(); })
      .then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
async function collect<T extends {time: number}>(
  query: (range: Window) => Promise<unknown>, parse: (row: unknown) => T, key: (row: T) => string,
  select: (row: T) => boolean, range: Window, maxRequests: number, signal: AbortSignal, external?: AbortSignal,
): Promise<{rows: T[]; coverage: ReconciliationCoverage}> {
  const coverage: ReconciliationCoverage = {requests: 0, accountRowsObserved: 0, instrumentRowsObserved: 0, requestedWindowFetched: false, retentionVerified: false, gaps: []};
  const pending: Window[] = [range], rows = new Map<string, T>();
  while (pending.length) {
    const next = pending.shift()!;
    if (external?.aborted) throw new DOMException("Reconciliation canceled", "AbortError");
    if (coverage.requests >= maxRequests || signal.aborted) {
      const reason = signal.aborted ? "deadline_exceeded" : "request_budget_exhausted";
      coverage.gaps.push(...[next, ...pending].map(window => ({...window, reason} as const))); break;
    }
    coverage.requests++;
    let response: unknown;
    try { response = await bounded(() => query(next), signal); }
    catch {
      if (external?.aborted) throw new DOMException("Reconciliation canceled", "AbortError");
      coverage.gaps.push({...next, reason: signal.aborted ? "deadline_exceeded" : "request_failed"}); continue;
    }
    if (!Array.isArray(response)) return invalid();
    for (const item of response) {
      const row = parse(item); if (row.time < next.startTime || row.time > next.endTime) return invalid();
      const id = key(row), prior = rows.get(id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) return invalid();
      rows.set(id, row);
    }
    // Generic info time ranges may cap at 500 rows/distinct blocks. Split inclusive
    // integer-ms windows before filtering by coin; never skip same-ms events.
    if (response.length >= 500) {
      if (next.startTime === next.endTime) coverage.gaps.push({...next, reason: "same_timestamp_saturation"});
      else { const mid = next.startTime + Math.floor((next.endTime - next.startTime) / 2);
        pending.push({startTime: next.startTime, endTime: mid}, {startTime: mid + 1, endTime: next.endTime}); }
    }
  }
  coverage.accountRowsObserved = rows.size;
  const selected = [...rows.values()].filter(select).sort((a, b) => a.time - b.time);
  coverage.instrumentRowsObserved = selected.length; coverage.requestedWindowFetched = coverage.gaps.length === 0;
  return {rows: selected, coverage};
}
/** Internal implementation. Scope is supplied only by the fixed testnet executor. */
export async function collectRecentReconciliation(info: InfoClient, scope: {accountAddress: string; symbol: string}, options: RecentReconciliationOptions): Promise<RecentReconciliationReport> {
  const observedAt = Date.now(), {startTime, endTime} = options;
  if (!Number.isSafeInteger(startTime) || startTime < 0 || !Number.isSafeInteger(endTime) || endTime < startTime || endTime > observedAt || endTime - startTime > 7 * 86400_000) throw new RangeError("Explicit past inclusive startTime/endTime required; at most seven days");
  const maxRequests = options.maxRequests ?? 12, timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 4 || maxRequests > 64) throw new RangeError("maxRequests must be 4..64");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new RangeError("timeoutMs must be 1..60000");
  const expected = [...(options.expectedOrderIds ?? [])];
  if (expected.length > 64 || expected.some(id => !Number.isSafeInteger(id) || id < 0) || new Set(expected).size !== expected.length) throw new RangeError("expectedOrderIds must be at most 64 unique nonnegative safe integers");
  const deadline = new AbortController();
  // Keep the deadline referenced: an abort-ignoring adapter must not let Node exit
  // with the awaited report unresolved after its own transport timer expires.
  const deadlineTimer = setTimeout(() => deadline.abort(), timeoutMs);
  try {
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  if (options.signal?.aborted) throw new DOMException("Reconciliation canceled", "AbortError");
  let metadata: unknown, state: unknown;
  let snapshotObservedAt: number;
  try { metadata = await bounded(() => info.meta({}, signal), signal); snapshotObservedAt = Date.now();
    state = await bounded(() => info.clearinghouseState({user: scope.accountAddress as `0x${string}`}, signal), signal); }
  catch { if (options.signal?.aborted) throw new DOMException("Reconciliation canceled", "AbortError");
    throw new OmniContractError("Reconciliation scope or snapshot unavailable; no complete report", "hyperliquid:recent-reconciliation"); }
  const universe = record(metadata).universe;
  if (!Array.isArray(universe) || universe.filter(item => record(item).name === scope.symbol).length !== 1) return invalid();
  const account = record(state); if (!Array.isArray(account.assetPositions)) return invalid();
  const positions = account.assetPositions.map(item => record(record(item).position)).filter(item => item.coin === scope.symbol);
  if (positions.length > 1) return invalid(); const position = positions[0];
  const snapshot = {observedAt: snapshotObservedAt, venueTime: account.time === undefined ? null : integer(account.time),
    position: position ? {coin: scope.symbol, szi: decimal(position.szi), unrealizedPnl: decimal(position.unrealizedPnl)} : null};
  const fillBudget = Math.floor((maxRequests - 2) / 2);
  const fills = await collect(window => info.userFillsByTime({user: scope.accountAddress as `0x${string}`, ...window, aggregateByTime: false}, signal),
    fill, row => row.coin + ":" + row.tid, row => row.coin === scope.symbol, {startTime, endTime}, fillBudget, signal, options.signal);
  const fundings = await collect(window => info.userFunding({user: scope.accountAddress as `0x${string}`, ...window}, signal),
    funding, row => row.hash + ":" + row.time + ":" + row.delta.coin, row => row.delta.coin === scope.symbol, {startTime, endTime}, maxRequests - 2 - fillBudget, signal, options.signal);
  const tokens = [...new Set(fills.rows.map(row => row.feeToken))].sort();
  const feesByToken = Object.fromEntries(tokens.map(token => [token, sum(fills.rows.filter(row => row.feeToken === token).map(row => row.fee))]));
  const builderFeesIncludedByToken = Object.fromEntries(tokens.map(token => [token, sum(fills.rows.filter(row => row.feeToken === token).map(row => row.builderFee ?? "0"))]));
  const closedPnlUsdc = sum(fills.rows.map(row => row.closedPnl)), fundingNetUsdc = sum(fundings.rows.map(row => row.delta.usdc));
  const nonUsdc = tokens.some(token => token !== "USDC" && feesByToken[token] !== "0"), observed = expected.filter(id => fills.rows.some(row => row.oid === id));
  return {schema: "omni.hyperliquid_recent_reconciliation.v1", network: "hyperliquid-testnet", accountAddress: scope.accountAddress, symbol: scope.symbol,
    observedAt, window: {startTime, endTime, inclusive: true}, fullLedgerReconciled: false, fills: fills.rows, funding: fundings.rows,
    expectedOrders: {requested: expected, observed, missing: expected.filter(id => !observed.includes(id))},
    totals: {scope: "observed_instrument_period", closedPnlUsdc, fundingNetUsdc, feesByToken, builderFeesIncludedByToken,
      realizedNetCashPnlUsdc: nonUsdc ? null : sum([closedPnlUsdc, fundingNetUsdc, negate(feesByToken.USDC ?? "0")]), netCashPnlUnavailableReason: nonUsdc ? "non_usdc_fees" : null},
    snapshot, coverage: {fills: fills.coverage, funding: fundings.coverage},
    limits: {conservativePageThreshold: 500, fillRetention: "latest_10000_fills", builderCredit: "unverified", fundingAttribution: "account_instrument_period_not_order"}};
  } finally { clearTimeout(deadlineTimer); }
}
