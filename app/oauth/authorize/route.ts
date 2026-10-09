import { NextRequest, NextResponse } from "next/server";
import { issuer, mcpResource, TTL } from "@/lib/auth/config";
import { randomToken } from "@/lib/auth/crypto";
import { escapeHtml } from "@/lib/auth/http";
import { COOKIE, getSession, setSignedCookie, type PendingAuthorization } from "@/lib/auth/session";
import { getClient } from "@/lib/auth/store";

function errorPage(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>
     <body style="font-family:system-ui;padding:3rem;color:#111"><h1>Authorization error</h1><p>${escapeHtml(message)}</p></body>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";

  // Until client and redirect URI are validated, never redirect anywhere.
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return errorPage("Unknown client.");
  if (!client.redirectUris.includes(redirectUri)) return errorPage("Redirect URI does not match this client.");

  const state = q.get("state");
  const fail = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    url.searchParams.set("iss", issuer(req));
    return NextResponse.redirect(url);
  };

  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const codeChallenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const resource = mcpResource(req);
  const requested = q.get("resource");
  if (requested && requested.replace(/\/$/, "") !== resource) return fail("invalid_target", "Unknown resource");

  const pending: PendingAuthorization = {
    clientId, clientName: client.clientName, redirectUri, state, codeChallenge, resource, csrf: randomToken(16),
  };

  const next = getSession(req)
    ? new URL("/oauth/consent", req.nextUrl)
    : new URL(`/api/auth/google/login?next=${encodeURIComponent("/oauth/consent")}`, req.nextUrl);
  const res = NextResponse.redirect(next);
  setSignedCookie(res, COOKIE.authz, pending, TTL.pendingRequest);
  return res;
}
