import { isAllowedEmail } from "@/lib/auth/config";
import { json, oauthError, preflight, readParams } from "@/lib/auth/http";
import { consumeAuthCode, issueTokens, rotateRefreshToken } from "@/lib/auth/store";

export async function POST(req: Request) {
  const p = await readParams(req);
  const clientId = p.get("client_id") ?? "";
  if (!clientId) return oauthError("invalid_client", "client_id is required", 401);

  switch (p.get("grant_type")) {
    case "authorization_code": {
      const code = p.get("code");
      const redirectUri = p.get("redirect_uri");
      const codeVerifier = p.get("code_verifier");
      if (!code || !redirectUri || !codeVerifier) {
        return oauthError("invalid_request", "code, redirect_uri and code_verifier are required");
      }
      const grant = await consumeAuthCode({ code, clientId, redirectUri, codeVerifier });
      if (!grant || !isAllowedEmail(grant.email)) return oauthError("invalid_grant", "Invalid or expired code");
      return json(await issueTokens({ clientId, email: grant.email, resource: grant.resource }));
    }

    case "refresh_token": {
      const refreshToken = p.get("refresh_token");
      if (!refreshToken) return oauthError("invalid_request", "refresh_token is required");
      const grant = await rotateRefreshToken(refreshToken, clientId);
      if (!grant || !isAllowedEmail(grant.email)) return oauthError("invalid_grant", "Invalid or expired refresh token");
      return json(await issueTokens({ clientId, email: grant.email, resource: grant.resource, familyId: grant.familyId }));
    }

    default:
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
}

export const OPTIONS = preflight;
