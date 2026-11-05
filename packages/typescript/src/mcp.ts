import type {PublicWalletGraph,PublicWalletPair,PublicWalletLinks,PublicWalletGraphQuery,PublicWalletLinksQuery} from "./types.js";
import {walletGraphSymbol,walletGraphAddress,validateWalletGraphQuery,assertWalletGraphIdentity,walletGraphPaidFailure} from "./wallet-graph-contract.js";
import type { PublicCongressFiling, PublicCongressQuery } from "./types.js";
import {validateCongressRequest,assertCongressFilingIdentity} from "./x402.js";
import type { PublicMarketAlerts, PublicMarketAlertsQuery } from "./types.js";
import { validateMarketAlertsQuery, assertMarketAlertsIdentity } from "./x402.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402Client } from "@x402/core/client";
import { wrapMCPClientWithPayment, type PaymentRequestedContext, type SettleResponse, type x402MCPClient, type x402MCPToolCallResult } from "@x402/mcp";
import { OmniContractError } from "./errors.js";
import type { EntityResolution, MarketCarry, MarketRisk, NewsPulse, PremarketRoundup, PremarketRoundupQuery, TraderLeaderboard, TraderProfile, LiquidationMap, MarketSnapshot, MarketMicrostructure, FundingHistory } from "./types.js";
import { createEvmPaymentClient, DEFAULT_MAX_X402_PAYMENT_USD, validatePaymentSettlement, assertPublicMarketSymbol, validatePublicMarketsQuery, validateLiquidationWindows, assertSpotPairIndex, assertSpotResultIdentity, validateSpotCandlesQuery, validateSpotMarketsQuery, type ScreenshotPng } from "./x402.js";
import type { PublicMarketCatalog, PublicMarketsQuery, L4BookSnapshot, RealizedLiquidations, LiquidationWindow, PublicSpotMarketCatalog, PublicSpotMarketsQuery, SpotMarketQuote, SpotCandles, SpotCandleInterval } from "./types.js";

export type OmniMcpToolName =
  | "get_wallet_graph" | "get_wallet_pair" | "get_wallet_links"
  | "get_congress_filing"
  | "get_market_catalog"
  | "list_market_instruments"
  | SpotMcpToolName
  | "get_market_moving_events"
  | "get_market_risk_context"
  | "resolve_market_entities"
  | "get_market_carry"
  | "get_premarket_roundup"
  | PublicJsonMcpToolName
  | ScreenshotMcpToolName;
export type SpotMcpToolName="get_spot_market_quote"|"get_spot_candles"|"list_spot_market_instruments";
export type PublicJsonMcpToolName="get_market_alerts"|"get_trader_leaderboard"|"get_trader_profile"|"get_liquidation_map"|"get_market_snapshot"|"get_market_microstructure"|"get_funding_history"|"get_l4_orderbook"|"get_realized_liquidations";
export type ScreenshotMcpToolName="get_liquidation_levels_screenshot"|"get_liquidation_bucket_screenshot"|"get_trader_profile_screenshot";
export type PublicMcpToolName=OmniMcpToolName|PublicJsonMcpToolName|ScreenshotMcpToolName;

export const SDK_VERSION = "0.8.4";

export interface OmniMcpMarketCatalog {
  service: "omni-market-intelligence";
  protocol: "mcp+x402";
  transport: "streamable-http";
  endpoint: string;
  networks: string[];
  markets: Array<"crypto" | "equities" | "macro" | "forex">;
  symbols: string[];
  tools: Array<{
    name: Exclude<OmniMcpToolName, "get_market_catalog">;
    price: string;
    schema: string;
    description: string;
    useWhen: string;
  }>;
}

export interface OmniMcpDataResult<T> {
  data: T;
  payment: SettleResponse | null;
  raw: x402MCPToolCallResult;
}

export interface OmniMcpClientOptions {
  timeoutMs?: number;
  maxPaymentAuthorizations?: number;
  maxTotalPaymentUsd?: number;
  allowedPayees?: readonly `0x${string}`[];
  allowedNetworks?: readonly ("eip155:84532" | "eip155:8453")[];
  url?: string;
  privateKey?: `0x${string}`;
  maxPaymentUsd?: number;
  approvePayment?: (context: PaymentRequestedContext) => boolean | Promise<boolean>;
  headers?: HeadersInit;
  name?: string;
  version?: string;
}

