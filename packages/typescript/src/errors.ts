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

const PUBLIC_ERROR_CODES = new Set([
  "insufficient_funds", "invalid_exact_evm_payload_authorization_valid_after",
  "invalid_exact_evm_payload_authorization_valid_before", "invalid_exact_evm_payload_authorization_value_mismatch",
  "invalid_exact_evm_payload_signature", "invalid_exact_evm_payload_recipient_mismatch", "invalid_network",
  "invalid_payload", "invalid_payment_requirements", "invalid_scheme", "unsupported_scheme", "invalid_x402_version",
  "invalid_transaction_state", "unexpected_verify_error", "unexpected_settle_error", "invalid_request",
  "upstream_unavailable", "merchant_metrics_unavailable", "rate_limited", "forbidden", "unauthorized", "not_found",
]);
function safeErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "HTTP_ERROR";
  const record = body as Record<string, unknown>;
  for (const candidate of [record.code, record.error, record.detail]) {
    if (typeof candidate === "string" && PUBLIC_ERROR_CODES.has(candidate)) return candidate;
  }
  return "HTTP_ERROR";
}

export class OmniApiError extends Error {
  /** Present only after a paid response fails processing; reconcile before another authorization. */
  declare readonly requiresReconciliation?: true;
  declare readonly retryable?: false;
  declare readonly paymentOutcome?: "unconfirmed";
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly retryAfter: string | null;
  readonly details: unknown;

  constructor(message: string, status: number, response: Response, _details: unknown) {
    super(message);
    this.name = "OmniApiError";
    this.status = status;
    this.code = safeErrorCode(_details);
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
  /** Present only after a paid response fails processing; reconcile before another authorization. */
  declare readonly requiresReconciliation?: true;
  declare readonly retryable?: false;
  declare readonly paymentOutcome?: "unconfirmed";
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

/** A failed paid transport is never automatically safe to retry with a new authorization. */
export class OmniPaymentError extends Error {
  readonly requiresReconciliation = true;
  readonly retryable = false;
  constructor(readonly code: "PAYMENT_BUDGET_EXCEEDED" | "PAYMENT_AUTHORIZATION_LIMIT" | "PAYMENT_OUTCOME_UNKNOWN", kind?: "AbortError" | "TimeoutError") {
    super(code === "PAYMENT_BUDGET_EXCEEDED" ? "Aggregate payment authorization budget exceeded; reconcile before any new payment"
      : code === "PAYMENT_AUTHORIZATION_LIMIT" ? "Payment authorization limit reached; reconcile before any new payment"
      : "Paid request failed; payment outcome is unconfirmed. Reconcile before any new paid attempt.");
    this.name = kind ?? "OmniPaymentError";
  }
}
