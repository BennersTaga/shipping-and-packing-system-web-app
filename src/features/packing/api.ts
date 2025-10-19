export const API_ENDPOINTS = {
  SEARCH_PACKING: "/api/packing/search",
  UPDATE_PACKING: "/api/packing/update",
} as const;

export interface FetchRetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayBaseMs?: number;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffDelay(base: number, attempt: number): number {
  const raw = base * 2 ** attempt;
  const jitter = raw * 0.2;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, raw + offset);
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: FetchRetryOptions = {},
): Promise<Response> {
  const { timeoutMs = 60_000, maxRetries = 2, retryDelayBaseMs = 1_000 } = retryOptions;
  const { signal: externalSignal, ...restOptions } = options;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const { signal } = controller;
    let abortListener: (() => void) | null = null;

    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      abortListener = () => controller.abort();
      externalSignal.addEventListener("abort", abortListener, { once: true });
    }

    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...restOptions, signal });
      clearTimeout(timer);
      if (abortListener && externalSignal) {
        externalSignal.removeEventListener("abort", abortListener);
      }

      let dedup = false;
      try {
        const cloned = response.clone();
        const data = await cloned.json();
        if (data && typeof data === "object" && (data as any).dedup) {
          dedup = true;
        }
      } catch {
        // ignore JSON parse issues
      }

      if (response.ok || dedup) {
        return response;
      }

      lastError = new Error(response.statusText || `HTTP ${response.status}`);
      if (attempt === maxRetries) {
        throw lastError;
      }
    } catch (error) {
      clearTimeout(timer);
      if (abortListener && externalSignal) {
        externalSignal.removeEventListener("abort", abortListener);
      }

      lastError = error;
      const err = error as Error;
      const isAbort = err?.name === "AbortError";
      const isRetryable = isAbort || err instanceof TypeError;

      if (!isRetryable) {
        throw err;
      }

      if (attempt === maxRetries) {
        throw err;
      }
    }

    if (attempt < maxRetries) {
      const waitMs = computeBackoffDelay(retryDelayBaseMs, attempt);
      await delay(waitMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("fetchWithRetry failed");
}