/** Safe wrapper boundary: protocol messages/data can contain echoed payment proofs. */
export class OmniMcpProtocolError extends Error {
  readonly code: number | null;
  readonly operation: "connect" | "listTools" | "callTool" | "close";
  constructor(operation: OmniMcpProtocolError["operation"], error: unknown) {
    const candidate = error && typeof error === "object" ? error as { code?: unknown; name?: unknown } : undefined;
    const cancelled = candidate?.name === "AbortError";
    const timeout = candidate?.name === "TimeoutError";
    super(`MCP ${operation} ${cancelled ? "was cancelled" : timeout ? "timed out" : "failed"}; reconcile any uncertain payment before retrying`);
    this.name = cancelled ? "AbortError" : timeout ? "TimeoutError" : "OmniMcpProtocolError";
    this.operation = operation;
    this.code = typeof candidate?.code === "number" && Number.isSafeInteger(candidate.code) ? candidate.code : null;
  }
}

export class OmniMcpClient {
  private readonly client: x402MCPClient;
  private readonly rawClient: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private readonly timeoutMs: number;

  constructor(options: OmniMcpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new RangeError("timeoutMs must be a positive safe integer");
    const rawClient = new Client({
      name: options.name ?? "omni-sdk-agent",
      version: options.version ?? SDK_VERSION,
    });
    this.rawClient = rawClient;
    const paymentClient = options.privateKey
      ? createEvmPaymentClient(options.privateKey, {
        maxPaymentUsd: options.maxPaymentUsd ?? DEFAULT_MAX_X402_PAYMENT_USD,
        maxPaymentAuthorizations: options.maxPaymentAuthorizations,
        maxTotalPaymentUsd: options.maxTotalPaymentUsd,
        allowedPayees: options.allowedPayees,
        allowedNetworks: options.allowedNetworks,
      })
      : new x402Client();
    this.client = wrapMCPClientWithPayment(rawClient, paymentClient, {
      autoPayment: true,
      onPaymentRequested: async (context) => {
        if (["get_market_catalog","list_market_instruments","list_spot_market_instruments"].includes(context.toolName)) {
          throw new OmniContractError("A free MCP discovery tool unexpectedly requested payment", `mcp:${context.toolName}`, context.paymentRequired);
        }
        return options.approvePayment ? options.approvePayment(context) : false;
      },
    });
    this.transport = new StreamableHTTPClientTransport(
      new URL(options.url ?? "https://omniterminal.app/api/x402/mcp"),
      options.headers ? { requestInit: { headers: options.headers } } : undefined,
    );
  }

  async connect(options: { signal?: AbortSignal } = {}): Promise<this> {
    try { await this.rawClient.connect(this.transport, { timeout: this.timeoutMs, signal: options.signal }); }
    catch (error) { throw new OmniMcpProtocolError("connect", error); }
    return this;
  }

  async listTools(options: { signal?: AbortSignal } = {}) {
    try { return await this.rawClient.listTools({}, { timeout: this.timeoutMs, signal: options.signal }); }
    catch (error) { throw new OmniMcpProtocolError("listTools", error); }
  }

