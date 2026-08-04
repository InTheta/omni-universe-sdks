import { buildUrl, mergeSignals, parseResponse, type QueryValue } from "./http.js";
import { OmniConfigurationError, OmniContractError } from "./errors.js";
import type {
  AskOmniRequest,
  NewsQuery,
  NewsWebSocketTicket,
  PublicNewsResponse,
} from "./types.js";

export interface OmniClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export class OmniClient {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly defaultHeaders: HeadersInit;

  constructor(options: OmniClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.omniterminal.app";
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive integer");
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.defaultHeaders = options.headers ?? {};
  }

  async request<T>(
    method: string,
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal; apiKey?: boolean } = {},
  ): Promise<T> {
    if (options.apiKey !== false && !this.apiKey) throw new OmniConfigurationError("An Omni API key is required for this route");
    const headers = new Headers(this.defaultHeaders);
    headers.set("accept", "application/json");
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.apiKey !== false && this.apiKey) headers.set("x-api-key", this.apiKey);

    const response = await this.fetcher(buildUrl(this.baseUrl, path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: mergeSignals(this.timeoutMs, options.signal),
    });
    return parseResponse<T>(response);
  }

  health(): Promise<{ status: string }> {
    return this.request("GET", "/health", { apiKey: false });
  }

  newsHealth(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/v1/news/health", { apiKey: false });
  }

  news(query: NewsQuery = {}): Promise<PublicNewsResponse> {
    const normalized = normalizeNewsQuery(query);
    return this.request<unknown>("GET", "/api/v1/news", { query: normalized })
      .then((data) => validatePublicNewsResponse("/api/v1/news", data));
  }

  newsForSymbol(symbol: string, query: NewsQuery = {}): Promise<PublicNewsResponse> {
    const normalizedSymbol = normalizeString("symbol", symbol, 1, 32);
    const normalized = normalizeNewsQuery(query);
    const path = `/api/v1/news/${encodeURIComponent(normalizedSymbol)}`;
    return this.request<unknown>("GET", path, { query: normalized })
      .then((data) => validatePublicNewsResponse(path, data));
  }

  createNewsWebSocketTicket(): Promise<NewsWebSocketTicket> {
    const path = "/api/v1/news/ws-ticket";
    return this.request<unknown>("POST", path).then((data) => validateNewsWebSocketTicket(path, data));
  }

  publicProfile(address: string): Promise<Record<string, unknown>> {
    assertEvmAddress(address);
    return this.request("GET", "/api/hl/public-profile", { query: { address }, apiKey: false });
  }

  builderFees(startTimestamp: number, endTimestamp: number, secret?: string): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(startTimestamp) || !Number.isSafeInteger(endTimestamp) || startTimestamp >= endTimestamp) {
      throw new RangeError("Builder fee timestamps must be unix seconds with startTimestamp < endTimestamp");
    }
    if (endTimestamp - startTimestamp > 366 * 24 * 60 * 60) throw new RangeError("Builder fee window cannot exceed 366 days");
    const headers = secret ? { "x-defillama-secret": secret } : undefined;
    const client = headers ? new OmniClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      timeoutMs: this.timeoutMs,
      fetch: this.fetcher,
      headers,
    }) : this;
    return client.request("GET", "/integrations/defillama/v1/builder-fees", {
      query: { startTimestamp, endTimestamp },
      apiKey: false,
    });
  }

  askOmni(input: AskOmniRequest): Promise<Record<string, unknown>> {
    validateAskOmniRequest(input);
    return this.request("POST", "/api/v1/ask-omni", { body: input });
  }
}

