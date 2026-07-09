"use client";

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

export async function fetchMe(): Promise<Me | null> {
  const { user } = await api<{ user: Me | null }>("/api/auth/me");
  return user;
}