  async callTool(name: OmniMcpToolName, args: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}): Promise<x402MCPToolCallResult> {
    const validated = validateMcpToolArguments(name, args);
    let result: x402MCPToolCallResult;
    try { result = await this.client.callTool(name, validated, { timeout: this.timeoutMs, signal: options.signal, resetTimeoutOnProgress: false }); }
    catch (error) { throw new OmniMcpProtocolError("callTool", error); }
    validateMcpToolResult(name, result);
    return result;
  }

  async callJsonTool<T>(name: OmniMcpToolName, args: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}): Promise<OmniMcpDataResult<T>> {
    return parseMcpToolJson<T>(name, await this.callTool(name, args, options));
  }

  catalog(): Promise<x402MCPToolCallResult> {
    return this.callTool("get_market_catalog");
  }

  catalogData(): Promise<OmniMcpDataResult<OmniMcpMarketCatalog>> {
    return this.callJsonTool("get_market_catalog");
  }
  async walletGraphData(rawSymbol:string,query:PublicWalletGraphQuery={}):Promise<OmniMcpDataResult<PublicWalletGraph>> {
    const symbol=walletGraphSymbol(rawSymbol);validateWalletGraphQuery(query,"graph");try{const result=await this.callJsonTool<PublicWalletGraph>("get_wallet_graph",{...query,symbol});assertWalletGraphIdentity(result.data,symbol,"graph",query);return result;}catch(error){return walletGraphPaidFailure(error);}
  }
  async walletPairData(rawSymbol:string,rawA:string,rawB:string):Promise<OmniMcpDataResult<PublicWalletPair>> {
    const symbol=walletGraphSymbol(rawSymbol),a=walletGraphAddress(rawA),b=walletGraphAddress(rawB);if(a===b)throw new RangeError("wallet pair requires distinct public addresses");try{const result=await this.callJsonTool<PublicWalletPair>("get_wallet_pair",{symbol,address_a:a,address_b:b});assertWalletGraphIdentity(result.data,symbol,"pair",{},a,b);return result;}catch(error){return walletGraphPaidFailure(error);}
  }
  async walletLinksData(rawSymbol:string,rawAddress:string,query:PublicWalletLinksQuery={}):Promise<OmniMcpDataResult<PublicWalletLinks>> {
    const symbol=walletGraphSymbol(rawSymbol),address=walletGraphAddress(rawAddress);validateWalletGraphQuery(query,"links");try{const result=await this.callJsonTool<PublicWalletLinks>("get_wallet_links",{...query,symbol,address});assertWalletGraphIdentity(result.data,symbol,"links",query,address);return result;}catch(error){return walletGraphPaidFailure(error);}
  }
  async congressFilingData(docId:string,query:PublicCongressQuery={}):Promise<OmniMcpDataResult<PublicCongressFiling>> {
    validateCongressRequest(docId,query);
    try {const result=await this.callJsonTool<PublicCongressFiling>("get_congress_filing",{...query,doc_id:docId});assertCongressFilingIdentity(result.data,docId,query);return result;}
    catch(error){if(error instanceof OmniContractError)Object.defineProperties(error,{requiresReconciliation:{value:true,enumerable:true},retryable:{value:false,enumerable:true},paymentOutcome:{value:"unconfirmed",enumerable:true}});throw error;}
  }
  async marketAlertsData(symbol:string,query:PublicMarketAlertsQuery={}):Promise<OmniMcpDataResult<PublicMarketAlerts>>{const result=await this.callJsonTool<PublicMarketAlerts>("get_market_alerts",{...query,symbol});assertMarketAlertsIdentity(result.data,symbol);return result;}
  marketInstrumentsData(query:PublicMarketsQuery={}):Promise<OmniMcpDataResult<PublicMarketCatalog>>{return this.callJsonTool("list_market_instruments",{...query});}
  spotMarketInstrumentsData(query:PublicSpotMarketsQuery={}):Promise<OmniMcpDataResult<PublicSpotMarketCatalog>>{return this.callJsonTool("list_spot_market_instruments",{...query});}
  async spotMarketQuoteData(pairIndex:number,query:{depth?:number}={}):Promise<OmniMcpDataResult<SpotMarketQuote>>{const result=await this.callJsonTool<SpotMarketQuote>("get_spot_market_quote",{...query,pair_index:pairIndex});assertSpotResultIdentity(result.data,pairIndex);return result;}
  async spotCandlesData(pairIndex:number,query:{interval?:SpotCandleInterval;limit?:number}={}):Promise<OmniMcpDataResult<SpotCandles>>{const result=await this.callJsonTool<SpotCandles>("get_spot_candles",{...query,pair_index:pairIndex});assertSpotResultIdentity(result.data,pairIndex);return result;}

  marketMovingEvents(args: { symbol?: string; market?: "crypto" | "equities" | "macro" | "forex"; limit?: number; lookback_hours?: number; event_window_minutes?: 15 | 60 }): Promise<x402MCPToolCallResult> {
    return this.callTool("get_market_moving_events", args);
  }

  marketMovingEventsData(args: { symbol?: string; market?: "crypto" | "equities" | "macro" | "forex"; limit?: number; lookback_hours?: number; event_window_minutes?: 15 | 60 }): Promise<OmniMcpDataResult<NewsPulse>> {
    return this.callJsonTool("get_market_moving_events", args);
  }

  marketRisk(args: { symbol: string; scope?: "current" | "aggregate"; event_window_minutes?: 15 | 60; limit?: number }): Promise<x402MCPToolCallResult> {
    return this.callTool("get_market_risk_context", args);
  }

  marketRiskData(args: { symbol: string; scope?: "current" | "aggregate"; event_window_minutes?: 15 | 60; limit?: number }): Promise<OmniMcpDataResult<MarketRisk>> {
    return this.callJsonTool("get_market_risk_context", args);
  }

  resolveEntities(mentions: string[]): Promise<x402MCPToolCallResult> {
    return this.callTool("resolve_market_entities", { mentions, venue: "hyperliquid" });
  }

  resolveEntitiesData(mentions: string[]): Promise<OmniMcpDataResult<EntityResolution>> {
    return this.callJsonTool("resolve_market_entities", { mentions, venue: "hyperliquid" });
  }

  marketCarry(symbol: string): Promise<x402MCPToolCallResult> {
    return this.callTool("get_market_carry", { symbol });
  }

  marketCarryData(symbol: string): Promise<OmniMcpDataResult<MarketCarry>> {
    return this.callJsonTool("get_market_carry", { symbol });
  }

  premarketRoundup(input: number | PremarketRoundupQuery = 1): Promise<x402MCPToolCallResult> {
    return this.callTool("get_premarket_roundup", premarketArguments(input));
  }

  premarketRoundupData(input: number | PremarketRoundupQuery = 1): Promise<OmniMcpDataResult<PremarketRoundup>> {
    return this.callJsonTool("get_premarket_roundup", premarketArguments(input));
  }

  traderLeaderboardData(symbol:string,query:Record<string,unknown>={}):Promise<OmniMcpDataResult<TraderLeaderboard>>{return this.callJsonTool("get_trader_leaderboard",{...query,symbol});}
  traderProfileData(address:string,query:Record<string,unknown>={}):Promise<OmniMcpDataResult<TraderProfile>>{return this.callJsonTool("get_trader_profile",{...query,address});}
  liquidationMapData(symbol:string,query:Record<string,unknown>={}):Promise<OmniMcpDataResult<LiquidationMap>>{return this.callJsonTool("get_liquidation_map",{...query,symbol});}
  marketSnapshotData(symbol:string,query:Record<string,unknown>={}):Promise<OmniMcpDataResult<MarketSnapshot>>{return this.callJsonTool("get_market_snapshot",{...query,symbol});}
  marketMicrostructureData(symbol:string,query:{depth?:number;trade_limit?:number;trade_window_seconds?:number}={}):Promise<OmniMcpDataResult<MarketMicrostructure>>{return this.callJsonTool("get_market_microstructure",{...query,symbol});}
  fundingHistoryData(symbol:string,query:{lookback_hours?:number;limit?:number}={}):Promise<OmniMcpDataResult<FundingHistory>>{return this.callJsonTool("get_funding_history",{...query,symbol});}
  l4BookSnapshotData(symbol:string,query:{orders_per_side?:number}={}):Promise<OmniMcpDataResult<L4BookSnapshot>>{return this.callJsonTool("get_l4_orderbook",{...query,symbol});}
  realizedLiquidationsData(symbol:string,query:{scope?:"current"|"aggregate";windows?:readonly LiquidationWindow[]}={}):Promise<OmniMcpDataResult<RealizedLiquidations>>{return this.callJsonTool("get_realized_liquidations",{...query,symbol});}
  async screenshotData(name:ScreenshotMcpToolName,args:Record<string,unknown>,options:{signal?:AbortSignal}={}):Promise<OmniMcpDataResult<ScreenshotPng>>{return parseMcpScreenshot(name,await this.callTool(name,args,options));}

  async close(): Promise<void> {
    try { await this.client.close(); }
    catch (error) { throw new OmniMcpProtocolError("close", error); }
  }
}

