import { NextRequest, NextResponse } from "next/server";
import { issuer, TTL } from "@/lib/auth/config";
import { pkceS256, randomToken } from "@/lib/auth/crypto";
import { googleAuthUrl, type GoogleLoginState } from "@/lib/auth/google";
import { COOKIE, safeNextPath, setSignedCookie } from "@/lib/auth/session";

export function GET(req: NextRequest) {
  const login: GoogleLoginState = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    next: safeNextPath(req.nextUrl.searchParams.get("next")),
  };
  const res = NextResponse.redirect(googleAuthUrl({
    redirectUri: `${issuer(req)}/api/auth/google/callback`,
    state: login.state,
    nonce: login.nonce,
    codeChallenge: pkceS256(login.verifier),
  }));
  setSignedCookie(res, COOKIE.google, login, TTL.pendingRequest);
  return res;
}
