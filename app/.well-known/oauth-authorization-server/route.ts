import { issuer, MCP_SCOPE } from "@/lib/auth/config";
import { json, preflight } from "@/lib/auth/http";

// RFC 8414 authorization server metadata.
export function GET(req: Request) {
  const iss = issuer(req);
  return json({
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
  });
}

export const OPTIONS = preflight;
