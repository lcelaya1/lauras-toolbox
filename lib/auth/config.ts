import { getPublicOrigin } from "mcp-handler";

// Google accounts allowed to sign in to the Toolbox (and approve MCP clients).
const DEFAULT_ALLOWED_EMAILS = ["laura.celaya@teamlabs.es", "lauracelayabarenys@gmail.com"];

export function allowedEmails(): string[] {
  const raw = process.env.AUTH_ALLOWED_EMAILS;
  const list = raw ? raw.split(",") : DEFAULT_ALLOWED_EMAILS;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: string): boolean {
  return allowedEmails().includes(email.trim().toLowerCase());
}

export const MCP_SCOPE = "mcp";

export const TTL = {
  authCode: 60,                       // seconds
  accessToken: 60 * 60,               // 1 hour
  refreshToken: 60 * 60 * 24 * 60,    // 60 days, renewed on every refresh
  session: 60 * 60 * 24 * 7,          // web session cookie
  pendingRequest: 60 * 10,            // authorize → login → consent round trip
};

// Public origin of the app. Set APP_URL in production so the issuer is stable.
export function issuer(req: Request): string {
  return (process.env.APP_URL ?? getPublicOrigin(req)).replace(/\/$/, "");
}

export function mcpResource(req: Request): string {
  return `${issuer(req)}/api/mcp`;
}

// Redirect URIs that dynamically registered MCP clients may use:
// claude.ai / claude.com connectors, and loopback callbacks (mcp-remote, Claude Code).
const ALLOWED_REDIRECT_URIS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export function isAllowedRedirectUri(uri: string): boolean {
  if (ALLOWED_REDIRECT_URIS.has(uri)) return true;
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.hash) return false;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
