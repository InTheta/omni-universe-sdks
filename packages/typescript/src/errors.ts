export class OmniApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  readonly details: unknown;

  constructor(message: string, status: number, response: Response, details: unknown) {
    super(message);
    this.name = "OmniApiError";
    this.status = status;
    this.requestId = response.headers.get("x-request-id");
    this.retryAfter = response.headers.get("retry-after");
    this.details = details;
  }
}

export class OmniConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmniConfigurationError";
  }
}

export class OmniContractError extends Error {
  readonly route: string;
  readonly details: unknown;

  constructor(message: string, route: string, details?: unknown) {
    super(message);
    this.name = "OmniContractError";
    this.route = route;
    this.details = details;
  }
}

export class TradingGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingGateError";
  }
}