const mcpToolContracts: Record<OmniMcpToolName, { service: string; schema?: string; requiredCollection?: string }> = {
  get_wallet_graph:{service:"omni.public_wallet_graph",schema:"public_wallet_graph.v1",requiredCollection:"nodes"},
  get_wallet_pair:{service:"omni.public_wallet_graph",schema:"public_wallet_graph.v1",requiredCollection:"nodes"},
  get_wallet_links:{service:"omni.public_wallet_graph",schema:"public_wallet_graph.v1",requiredCollection:"nodes"},
  get_congress_filing:{service:"omni.public_congress_filing",schema:"public_congress_filing.v1",requiredCollection:"rows"},
  get_market_alerts:{service:"omni.public_market_alerts",schema:"public_market_alerts.v1",requiredCollection:"events"},
  list_spot_market_instruments:{service:"omni.public_spot_market_catalog",schema:"public_spot_market_catalog.v1",requiredCollection:"rows"},
  get_spot_market_quote:{service:"omni.hyperliquid_spot_quote",schema:"hyperliquid_spot_quote.v1"},
  get_spot_candles:{service:"omni.hyperliquid_spot_candles",schema:"hyperliquid_spot_candles.v1",requiredCollection:"candles"},
  list_market_instruments:{service:"omni.public_market_catalog",schema:"public_market_catalog.v1",requiredCollection:"rows"},
  get_trader_leaderboard:{service:"omni.hyperliquid_trader_leaderboard",schema:"hyperliquid_trader_leaderboard.v1",requiredCollection:"rows"},
  get_trader_profile:{service:"omni.trader_profile",schema:"trader_profile.v1",requiredCollection:"positions"},
  get_liquidation_map:{service:"omni.hyperliquid_liquidation_map",schema:"hyperliquid_liquidation_map.v1"},
  get_market_snapshot:{service:"omni.hyperliquid_market_snapshot",schema:"hyperliquid_market_snapshot.v1",requiredCollection:"candles"},
  get_market_microstructure:{service:"omni.hyperliquid_market_microstructure",schema:"hyperliquid_market_microstructure.v1",requiredCollection:"trades"},
  get_funding_history:{service:"omni.hyperliquid_funding_history",schema:"hyperliquid_funding_history.v1",requiredCollection:"rows"},
  get_l4_orderbook:{service:"omni.hyperliquid_l4_snapshot",schema:"hyperliquid_l4_snapshot.v1",requiredCollection:"bids"},
  get_realized_liquidations:{service:"omni.hyperliquid_realized_liquidations",schema:"hyperliquid_realized_liquidations.v1",requiredCollection:"windows"},
  get_liquidation_levels_screenshot:{service:"omni.liquidation_levels_screenshot",schema:"omni_screenshot.v1"},
  get_liquidation_bucket_screenshot:{service:"omni.liquidation_bucket_screenshot",schema:"omni_screenshot.v1"},
  get_trader_profile_screenshot:{service:"omni.trader_profile_screenshot",schema:"omni_screenshot.v1"},
  get_market_catalog: { service: "omni-market-intelligence", requiredCollection: "tools" },
  get_market_moving_events: { service: "omni.ai_news_pulse", schema: "news_pulse.v1", requiredCollection: "items" },
  get_market_risk_context: { service: "omni.market_risk_snapshot", schema: "market_risk_snapshot.v1" },
  resolve_market_entities: { service: "omni.market_entity_resolution", schema: "market_entity_resolution.v1", requiredCollection: "results" },
  get_market_carry: { service: "omni.hyperliquid_market_carry", schema: "hyperliquid_market_carry.v1" },
  get_premarket_roundup: { service: "omni.premarket_roundup", schema: "premarket_roundup.v1", requiredCollection: "items" },
};

