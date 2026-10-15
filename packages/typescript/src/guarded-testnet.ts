import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import type { PrivateKeyAccount } from "viem";

export const OMNI_HL_BUILDER = "0x733f40a4fa0cd13d59abade04b9ed2e9acac6457" as const;
export interface GuardedTestnetPolicy {
  accountAddress: `0x${string}`;
  symbol: string;
  maxNotionalUsd: number;
  /** Tenths of a basis point: 10 = 1 bp. Owner approval is checked separately. */
  builderFeeTenthsBps: number;
  enabled?: boolean;
  /** Explicitly allow IOC entry and reduce-only cleanup, max 10 bp price bound. */
  allowTaker?: boolean;
  signer?: PrivateKeyAccount;
  /** Must atomically persist before returning. No credentials are included. */
  persist: (journal: TestnetJournal) => Promise<void>;
  loadPendingJournals: () => Promise<readonly TestnetJournal[]>;
}
export interface GuardedTestnetPlan {
  network: "hyperliquid-testnet";
  accountAddress: `0x${string}`;
  symbol: string;
  asset: number;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  notionalUsd: number;
  createdAt: number;
  expiresAt: number;
  cloid: `0x${string}`;
  tif: "Alo" | "Ioc";
  reduceOnly: boolean;
  builder: { b: typeof OMNI_HL_BUILDER; f: number };
}
export interface TestnetJournal {
  plan: GuardedTestnetPlan;
  stage: "prepared" | "submitting" | "submitted" | "uncertain" | "cancel_requested" | "reconciled" | "rejected";
  startedAt: number;
  orderId?: number;
  baselinePosition?: string;
  rejection?: string;
}

/** Testnet validator perps only. No funding, approvals, vaults, spot or mainnet methods. */
export class GuardedTestnetExecutor {
  readonly #transport = new HttpTransport({ isTestnet: true, timeout: 10_000 });
  readonly #info = new InfoClient({ transport: this.#transport });
  readonly #policy: GuardedTestnetPolicy;
  readonly #issued = new Map<string, string>();
  readonly #used = new Set<string>();
  #activeCloid: string | undefined;
  readonly #reductionPositions = new Map<string, string>();

