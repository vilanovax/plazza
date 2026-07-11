/**
 * Tiny in-memory idempotency store. A sensitive command carries a client-
 * generated request id; the first time we see it we "claim" it and process the
 * command, and any retry with the same id is a no-op. Adequate because the whole
 * app runs in one custom-server process — back it with Redis for multi-instance.
 *
 * Bucket growth must be bounded by an upstream per-user throttle, since the
 * request id is client-controlled.
 */
interface Claim {
  expiresAt: number;
}

const claims = new Map<string, Claim>();

/**
 * Atomically claim `key`. Returns true the first time (caller should process the
 * command) and false for any subsequent call within `ttlMs` (a duplicate/retry).
 */
export function claimOnce(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const existing = claims.get(key);
  if (existing && existing.expiresAt > now) return false;
  claims.set(key, { expiresAt: now + ttlMs });
  return true;
}

/** Release a claim early — used to roll back when the command ultimately fails,
 *  so a genuine retry of a failed operation is allowed to proceed. */
export function releaseClaim(key: string): void {
  claims.delete(key);
}

// Opportunistically evict expired claims so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, c] of claims) if (c.expiresAt <= now) claims.delete(k);
}, 60_000).unref?.();
