import { isAllowedRedirectUri } from "@/lib/auth/config";
import { json, oauthError, preflight } from "@/lib/auth/http";
import { registerClient } from "@/lib/auth/store";

// RFC 7591 dynamic client registration. Public clients only (PKCE, no client secret),
// and only redirect URIs on the allowlist (claude.ai connectors and loopback).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown;
  } | null;
  if (!body) return oauthError("invalid_client_metadata", "Body must be JSON");

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every((u) => typeof u === "string")) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be 1–5 strings");
  }
  const rejected = uris.filter((u) => !isAllowedRedirectUri(u));
  if (rejected.length) return oauthError("invalid_redirect_uri", "Redirect URI not allowed");

  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
    return oauthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method=none) are supported");
  }

  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : "";
  const client = await registerClient(name, uris);

  return json({
    client_id: client.clientId,
    client_id_issued_at: client.createdAt,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }, 201);
}

export const OPTIONS = preflight;