  constructor(policy: GuardedTestnetPolicy) {
    if (!/^0x[0-9a-f]{40}$/i.test(policy.accountAddress)) throw new Error("Exact testnet accountAddress required");
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(policy.symbol)) throw new Error("Exact validator perpetual symbol required");
    if (!Number.isFinite(policy.maxNotionalUsd) || policy.maxNotionalUsd < 10 || policy.maxNotionalUsd > 25) throw new Error("Testnet cap must be 10..25 USD");
    if (!Number.isInteger(policy.builderFeeTenthsBps) || policy.builderFeeTenthsBps < 1 || policy.builderFeeTenthsBps > 25) throw new Error("Disclosed builder fee must be 1..25 tenths bp");
    if (typeof policy.loadPendingJournals !== "function") throw new Error("Durable pending-journal reader required");
    if (typeof policy.persist !== "function") throw new Error("Durable journal persistence required");
    this.#policy = Object.freeze({ ...policy });
  }

  async market(): Promise<{asset: number; symbol: string; szDecimals: number; midPrice: number; bookTime: number}> {
    const [meta] = await this.#info.metaAndAssetCtxs();
    const asset = meta.universe.findIndex(x => x.name === this.#policy.symbol && !x.isDelisted);
    const metadata = meta.universe[asset];
    if (!metadata) throw new Error("Exact instrument unavailable; no substitution allowed");
    const book = await this.#info.l2Book({ coin: metadata.name });
    if (!book) throw new Error("Missing order book");
    const bid = Number(book.levels[0][0]?.px), ask = Number(book.levels[1][0]?.px);
    if (book.coin !== metadata.name || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || Math.abs(Date.now() - book.time) > 10_000) throw new Error("Stale or invalid order book");
    return { asset, symbol: metadata.name, szDecimals: metadata.szDecimals, midPrice: (bid + ask) / 2, bookTime: book.time };
  }

  async account() {
    const user = this.#policy.accountAddress;
    const state = await this.#info.clearinghouseState({ user });
    const approvedBuilderFee = await this.#info.maxBuilderFee({ user, builder: OMNI_HL_BUILDER });
    const position = state.assetPositions.find(item => item.position.coin === this.#policy.symbol)?.position;
    const finiteDecimal = (value: unknown): string | null => typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? value : null;
    const margin = {
      currency: "USD" as const,
      instrument: this.#policy.symbol,
      mode: position ? position.leverage?.type ?? "unknown" : "no_position",
      leverage: position?.leverage?.value ?? null,
      // Venue totalMarginUsed is initial margin; crossMaintenanceMarginUsed excludes isolated positions.
      initialMarginUsd: finiteDecimal(state.marginSummary?.totalMarginUsed),
      crossInitialMarginUsd: finiteDecimal(state.crossMarginSummary?.totalMarginUsed),
      crossMaintenanceMarginUsd: finiteDecimal(state.crossMaintenanceMarginUsed),
      instrumentInitialMarginUsd: finiteDecimal(position?.marginUsed),
      instrumentMaintenanceMarginUsd: null,
      maintenanceMarginScope: "cross_account_only" as const,
      availableCollateralUsd: finiteDecimal(state.withdrawable),
    };
    return { network: "hyperliquid-testnet" as const, accountAddress: user, state, margin, approvedBuilderFee };
  }

  async preview(side: "BUY" | "SELL", notionalUsd: number, options: { kind?: "passive" | "ioc" } = {}): Promise<GuardedTestnetPlan> {
    if (side !== "BUY" && side !== "SELL") throw new Error("Explicit BUY or SELL required");
    if (!Number.isFinite(notionalUsd) || notionalUsd < 10 || notionalUsd > this.#policy.maxNotionalUsd) throw new Error("Order exceeds fixed policy cap");
    if (options.kind === "ioc" && !this.#policy.allowTaker) throw new Error("IOC requires explicit allowTaker policy");
    const market = await this.market();
    const price = formatPrice(market.midPrice * (options.kind === "ioc" ? (side === "BUY" ? 1.001 : 0.999) : (side === "BUY" ? 0.98 : 1.02)), market.szDecimals);
    const size = formatSize(notionalUsd / Number(price), market.szDecimals);
    const actual = Number(price) * Number(size);
    if (actual < 10 || actual > notionalUsd + 1e-9) throw new Error("Formatted order outside approved budget");
    const plan: GuardedTestnetPlan = { network: "hyperliquid-testnet", accountAddress: this.#policy.accountAddress, symbol: market.symbol, asset: market.asset, side, price, size, notionalUsd: actual, createdAt: Date.now(), expiresAt: Date.now() + 15_000, cloid: `0x${crypto.randomUUID().replaceAll("-", "")}`, tif: options.kind === "ioc" ? "Ioc" : "Alo", reduceOnly: false, builder: { b: OMNI_HL_BUILDER, f: this.#policy.builderFeeTenthsBps } };
    this.#issued.set(plan.cloid, JSON.stringify(plan));
    return structuredClone(plan);
  }

  #exchange() {
    if (!this.#policy.enabled || !this.#policy.signer) throw new Error("TESTNET_EXECUTION_DISABLED: dedicated approved testnet signer and explicit enable required");
    return new ExchangeClient({ transport: this.#transport, wallet: this.#policy.signer, defaultExpiresAfter: () => Date.now() + 15_000 });
  }

  async #assertSignerAuthority(): Promise<void> {
    const signer = this.#policy.signer;
    if (!signer) throw new Error("Dedicated testnet signer required");
    if (signer.address.toLowerCase() === this.#policy.accountAddress.toLowerCase()) return;
    const agents = await this.#info.extraAgents({ user: this.#policy.accountAddress });
    if (!agents.some(agent => agent.address.toLowerCase() === signer.address.toLowerCase() && (agent.validUntil === null || (Number.isFinite(agent.validUntil) && agent.validUntil > Date.now() + 15_000)))) throw new Error("SIGNER_SCOPE_MISMATCH: signer must be owner or an unexpired agent authorised by the exact owner");
  }

  async submit(plan: GuardedTestnetPlan): Promise<TestnetJournal> {
    const exchange = this.#exchange();
    if (this.#activeCloid || this.#used.has(plan.cloid)) throw new Error("One outstanding order per executor; reconcile before any new order");
    if (this.#issued.get(plan.cloid) !== JSON.stringify(plan) || Date.now() > plan.expiresAt) throw new Error("Unknown, modified or expired preview");
    this.#activeCloid = plan.cloid;
    try {
      const pending = await this.#policy.loadPendingJournals();
      if (pending.some(j => j.stage !== "reconciled" && j.stage !== "rejected")) throw new Error("PENDING_RECOVERY_REQUIRED: reconcile durable journals before a new entry");
      await this.#assertSignerAuthority();
      const openOrders = await this.#info.openOrders({ user: this.#policy.accountAddress });
      if (openOrders.some(order => order.coin === this.#policy.symbol)) throw new Error("OPEN_ORDER_RECOVERY_REQUIRED: existing instrument orders must be reconciled first");
      const account = await this.account();
      if (!Number.isSafeInteger(account.approvedBuilderFee) || account.approvedBuilderFee < this.#policy.builderFeeTenthsBps) throw new Error("BUILDER_APPROVAL_REQUIRED: owner must separately approve disclosed Omni fee on testnet");
      const position = account.state.assetPositions.find(p => p.position.coin === this.#policy.symbol)?.position.szi ?? "0";
      if (plan.reduceOnly ? position !== this.#reductionPositions.get(plan.cloid) : Number(position) !== 0) throw new Error("POSITION_BASELINE_MISMATCH: preserve unrelated exposure");
      if (!plan.reduceOnly && (account.margin.availableCollateralUsd === null || Number(account.margin.availableCollateralUsd) < plan.notionalUsd)) throw new Error("INSUFFICIENT_COLLATERAL: require full notional collateral");
      const market = await this.market();
      if (market.asset !== plan.asset || (plan.tif === "Alo" ? (Math.abs(Number(plan.price) / market.midPrice - 1) < 0.01 || Math.abs(Number(plan.price) / market.midPrice - 1) > 0.05 || (plan.side === "BUY" ? Number(plan.price) >= market.midPrice : Number(plan.price) <= market.midPrice)) : (!this.#policy.allowTaker || Math.abs(Number(plan.price) / market.midPrice - 1) > 0.002))) throw new Error("Market moved beyond passive price bounds; obtain fresh preview");
      if (Date.now() > plan.expiresAt) throw new Error("Expired preview");
      const journal: TestnetJournal = { plan: structuredClone(plan), stage: "submitting", startedAt: Date.now(), baselinePosition: position };
      this.#used.add(plan.cloid);
      await this.#policy.persist(structuredClone(journal));
      try {
        const response = await exchange.order({ orders: [{ a: plan.asset, b: plan.side === "BUY", p: plan.price, s: plan.size, r: plan.reduceOnly, t: { limit: { tif: plan.tif } }, c: plan.cloid }], grouping: "na", builder: plan.builder });
        const status = response.response.data.statuses[0];
        if (status && typeof status === "object" && "resting" in status) journal.orderId = status.resting.oid;
        else if (status && typeof status === "object" && "filled" in status) journal.orderId = status.filled.oid;
        if (status && typeof status === "object" && "error" in status) {
          journal.stage = "rejected";
          journal.rejection = "VENUE_ORDER_REJECTED";
          await this.#policy.persist(structuredClone(journal));
          if (this.#activeCloid === plan.cloid) this.#activeCloid = undefined;
          return journal;
        }
        journal.stage = "submitted";
        await this.#policy.persist(structuredClone(journal));
        return journal;
      } catch (error) {
        if (error instanceof ApiRequestError) {
          const response = error.response as {status?: unknown; response?: unknown};
          const nested = response?.response as {type?: unknown; data?: {statuses?: unknown[]}} | undefined;
          const only = nested?.data?.statuses?.[0] as {error?: unknown} | undefined;
          const rejection = response?.status === "err" && typeof response.response === "string" ? response.response : (nested?.type === "order" && nested.data?.statuses?.length === 1 && typeof only?.error === "string" ? only.error : undefined);
          if (rejection !== undefined) {
            journal.stage = "rejected"; journal.rejection = "VENUE_ORDER_REJECTED";
            await this.#policy.persist(structuredClone(journal));
            if (this.#activeCloid === plan.cloid) this.#activeCloid = undefined;
            return journal;
          }
        }
        journal.stage = "uncertain";
        await this.#policy.persist(structuredClone(journal));
        throw new Error(`UNCERTAIN_ORDER: reconcile journal cloid ${plan.cloid}; never resubmit`);
      }
    } catch (error) {
      if (!this.#used.has(plan.cloid) && this.#activeCloid === plan.cloid) this.#activeCloid = undefined;
      throw error;
    }
  }

  #validateJournal(journal: TestnetJournal) {
    const plan = journal.plan;
    if (plan.network !== "hyperliquid-testnet" || plan.accountAddress !== this.#policy.accountAddress || plan.symbol !== this.#policy.symbol || plan.builder.b !== OMNI_HL_BUILDER || plan.builder.f !== this.#policy.builderFeeTenthsBps || !/^0x[0-9a-f]{32}$/i.test(plan.cloid)) throw new Error("Journal outside fixed execution scope");
  }

  async status(journal: TestnetJournal) {
    this.#validateJournal(journal);
    return this.#info.orderStatus({ user: this.#policy.accountAddress, oid: journal.plan.cloid });
  }

  async cancel(journal: TestnetJournal): Promise<TestnetReconciliation> {
    this.#validateJournal(journal);
    if (journal.stage === "rejected") return this.reconcile(journal);
    const exchange = this.#exchange();
    await this.#assertSignerAuthority();
    const state = await this.status(journal);
    if (state.status === "unknownOid") throw new Error("UNCERTAIN_ORDER: not indexed; do not resubmit");
    if (state.order.order.coin !== this.#policy.symbol || state.order.order.cloid !== journal.plan.cloid) throw new Error("Authoritative order scope mismatch");
    if (state.order.status === "open") {
      // Cancellation must remain available during stale or unavailable market-data feeds.
      // Resolve the exact validator asset afresh; never trust a persisted asset index alone.
      // Delisted metadata is retained so its outstanding orders can still be canceled.
      const metadata = await this.#info.meta();
      const matches = metadata.universe.flatMap((item, asset) => item.name === this.#policy.symbol ? [asset] : []);
      if (matches.length !== 1 || !Number.isSafeInteger(journal.plan.asset) || matches[0] !== journal.plan.asset) throw new Error("Authoritative cancellation asset scope mismatch");
      journal.stage = "cancel_requested";
      await this.#policy.persist(structuredClone(journal));
      await exchange.cancelByCloid({ cancels: [{ asset: matches[0]!, cloid: journal.plan.cloid }] });
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await this.reconcile(journal);
      if (result.complete) return result;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("CANCEL_UNCERTAIN: retain journal; poll authoritative status before retrying any entry");
  }

  async reconcile(journal: TestnetJournal): Promise<TestnetReconciliation> {
    this.#validateJournal(journal);
    if (journal.stage === "rejected" && journal.rejection) return { complete: true, status: { status: "exchangeRejected", error: journal.rejection } };
    const status = await this.status(journal);
    if (status.status === "unknownOid") return { complete: false, reason: "unknown_outcome_do_not_resubmit", status };
    const order = status.order.order;
    if (order.coin !== this.#policy.symbol || order.cloid !== journal.plan.cloid) throw new Error("Authoritative order scope mismatch");
    const fills = (await this.#info.userFillsByTime({ user: this.#policy.accountAddress, startTime: journal.startedAt - 1_000 })).filter(fill => fill.oid === order.oid);
    const account = await this.account();
    const terminalStatuses = new Set([
      "filled", "canceled", "rejected", "marginCanceled", "vaultWithdrawalCanceled", "openInterestCapCanceled", "selfTradeCanceled", "reduceOnlyCanceled", "siblingFilledCanceled", "delistedCanceled", "liquidatedCanceled", "outcomeSettledCanceled", "scheduledCancel", "internalCancel", "tickRejected", "minTradeNtlRejected", "perpMarginRejected", "reduceOnlyRejected", "badAloPxRejected", "iocCancelRejected", "badTriggerPxRejected", "marketOrderNoLiquidityRejected", "positionIncreaseAtOpenInterestCapRejected", "positionFlipAtOpenInterestCapRejected", "tooAggressiveAtOpenInterestCapRejected", "openInterestIncreaseRejected", "insufficientSpotBalanceRejected", "oracleRejected", "perpMaxPositionRejected", "tooManyOpenOrdersRejected",
    ]);
    const complete = terminalStatuses.has(status.order.status);
    if (!complete && status.order.status !== "open" && status.order.status !== "triggered") return { complete: false, reason: "unrecognized_status_do_not_resubmit", status };
    if (complete) { journal.stage = "reconciled"; await this.#policy.persist(structuredClone(journal)); if (this.#activeCloid === journal.plan.cloid) this.#activeCloid = undefined; }
    return { complete, status, fills, account, attribution: fills.length === 0 ? "unproven_no_fills" : "builder_fee_fields_only_verify_builder_export", fees: fills.map(fill => ({ fee: fill.fee, builderFee: fill.builderFee, token: fill.feeToken })), remainingExposure: account.state.assetPositions.filter(p => p.position.coin === this.#policy.symbol) };
  }

  /** Close only this executor's entry fills from a verified flat baseline; never arbitrary existing positions. */
  async previewReduction(entry: TestnetJournal): Promise<GuardedTestnetPlan> {
    if (!this.#policy.allowTaker || entry.plan.reduceOnly || Number(entry.baselinePosition) !== 0) throw new Error("Cleanup requires an IOC-enabled entry from flat baseline");
    const result = await this.reconcile(entry);
    if (!result.complete || !result.fills?.length) throw new Error("Authoritative completed entry fills required before reduction");
    const delta = result.fills.reduce((total, fill) => total + (fill.side === "B" ? 1 : -1) * Number(fill.sz), 0);
    const current = result.remainingExposure?.[0]?.position.szi ?? "0";
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(Number(current) - delta) > 1e-9) throw new Error("Position changed outside this entry; manual reconciliation required");
    const market = await this.market();
    const side = delta > 0 ? "SELL" : "BUY";
    const size = formatSize(Math.abs(delta), market.szDecimals);
    if (Math.abs(Number(size) - Math.abs(delta)) > 1e-9) throw new Error("Cleanup precision mismatch");
    const price = formatPrice(market.midPrice * (side === "BUY" ? 1.001 : 0.999), market.szDecimals);
    const notionalUsd = Number(price) * Number(size);
    // A bounded cleanup must cover the entry size even after its <= 25 USD price moves.
    if (!Number.isFinite(notionalUsd) || notionalUsd > this.#policy.maxNotionalUsd * 1.01) throw new Error("Cleanup exceeds price-movement allowance; operator recovery required");
    const plan: GuardedTestnetPlan = { network: "hyperliquid-testnet", accountAddress: this.#policy.accountAddress, symbol: this.#policy.symbol, asset: market.asset, side, price, size, notionalUsd, createdAt: Date.now(), expiresAt: Date.now() + 15_000, cloid: `0x${crypto.randomUUID().replaceAll("-", "")}`, tif: "Ioc", reduceOnly: true, builder: { b: OMNI_HL_BUILDER, f: this.#policy.builderFeeTenthsBps } };
    this.#issued.set(plan.cloid, JSON.stringify(plan));
    this.#reductionPositions.set(plan.cloid, current);
    return structuredClone(plan);
  }

  async runLifecycle(plan: GuardedTestnetPlan): Promise<TestnetReconciliation> {
    const journal = await this.submit(plan);
    return this.cancel(journal);
  }
}

export interface TestnetReconciliation { complete: boolean; reason?: string; status: Awaited<ReturnType<InfoClient["orderStatus"]>> | {status: "exchangeRejected"; error: string}; fills?: Awaited<ReturnType<InfoClient["userFillsByTime"]>>; account?: Awaited<ReturnType<GuardedTestnetExecutor["account"]>>; attribution?: string; fees?: { fee: string; builderFee?: string; token: string }[]; remainingExposure?: Awaited<ReturnType<InfoClient["clearinghouseState"]>>["assetPositions"]; }
