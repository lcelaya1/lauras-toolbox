import type { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail, TTL } from "./config";
import { sign, verify } from "./crypto";

export const COOKIE = {
  session: "lt_session",   // signed-in Google user
  google: "lt_google",     // in-flight Google login (state, nonce, PKCE verifier)
  authz: "lt_authz",       // in-flight MCP authorization request
  mailOauth: "lt_mail_oauth", // in-flight Gmail account connection (state, PKCE verifier, account)
};

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export function setSignedCookie(res: NextResponse, name: string, payload: object, ttl: number) {
  res.cookies.set(name, sign(payload, ttl), cookieOptions(ttl));
}

export function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", cookieOptions(0));
}

export function readSignedCookie<T>(req: NextRequest, name: string): T | null {
  return verify<T>(req.cookies.get(name)?.value);
}

export interface Session { email: string }

export function getSession(req: NextRequest): Session | null {
  const s = readSignedCookie<Session>(req, COOKIE.session);
  // Re-check the allowlist so removing an email takes effect immediately.
  return s && isAllowedEmail(s.email) ? s : null;
}

export function setSession(res: NextResponse, email: string) {
  setSignedCookie(res, COOKIE.session, { email }, TTL.session);
}

// Only allow same-origin relative paths as post-login destinations.
export function safeNextPath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

// MCP authorization request carried through Google login to the consent page.
export interface PendingAuthorization {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  csrf: string;
}