export function validateMcpToolResult(
  name: OmniMcpToolName,
  result: unknown,
): asserts result is x402MCPToolCallResult {
  const route = `mcp:${name}`;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new OmniContractError(`Invalid MCP result for ${name}: expected an object`, route, result);
  }
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.content) || record.content.length === 0) {
    throw new OmniContractError(`Invalid MCP result for ${name}: expected non-empty content`, route, result);
  }
  if (record.isError === true) {
    throw new OmniContractError(`MCP tool ${name} returned an error`, route, result);
  }
  const paid = name !== "get_market_catalog" && name !== "list_market_instruments" && name !== "list_spot_market_instruments";
  if (paid && record.paymentMade !== true) {
    throw new OmniContractError(`Paid MCP tool ${name} returned without payment`, route, result);
  }
  if (!paid && record.paymentMade !== false) {
    throw new OmniContractError(`Free MCP tool ${name} returned unexpected payment state`, route, result);
  }
  if (paid) validatePaymentSettlement(route, record.paymentResponse);
}

export function parseMcpScreenshot(name:ScreenshotMcpToolName,result:unknown,maxBytes=10*1024*1024):OmniMcpDataResult<ScreenshotPng>{
  validateMcpToolResult(name,result);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<8||maxBytes>15*1024*1024)throw new RangeError("maxBytes must be between 8 and 15728640");
  const images=result.content.filter(x=>x.type==="image");
  if(images.length!==1 || images[0]?.type!=="image" || images[0].mimeType!=="image/png" || typeof images[0].data!=="string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(images[0].data) || images[0].data.length>Math.ceil(maxBytes/3)*4)throw new OmniContractError("Invalid bounded MCP PNG result",`mcp:${name}`,undefined);
  const bytes=Uint8Array.from(atob(images[0].data),c=>c.charCodeAt(0));
  const magic=[137,80,78,71,13,10,26,10];
  if(bytes.length>maxBytes||!magic.every((n,i)=>bytes[i]===n))throw new OmniContractError("Invalid MCP PNG signature",`mcp:${name}`,undefined);
  const metadata=parseMcpToolJson<Record<string,unknown>>(name,result).data;
  if(metadata.product!==name||metadata.bytes!==bytes.length)throw new OmniContractError("MCP screenshot metadata does not match its image",`mcp:${name}`,undefined);
  return{data:{contentType:"image/png",bytes,byteLength:bytes.length},payment:result.paymentResponse??null,raw:result};
}

