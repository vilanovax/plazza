/**
 * Tiny in-memory idempotency store with result caching. A sensitive command
 * carries a client-generated request id:
 *   - the FIRST call claims the key and processes the command, then records its
 *     result;
 *   - a retry that arrives AFTER completion gets the cached result back (so the
 *     caller can re-send the authoritative outcome instead of a bare
 *     "duplicate");
 *   - a retry that races the original while it is still in flight is told to
 *     drop, because the original will emit the outcome.
 *
 * Adequate because the whole app runs in one custom-server process (claim() is
 * synchronous, so it's atomic under Node's single thread) — back it with Redis
 * for multi-instance. Bucket growth must be bounded by an upstream per-user
 * throttle, since the request id is client-controlled.
 */
interface Entry<T> {
  expiresAt: number;
  hasResult: boolean;
  result?: T;
}

const store = new Map<string, Entry<unknown>>();

export type ClaimState<T> =
  | { state: "new" } // caller owns it and must process the command
  | { state: "in_flight" } // another call is processing; caller should drop
  | { state: "done"; result: T }; // already completed; caller returns cached result

/** Atomically claim `key`, or report that it is in flight / already done. */
export function claim<T>(key: string, ttlMs: number): ClaimState<T> {
  const now = Date.now();
  const e = store.get(key) as Entry<T> | undefined;
  if (e && e.expiresAt > now) {
    return e.hasResult ? { state: "done", result: e.result as T } : { state: "in_flight" };
  }
  store.set(key, { expiresAt: now + ttlMs, hasResult: false });
  return { state: "new" };
}

/** Record the result for a claimed key so retries can read it back. */
export function recordResult<T>(key: string, result: T, ttlMs: number): void {
  store.set(key, { expiresAt: Date.now() + ttlMs, hasResult: true, result });
}

/** Release a claim (command failed) so a genuine retry is allowed to proceed. */
export function releaseClaim(key: string): void {
  store.delete(key);
}

// Opportunistically evict expired entries so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of store) if (e.expiresAt <= now) store.delete(k);
}, 60_000).unref?.();
