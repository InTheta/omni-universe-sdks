/** Error metadata is deliberately allowlisted: untrusted response bodies can echo credentials. */
function safeRequestId(value: string | null): string | null {
  if (!value) return null;
  return /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|req[-_][a-z0-9-]{1,48})$/i.test(value) ? value : null;
}
function safeRetryAfter(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{1,6}$/.test(value)) return value;
  return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

export class OmniApiError extends Error {
  readonly code = "HTTP_ERROR";
  readonly status: number;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  readonly details: unknown;

  constructor(message: string, status: number, response: Response, _details: unknown) {
    super(message);
    this.name = "OmniApiError";
    this.status = status;
    this.requestId = safeRequestId(response.headers.get("x-request-id"));
    this.retryAfter = safeRetryAfter(response.headers.get("retry-after"));
    this.details = { code: this.code, status, responseBodyRedacted: true };
  }
}

export class OmniConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmniConfigurationError";
  }
}

export class OmniContractError extends Error {
  readonly code = "INVALID_RESPONSE_CONTRACT";
  readonly route: string;
  readonly details: unknown;

  constructor(message: string, route: string, _details?: unknown) {
    super(message);
    this.name = "OmniContractError";
    this.route = route;
    this.details = { code: this.code, responseBodyRedacted: true };
  }
}

export class TradingGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingGateError";
  }
}
