import { createClient, type Client } from "@libsql/client";
import { MCP_SCOPE, TTL } from "./config";
import { pkceS256, randomToken, safeEqual, sha256 } from "./crypto";

// OAuth state for the MCP endpoint. Codes and tokens are stored only as SHA-256 hashes.

let client: Client | null = null;
let ready: Promise<void> | null = null;

function db(): Client {
  client ??= createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  return client;
}

async function init(): Promise<Client> {
  ready ??= db().executeMultiple(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL DEFAULT '',
      redirect_uris TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      resource TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
      family_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      email TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens (family_id);
  `).catch((e) => { ready = null; throw e; });
  await ready;
  return db();
}

const now = () => Math.floor(Date.now() / 1000);

// ── Clients ──────────────────────────────────────────────────────────────

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export async function registerClient(clientName: string, redirectUris: string[]): Promise<OAuthClient> {
  const c = await init();
  const client: OAuthClient = { clientId: randomToken(16), clientName, redirectUris, createdAt: now() };
  await c.execute({
    sql: "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
    args: [client.clientId, clientName, JSON.stringify(redirectUris), client.createdAt],
  });
  return client;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const c = await init();
  const { rows } = await c.execute({ sql: "SELECT * FROM oauth_clients WHERE client_id = ?", args: [clientId] });
  const r = rows[0];
  if (!r) return null;
  return {
    clientId: String(r.client_id),
    clientName: String(r.client_name),
    redirectUris: JSON.parse(String(r.redirect_uris)),
    createdAt: Number(r.created_at),
  };
}

// ── Authorization codes ──────────────────────────────────────────────────

export async function createAuthCode(p: {
  clientId: string; redirectUri: string; codeChallenge: string; resource: string; email: string;
}): Promise<string> {
  const c = await init();
  const code = randomToken();
  await c.execute({
    sql: `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, resource, email, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [sha256(code), p.clientId, p.redirectUri, p.codeChallenge, p.resource, p.email, now() + TTL.authCode],
  });
  return code;
}

// Atomically consumes a code. Returns null for any mismatch, expiry or reuse.
export async function consumeAuthCode(p: {
  code: string; clientId: string; redirectUri: string; codeVerifier: string;
}): Promise<{ email: string; resource: string } | null> {
  const c = await init();
  const hash = sha256(p.code);
  const claimed = await c.execute({
    sql: "UPDATE oauth_codes SET used = 1 WHERE code_hash = ? AND used = 0 AND expires_at > ?",
    args: [hash, now()],
  });
  if (claimed.rowsAffected !== 1) return null;
  const { rows } = await c.execute({ sql: "SELECT * FROM oauth_codes WHERE code_hash = ?", args: [hash] });
  const r = rows[0];
  if (!r) return null;
  if (String(r.client_id) !== p.clientId || String(r.redirect_uri) !== p.redirectUri) return null;
  if (!safeEqual(pkceS256(p.codeVerifier), String(r.code_challenge))) return null;
  return { email: String(r.email), resource: String(r.resource) };
}

// ── Tokens ───────────────────────────────────────────────────────────────

export interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function issueTokens(p: {
  clientId: string; email: string; resource: string; familyId?: string;
}): Promise<TokenPair> {
  const c = await init();
  const access = randomToken();
  const refresh = randomToken();
  const familyId = p.familyId ?? randomToken(16);
  const t = now();
  const insert = `INSERT INTO oauth_tokens (token_hash, kind, family_id, client_id, email, resource, expires_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  await c.batch([
    { sql: insert, args: [sha256(access), "access", familyId, p.clientId, p.email, p.resource, t + TTL.accessToken, t] },
    { sql: insert, args: [sha256(refresh), "refresh", familyId, p.clientId, p.email, p.resource, t + TTL.refreshToken, t] },
    // Housekeeping: drop expired rows.
    { sql: "DELETE FROM oauth_tokens WHERE expires_at < ?", args: [t] },
    { sql: "DELETE FROM oauth_codes WHERE expires_at < ?", args: [t] },
  ], "write");
  return { access_token: access, token_type: "Bearer", expires_in: TTL.accessToken, refresh_token: refresh, scope: MCP_SCOPE };
}

// Rotates a refresh token. Presenting an already-used refresh token revokes the whole family.
export async function rotateRefreshToken(refreshToken: string, clientId: string): Promise<
  { email: string; resource: string; familyId: string } | null
> {
  const c = await init();
  const hash = sha256(refreshToken);
  const { rows } = await c.execute({
    sql: "SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'",
    args: [hash],
  });
  const r = rows[0];
  if (!r || String(r.client_id) !== clientId) return null;
  const familyId = String(r.family_id);
  if (Number(r.revoked) === 1) {
    await revokeFamily(familyId);
    return null;
  }
  if (Number(r.expires_at) < now()) return null;
  const claimed = await c.execute({
    sql: "UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ? AND revoked = 0",
    args: [hash],
  });
  if (claimed.rowsAffected !== 1) {
    await revokeFamily(familyId);
    return null;
  }
  // Old access tokens of this family stop working as soon as a new pair is issued.
  await c.execute({
    sql: "UPDATE oauth_tokens SET revoked = 1 WHERE family_id = ? AND kind = 'access'",
    args: [familyId],
  });
  return { email: String(r.email), resource: String(r.resource), familyId };
}

export async function verifyAccessToken(token: string, resource: string): Promise<
  { email: string; clientId: string; expiresAt: number } | null
> {
  const c = await init();
  const { rows } = await c.execute({
    sql: `SELECT * FROM oauth_tokens
          WHERE token_hash = ? AND kind = 'access' AND revoked = 0 AND expires_at > ?`,
    args: [sha256(token), now()],
  });
  const r = rows[0];
  if (!r || String(r.resource) !== resource) return null;
  return { email: String(r.email), clientId: String(r.client_id), expiresAt: Number(r.expires_at) };
}

export async function revokeToken(token: string): Promise<void> {
  const c = await init();
  const { rows } = await c.execute({
    sql: "SELECT family_id FROM oauth_tokens WHERE token_hash = ?",
    args: [sha256(token)],
  });
  if (rows[0]) await revokeFamily(String(rows[0].family_id));
}

async function revokeFamily(familyId: string): Promise<void> {
  const c = await init();
  await c.execute({ sql: "UPDATE oauth_tokens SET revoked = 1 WHERE family_id = ?", args: [familyId] });
}
