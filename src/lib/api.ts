/**
 * Small helpers for App Router route handlers: JSON responses + auth guards.
 */
import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./auth";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "ابتدا وارد شوید");
  return s;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const s = await requireSession();
  if (s.role !== "admin") throw new HttpError(403, "دسترسی مدیر لازم است");
  return s;
}

/** Wrap a handler so thrown HttpError/Error become clean JSON responses. */
export function handler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((err) => {
    if (err instanceof HttpError) return error(err.message, err.status);
    // InvalidActionError (from the poker engine / game manager) is a client-
    // correctable rejection. It may be thrown by the esbuild-bundled game
    // manager whose class identity differs from this graph's, so match on the
    // stable `name` rather than `instanceof`.
    if (err instanceof Error && err.name === "InvalidActionError") return error(err.message, 409);
    // Log details server-side but never leak internals to the client.
    console.error("API error:", err);
    return error("خطای داخلی سرور", 500);
  });
}
