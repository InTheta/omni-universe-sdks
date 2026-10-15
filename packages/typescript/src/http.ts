import { OmniApiError } from "./errors.js";

export type QueryValue = string | number | boolean | null | undefined | readonly string[];

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  let body: unknown;
  if (contentType.includes("json")) {
    try {
      body = await response.json();
    } catch (error) {
      if (response.ok) throw new OmniApiError("API returned invalid JSON", response.status, response, undefined);
      body = null;
    }
  } else {
    body = await response.text().catch(() => "");
    if (response.ok) {
      throw new OmniApiError("API returned an unexpected content type", response.status, response, body);
    }
  }

  if (!response.ok) {
    // Never echo an untrusted body/statusText: it may contain a payment proof or token.
    const reasons: Record<number, string> = {
      400: "invalid request", 401: "authentication required", 402: "payment required",
      403: "permission denied", 404: "resource not found", 409: "request conflict",
      422: "request validation failed", 429: "rate limited", 500: "server error",
      502: "upstream error", 503: "service unavailable", 504: "upstream timeout",
    };
    throw new OmniApiError(`Omni API ${response.status}: ${reasons[response.status] ?? "request failed"}`, response.status, response, body);
  }
  return body as T;
}

export function mergeSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