export function parseMcpToolJson<T>(name: OmniMcpToolName, result: unknown): OmniMcpDataResult<T> {
  validateMcpToolResult(name, result);
  const route = `mcp:${name}`;
  let data: unknown;
  for (const item of result.content) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      const candidate = JSON.parse(item.text) as unknown;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        data = candidate;
        break;
      }
    } catch {
      // Ignore non-JSON text frames and continue looking for the product frame.
    }
  }
  if (!data) throw new OmniContractError(`MCP tool ${name} omitted its JSON product frame`, route, result);
  validateMcpProductContract(route, data, mcpToolContracts[name]);
  return { data: data as T, payment: result.paymentResponse ?? null, raw: result };
}

function validateMcpProductContract(
  route: string,
  data: unknown,
  contract: { service: string; schema?: string; requiredCollection?: string },
): void {
  const record = data as Record<string, unknown>;
  if (record.service !== contract.service) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected service ${contract.service}`, route, data);
  }
  if (contract.schema !== undefined && record.schema !== contract.schema) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected schema ${contract.schema}`, route, data);
  }
  if (contract.requiredCollection !== undefined && !Array.isArray(record[contract.requiredCollection])) {
    throw new OmniContractError(`Invalid response contract for ${route}: expected ${contract.requiredCollection} array`, route, data);
  }
}

