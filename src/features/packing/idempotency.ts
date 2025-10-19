const TTL_MS = 5 * 60 * 1000;

export type PackingAction =
  | "pack"
  | "move"
  | "restore"
  | "ship"
  | "ship_from_manu";

function safeRandomId(): string {
  try {
    const crypto = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto;
    if (crypto?.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fall through to Math.random
  }
  return Math.random().toString(36).slice(2);
}

export function buildPendingKey(
  rowIndexRef: number | string,
  action: PackingAction,
): string {
  return `pending:${String(rowIndexRef)}:${action}`;
}

export function isExpired(nowMs: number, savedTs: number, ttlMs = TTL_MS): boolean {
  if (!Number.isFinite(savedTs)) return true;
  return nowMs - savedTs > ttlMs;
}

function readStoredId(key: string): { id: string; ts: number } | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; ts?: unknown };
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.ts === "number" &&
      !Number.isNaN(parsed.ts)
    ) {
      return { id: parsed.id, ts: parsed.ts };
    }
  } catch {
    // ignore malformed JSON / access issues
  }
  return null;
}

function persistId(key: string, id: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const payload = JSON.stringify({ id, ts: Date.now() });
    window.localStorage.setItem(key, payload);
  } catch {
    // ignore storage write issues
  }
}

export function getOrCreatePendingRequestId(
  rowIndexRef: number | string,
  action: PackingAction,
): string {
  const key = buildPendingKey(rowIndexRef, action);
  const stored = readStoredId(key);
  const now = Date.now();
  if (stored && !isExpired(now, stored.ts)) {
    return stored.id;
  }
  const id = safeRandomId();
  persistId(key, id);
  return id;
}

export function clearPendingRequestId(
  rowIndexRef: number | string,
  action: PackingAction,
): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(buildPendingKey(rowIndexRef, action));
  } catch {
    // ignore storage removal issues
  }
}
