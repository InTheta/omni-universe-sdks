import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402Client } from "@x402/core/client";
import { wrapMCPClientWithPayment, type PaymentRequestedContext, type SettleResponse, type x402MCPClient, type x402MCPToolCallResult } from "@x402/mcp";
import { OmniContractError } from "./errors.js";
import type { EntityResolution, MarketCarry, MarketRisk, NewsPulse } from "./types.js";
import { createEvmPaymentClient, DEFAULT_MAX_X402_PAYMENT_USD, validatePaymentSettlement } from "./x402.js";

export type OmniMcpToolName =
  | "get_market_catalog"
  | "get_market_moving_events"
  | "get_market_risk_context"
  | "resolve_market_entities"
  | "get_market_carry";

export const SDK_VERSION = "0.8.1";

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
  url?: string;
  privateKey?: `0x${string}`;
  maxPaymentUsd?: number;
  approvePayment?: (context: PaymentRequestedContext) => boolean | Promise<boolean>;
  headers?: HeadersInit;
  name?: string;
  version?: string;
}

export class OmniMcpClient {
  private readonly client: x402MCPClient;
  private readonly transport: StreamableHTTPClientTransport;

  constructor(options: OmniMcpClientOptions = {}) {
    const rawClient = new Client({
      name: options.name ?? "omni-sdk-agent",
      version: options.version ?? SDK_VERSION,
    });
    const paymentClient = options.privateKey
      ? createEvmPaymentClient(options.privateKey, { maxPaymentUsd: options.maxPaymentUsd ?? DEFAULT_MAX_X402_PAYMENT_USD })
      : new x402Client();
    this.client = wrapMCPClientWithPayment(rawClient, paymentClient, {
      autoPayment: true,
      onPaymentRequested: async (context) => {
        if (context.toolName === "get_market_catalog") {
          throw new OmniContractError("The free MCP catalog unexpectedly requested payment", "mcp:get_market_catalog", context.paymentRequired);
        }
        return options.approvePayment ? options.approvePayment(context) : false;
      },
    });
    this.transport = new StreamableHTTPClientTransport(
      new URL(options.url ?? "https://omniterminal.app/api/x402/mcp"),
      options.headers ? { requestInit: { headers: options.headers } } : undefined,
    );
  }

  async connect(): Promise<this> {
    await this.client.connect(this.transport);
    return this;
  }

  listTools() {
    return this.client.listTools();
  }

  async callTool(name: OmniMcpToolName, args: Record<string, unknown> = {}): Promise<x402MCPToolCallResult> {
    const result = await this.client.callTool(name, validateMcpToolArguments(name, args));
    validateMcpToolResult(name, result);
    return result;
  }

  async callJsonTool<T>(name: OmniMcpToolName, args: Record<string, unknown> = {}): Promise<OmniMcpDataResult<T>> {
    return parseMcpToolJson<T>(name, await this.callTool(name, args));
  }

  catalog(): Promise<x402MCPToolCallResult> {
    return this.callTool("get_market_catalog");
  }

  catalogData(): Promise<OmniMcpDataResult<OmniMcpMarketCatalog>> {
    return this.callJsonTool("get_market_catalog");
  }

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

  async close(): Promise<void> {
    await this.client.close();
  }
}

const mcpToolContracts: Record<OmniMcpToolName, { service: string; schema?: string; requiredCollection?: string }> = {
  get_market_catalog: { service: "omni-market-intelligence", requiredCollection: "tools" },
  get_market_moving_events: { service: "omni.ai_news_pulse", schema: "news_pulse.v1", requiredCollection: "items" },
  get_market_risk_context: { service: "omni.market_risk_snapshot", schema: "market_risk_snapshot.v1" },
  resolve_market_entities: { service: "omni.market_entity_resolution", schema: "market_entity_resolution.v1", requiredCollection: "results" },
  get_market_carry: { service: "omni.hyperliquid_market_carry", schema: "hyperliquid_market_carry.v1" },
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
  const paid = name !== "get_market_catalog";
  if (paid && record.paymentMade !== true) {
    throw new OmniContractError(`Paid MCP tool ${name} returned without payment`, route, result);
  }
  if (!paid && record.paymentMade !== false) {
    throw new OmniContractError(`Free MCP tool ${name} returned unexpected payment state`, route, result);
  }
  if (paid) validatePaymentSettlement(route, record.paymentResponse);
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
    case "get_market_catalog":
      assertOnlyKeys(name, input, []);
      return {};
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
    case "get_market_carry":
      assertOnlyKeys(name, input, ["symbol"]);
      return { symbol: normalizeString("symbol", input.symbol, 2, 15) };
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