/** Validate and normalize live Omni MCP tool arguments before a paid call can begin. */
export function validateMcpToolArguments(
  name: OmniMcpToolName,
  args: unknown = {},
): Record<string, unknown> {
  const input = assertArgumentObject(args);

  switch (name) {
    case "get_wallet_graph": {assertOnlyKeys(name,input,["symbol","limit","edge_limit"]);const {symbol,...query}=input;validateWalletGraphQuery(query,"graph");return {...query,symbol:walletGraphSymbol(symbol)};}
    case "get_wallet_pair": {assertOnlyKeys(name,input,["symbol","address_a","address_b"]);const a=walletGraphAddress(input.address_a),b=walletGraphAddress(input.address_b);if(a===b)throw new RangeError("wallet pair requires distinct public addresses");return {symbol:walletGraphSymbol(input.symbol),address_a:a,address_b:b};}
    case "get_wallet_links": {assertOnlyKeys(name,input,["symbol","address","limit"]);const {symbol,address,...query}=input;validateWalletGraphQuery(query,"links");return {...query,symbol:walletGraphSymbol(symbol),address:walletGraphAddress(address)};}

    case "get_congress_filing": {
      assertOnlyKeys(name,input,["doc_id","limit","offset","public_revision"]);const {doc_id,...query}=input;validateCongressRequest(doc_id as string,query);return {...query,doc_id};
    }

    case "get_market_alerts": {
      assertOnlyKeys(name,input,["symbol","limit","lookback_hours","before_timestamp","types"]);
      const {symbol,...query}=input;assertPublicMarketSymbol(symbol);validateMarketAlertsQuery(query as PublicMarketAlertsQuery);return{...query,symbol};
    }

    case "get_market_catalog":
      assertOnlyKeys(name, input, []);
      return {};
    case "list_market_instruments":
      validatePublicMarketsQuery(input as PublicMarketsQuery);
      return {...input};
    case "list_spot_market_instruments":
      validateSpotMarketsQuery(input as PublicSpotMarketsQuery);return{...input};
    case "get_spot_market_quote":
      assertOnlyKeys(name,input,["pair_index","depth"]);assertSpotPairIndex(input.pair_index);assertOptionalInteger("depth",input.depth,1,20);return{...input};
    case "get_spot_candles":
      assertOnlyKeys(name,input,["pair_index","interval","limit"]);assertSpotPairIndex(input.pair_index);validateSpotCandlesQuery(input as {interval?:SpotCandleInterval;limit?:number});return{...input};
    case "get_market_moving_events": {
      assertOnlyKeys(name, input, ["symbol", "market", "limit", "lookback_hours", "event_window_minutes"]);
      const output = { ...input };
      if (input.symbol !== undefined) output.symbol = normalizeString("symbol", input.symbol, 2, 15);
      assertOptionalOneOf("market", input.market, ["crypto", "equities", "macro", "forex"]);
      assertOptionalInteger("limit", input.limit, 1, 20);
      assertOptionalInteger("lookback_hours", input.lookback_hours, 1, 168);
      assertOptionalOneOf("event_window_minutes", input.event_window_minutes, [15, 60]);
      return output;
    }
    case "get_market_risk_context": {
      assertOnlyKeys(name, input, ["symbol", "scope", "event_window_minutes", "limit"]);
      const output = { ...input, symbol: normalizeString("symbol", input.symbol, 2, 15) };
      assertOptionalOneOf("scope", input.scope, ["current", "aggregate"]);
      assertOptionalOneOf("event_window_minutes", input.event_window_minutes, [15, 60]);
      assertOptionalInteger("limit", input.limit, 1, 10);
      return output;
    }
    case "resolve_market_entities": {
      assertOnlyKeys(name, input, ["mentions", "venue"]);
      if (!Array.isArray(input.mentions) || input.mentions.length < 1 || input.mentions.length > 20) {
        throw new RangeError("mentions must contain between 1 and 20 entries");
      }
      const mentions = input.mentions.map((mention, index) => normalizeString(`mentions[${index}]`, mention, 1, 100));
      assertOptionalOneOf("venue", input.venue, ["hyperliquid"]);
      return { mentions, venue: input.venue ?? "hyperliquid" };
    }
    case "get_market_carry": {
      assertOnlyKeys(name, input, ["symbol"]);
      const symbol=normalizeString("symbol",input.symbol,1,80);
      assertPublicMarketSymbol(symbol);
      return { symbol };
    }
    case "get_premarket_roundup":
      assertOnlyKeys(name, input, ["limit", "date"]);
      assertOptionalInteger("limit", input.limit, 1, 5);
      if (input.date !== undefined) assertIsoDate("date", input.date);
      return { limit: input.limit ?? 1, ...(input.date === undefined ? {} : { date: input.date }) };
    default:
      return validatePublicMcpArguments(name,input);
  }
}