function normalizeNewsQuery(query: NewsQuery): Record<string, QueryValue> {
  if (query.object_version !== undefined && query.object_version !== "news_event.v1") throw new RangeError("object_version must be news_event.v1");
  assertOptionalInteger("limit", query.limit, 1, 2_000);
  assertOptionalInteger("lookback_days", query.lookback_days, 1, 30);
  if (query.before_timestamp !== undefined && (!Number.isSafeInteger(query.before_timestamp) || query.before_timestamp < 1_000_000_000_000 || query.before_timestamp > 9_999_999_999_999)) {
    throw new RangeError("before_timestamp must be a 13-digit Unix timestamp in milliseconds");
  }
  if (query.market !== undefined && query.market !== "crypto" && query.market !== "tradfi") throw new RangeError("market must be crypto or tradfi");
  const analysisType = query.analysis_type === undefined ? undefined : normalizeString("analysis_type", query.analysis_type, 1, 100);
  let topics: string | undefined;
  if (Array.isArray(query.topics)) {
    if (query.topics.length < 1 || query.topics.length > 20) throw new RangeError("topics must contain between 1 and 20 entries");
    topics = query.topics.map((topic, index) => normalizeString(`topics[${index}]`, topic, 1, 100)).join(",");
  } else if (query.topics !== undefined) {
    topics = normalizeString("topics", query.topics, 1, 2_000);
  }
  return {
    ...query,
    analysis_type: analysisType,
    topics,
  };
}

function validatePublicNewsResponse(route: string, data: unknown): PublicNewsResponse {
  const record = assertRecord(route, data);
  if (record.object !== "list" || typeof record.api_version !== "string" || (record.tier !== "pro" && record.tier !== "enterprise") || !Array.isArray(record.data)) {
    throw new OmniContractError(`Invalid News response contract for ${route}`, route, data);
  }
  const pagination = assertRecord(route, record.pagination);
  if (!Number.isInteger(pagination.limit) || typeof pagination.has_more !== "boolean") {
    throw new OmniContractError(`Invalid News pagination contract for ${route}`, route, data);
  }
  for (const event of record.data) {
    const item = assertRecord(route, event);
    if (item.object !== "news_event.v1" || typeof item.id !== "string" || typeof item.timestamp !== "number") {
      throw new OmniContractError(`Invalid News event contract for ${route}`, route, data);
    }
  }
  return record as unknown as PublicNewsResponse;
}

function validateNewsWebSocketTicket(route: string, data: unknown): NewsWebSocketTicket {
  const record = assertRecord(route, data);
  if (typeof record.ticket !== "string" || record.ticket.length !== 32 || record.expires_in !== 60 || record.single_use !== true || record.websocket_path !== "/ws/v1/news" || (record.max_connections !== 2 && record.max_connections !== 10) || record.idle_timeout_seconds !== 120 || record.recommended_ping_interval_seconds !== 60 || record.max_client_message_bytes !== 4096) {
    throw new OmniContractError(`Invalid News WebSocket ticket contract for ${route}`, route, data);
  }
  return record as unknown as NewsWebSocketTicket;
}

function validateAskOmniRequest(input: AskOmniRequest): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Ask Omni input must be an object");
  const question = input.question === undefined ? undefined : normalizeString("question", input.question, 1, 10_000);
  const preset = input.presetId === undefined ? undefined : normalizeString("presetId", input.presetId, 1, 100);
  if (!question && !preset) throw new RangeError("Ask Omni requires question or presetId");
  if (input.extraContext !== undefined) normalizeString("extraContext", input.extraContext, 1, 20_000);
  if (input.scopeAddress !== undefined) assertEvmAddress(input.scopeAddress);
  if (input.selectedSymbol !== undefined) normalizeString("selectedSymbol", input.selectedSymbol, 1, 32);
  if (input.liquidationScope !== undefined) normalizeString("liquidationScope", input.liquidationScope, 1, 32);
}

function assertRecord(route: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OmniContractError(`Invalid response contract for ${route}: expected an object`, route, value);
  return value as Record<string, unknown>;
}

function assertEvmAddress(value: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new RangeError("address must be a 20-byte EVM address");
}

function assertOptionalInteger(name: string, value: number | undefined, minimum: number, maximum: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < minimum || value > maximum)) throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
}

function normalizeString(name: string, value: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new RangeError(`${name} must contain ${minimum} to ${maximum} characters`);
  return normalized;
}
