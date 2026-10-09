import { issuer, MCP_SCOPE, mcpResource } from "@/lib/auth/config";
import { json, preflight } from "@/lib/auth/http";

// RFC 9728 protected resource metadata, served at both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
export function GET(req: Request) {
  return json({
    resource: mcpResource(req),
    authorization_servers: [issuer(req)],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  });
}

export const OPTIONS = preflight;