function validatePublicMcpArguments(name:Exclude<PublicJsonMcpToolName,"get_market_alerts">|ScreenshotMcpToolName,input:Record<string,unknown>){
  if(input.symbol!==undefined)input={...input,symbol:normalizeString("symbol",input.symbol,1,80)};
  const fields:Record<Exclude<PublicJsonMcpToolName,"get_market_alerts">|ScreenshotMcpToolName,string[]>={
    get_trader_leaderboard:["symbol","scope","rank","limit"],get_trader_profile:["address","range","view","symbol","limit"],get_liquidation_map:["symbol","scope","view","limit","order","around_price","side"],get_market_snapshot:["symbol","scope","interval","limit","include_liquidations"],get_market_microstructure:["symbol","depth","trade_limit","trade_window_seconds"],get_funding_history:["symbol","lookback_hours","limit"],get_l4_orderbook:["symbol","orders_per_side"],get_realized_liquidations:["symbol","scope","windows"],get_liquidation_levels_screenshot:["symbol","interval","scope","layout"],get_liquidation_bucket_screenshot:["symbol","price","price_end","bucket_size","side","scope"],get_trader_profile_screenshot:["address","symbol","range","tab","mode"],
  };
  assertOnlyKeys(name,input,fields[name]);
  const profile=name==="get_trader_profile"||name==="get_trader_profile_screenshot";
  if(profile){if(typeof input.address!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(input.address))throw new RangeError("address must be a full EVM address");}
  if(!profile||input.symbol!==undefined)assertPublicMarketSymbol(input.symbol);
  if(name.endsWith("screenshot")||name==="get_trader_profile"){if(input.symbol!==undefined&&!['BTC','ETH','SOL','HYPE'].includes(String(input.symbol)))throw new RangeError("symbol is not supported by this product");}
  assertOptionalOneOf("scope",input.scope,["current","aggregate"]);
  assertOptionalOneOf("rank",input.rank,["best","worst","largest","largest_size","wallet_size","risk","closest"]);
  assertOptionalOneOf("range",input.range,["1d","7d","30d","all"]);
  assertOptionalOneOf("interval",input.interval,["1m","5m","15m","1h","2h","4h","8h","1d","3d","1w","1M"]);
  assertOptionalOneOf("layout",input.layout,["compact","standard","tall"]);
  assertOptionalOneOf("tab",input.tab,["positions","pnl","balance","mixed"]);
  assertOptionalOneOf("mode",input.mode,["chart","stats","full_stats"]);
  if(input.view!==undefined)assertOptionalOneOf("view",input.view,name==="get_trader_profile"?["summary","positions","balances","full"]:["summary","buckets","clusters","flow"]);
  assertOptionalOneOf("order",input.order,["strongest","nearest","price"]);
  if(input.side!==undefined)assertOptionalOneOf("side",input.side,name.endsWith("screenshot")?["all","buy","sell"]:["all","long","short"]);
  assertOptionalInteger("limit",input.limit,name==="get_market_snapshot"?20:1,name==="get_market_snapshot"?200:name==="get_funding_history"?168:name==="get_liquidation_map"?50:20);
  assertOptionalInteger("depth",input.depth,1,50);assertOptionalInteger("trade_limit",input.trade_limit,1,100);assertOptionalInteger("trade_window_seconds",input.trade_window_seconds,1,3600);assertOptionalInteger("lookback_hours",input.lookback_hours,1,168);
  assertOptionalInteger("orders_per_side",input.orders_per_side,1,50);validateLiquidationWindows(input.windows);
  for(const key of ["price","price_end","bucket_size","around_price"])if(input[key]!==undefined&&(typeof input[key]!=="number"||!Number.isFinite(input[key])||Number(input[key])<=0||Number(input[key])>1e9))throw new RangeError(`${key} must be positive and bounded`);
  if(name==="get_liquidation_bucket_screenshot"){if(input.price===undefined)throw new RangeError("price is required");if(input.price_end!==undefined&&Number(input.price_end)<=Number(input.price))throw new RangeError("price_end must exceed price");if(input.price_end!==undefined&&input.bucket_size!==undefined&&Math.abs(Number(input.price_end)-Number(input.price)-Number(input.bucket_size))>Math.max(1e-8,Number(input.bucket_size)*1e-10))throw new RangeError("bucket range must agree");}
  if(input.include_liquidations!==undefined&&typeof input.include_liquidations!=="boolean")throw new RangeError("include_liquidations must be boolean");
  return{...input};
}

function premarketArguments(input: number | PremarketRoundupQuery): Record<string, unknown> {
  return typeof input === "number" ? { limit: input } : { ...input };
}

function assertIsoDate(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${name} must be an exact YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} must be a valid YYYY-MM-DD date`);
  }
}

function assertArgumentObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("MCP tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(tool: string, input: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RangeError(`${tool} does not accept argument: ${unknown.join(", ")}`);
}

function normalizeString(name: string, value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new RangeError(`${name} must contain ${minimum} to ${maximum} characters`);
  }
  return normalized;
}

function assertOptionalInteger(name: string, value: unknown, minimum: number, maximum: number): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum)) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertOptionalOneOf(name: string, value: unknown, allowed: readonly unknown[]): void {
  if (value !== undefined && !allowed.includes(value)) {
    throw new RangeError(`${name} must be one of: ${allowed.join(", ")}`);
  }
}
