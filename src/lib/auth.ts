/**
 * Session auth: signed JWT stored in an httpOnly cookie.
 * Used by both REST route handlers and the Socket.IO handshake.
 */
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Role } from "./models";

export const SESSION_COOKIE = "poker_session";
const ALG = "HS256";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  sub: string; // user id
  username: string;
  role: Role;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET must be set (>=16 chars)");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username, role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      sub: payload.sub as string,
      username: (payload.username as string) ?? "",
      role: (payload.role as Role) ?? "player",
    };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  };
}

/** Read the session in a route handler / server component. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** Parse a raw Cookie header and verify the session (for Socket.IO handshake). */
export async function sessionFromCookieHeader(header?: string): Promise<SessionPayload | null> {
  if (!header) return null;
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  let token: string;
  try {
    token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null; // malformed cookie value
  }
  return verifySession(token);
}
