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
      if (response.ok) throw new OmniApiError("API returned invalid JSON", response.status, response, { cause: String(error) });
      body = null;
    }
  } else {
    body = await response.text().catch(() => "");
    if (response.ok) {
      throw new OmniApiError(`API returned an unexpected content type: ${contentType || "missing"}`, response.status, response, body);
    }
  }

  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body
      ? String((body as { detail: unknown }).detail)
      : body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : response.statusText;
    throw new OmniApiError(`Omni API ${response.status}: ${detail}`, response.status, response, body);
  }
  return body as T;
}

export function mergeSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
