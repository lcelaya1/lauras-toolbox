import { NextRequest, NextResponse } from "next/server";
import { issuer } from "@/lib/auth/config";
import { safeEqual } from "@/lib/auth/crypto";
import { clearCookie, COOKIE, readSignedCookie } from "@/lib/auth/session";
import { isWorkspaceAccount } from "@/lib/mail/common";
import { exchangeGmailCode, gmailProfileEmail, GMAIL_SCOPE } from "@/lib/mail/google";
import { saveRefreshToken } from "@/lib/mail/store";
import type { MailOauthState } from "../start/route";

function back(req: NextRequest, params: Record<string, string>) {
  const res = NextResponse.redirect(new URL(`/mail?${new URLSearchParams(params)}`, req.nextUrl));
  clearCookie(res, COOKIE.mailOauth);
  return res;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const pending = readSignedCookie<MailOauthState>(req, COOKIE.mailOauth);
  if (!pending || !safeEqual(q.get("state") ?? "", pending.state)) return back(req, { error: "invalid_state" });
  if (q.get("error")) return back(req, { error: "cancelled", account: pending.account });
  const code = q.get("code");
  if (!code) return back(req, { error: "missing_code", account: pending.account });

  try {
    const tokens = await exchangeGmailCode({
      code, redirectUri: `${issuer(req)}/api/mail/oauth/callback`, codeVerifier: pending.verifier,
    });
    const scopes = tokens.scope.split(" ").filter(Boolean);
    if (!scopes.includes(GMAIL_SCOPE)) return back(req, { error: "scope_missing", account: pending.account });

    // The authorized mailbox must be exactly the account that was clicked, and on the allowlist.
    const email = await gmailProfileEmail(tokens.accessToken);
    if (email !== pending.account || !isWorkspaceAccount(email)) {
      return back(req, { error: "wrong_account", account: pending.account, got: email });
    }
    if (!tokens.refreshToken) return back(req, { error: "no_refresh_token", account: email });

    await saveRefreshToken(email, tokens.refreshToken);
    return back(req, { connected: email });
  } catch (e) {
    console.error("Gmail connection failed:", e instanceof Error ? e.message : "unknown error");
    return back(req, { error: "exchange_failed", account: pending.account });
  }
}
