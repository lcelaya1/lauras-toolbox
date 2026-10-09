import { NextRequest, NextResponse } from "next/server";
import { issuer, TTL } from "@/lib/auth/config";
import { pkceS256, randomToken } from "@/lib/auth/crypto";
import { COOKIE, setSignedCookie } from "@/lib/auth/session";
import { isWorkspaceAccount } from "@/lib/mail/common";
import { gmailAuthUrl } from "@/lib/mail/google";

export interface MailOauthState { state: string; verifier: string; account: string }

// Starts the Gmail (read-only) connection for one of the allowed Workspace accounts.
// Protected by proxy.ts: only a signed-in Toolbox user gets here.
export function GET(req: NextRequest) {
  const account = (req.nextUrl.searchParams.get("account") ?? "").trim().toLowerCase();
  if (!isWorkspaceAccount(account)) {
    return NextResponse.redirect(new URL("/mail?error=unknown_account", req.nextUrl));
  }
  const pending: MailOauthState = { state: randomToken(), verifier: randomToken(48), account };
  const res = NextResponse.redirect(gmailAuthUrl({
    redirectUri: `${issuer(req)}/api/mail/oauth/callback`,
    state: pending.state,
    codeChallenge: pkceS256(pending.verifier),
    loginHint: account,
  }));
  setSignedCookie(res, COOKIE.mailOauth, pending, TTL.pendingRequest);
  return res;
}
