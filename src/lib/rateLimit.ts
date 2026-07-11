/**
 * Tiny in-memory fixed-window rate limiter. Adequate because the whole app
 * runs in a single custom-server process. For a multi-instance deployment,
 * back this with Redis instead.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client IP for rate-limit keys.
 *
 * The app runs behind a single trusted reverse proxy (Caddy/nginx — see the
 * deploy notes in README), which APPENDS the real peer to X-Forwarded-For. So
 * the *rightmost* entry is the one our infrastructure set and a client cannot
 * forge; the leftmost entry is attacker-controlled and must never key a limit.
 * `x-real-ip` (also proxy-set) is the fallback. If you front the app with more
 * than one proxy hop, adjust which entry is trusted accordingly.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Opportunistically evict expired buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref?.();
