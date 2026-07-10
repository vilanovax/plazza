"use client";

const ME_TTL_MS = 30_000;

let meCache: { value: Me | null; at: number } | null = null;
let meInflight: Promise<Me | null> | null = null;

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "خطا");
  return data as T;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "player";
  chipBalance: number;
}

/** Drop cached session user (after login/logout/balance-changing actions). */
export function invalidateMeCache(): void {
  meCache = null;
}

export async function fetchMe(options?: { fresh?: boolean }): Promise<Me | null> {
  if (options?.fresh) invalidateMeCache();
  if (meCache && Date.now() - meCache.at < ME_TTL_MS) return meCache.value;
  if (meInflight) return meInflight;

  meInflight = api<{ user: Me | null }>("/api/auth/me")
    .then(({ user }) => {
      meCache = { value: user, at: Date.now() };
      return user;
    })
    .finally(() => {
      meInflight = null;
    });

  return meInflight;
}
