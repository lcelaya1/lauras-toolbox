import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import type { AccountStatus } from "./common";

// Gmail refresh tokens for the Workspace accounts, encrypted with AES-256-GCM.
// Stored value: base64(iv[12] | tag[16] | ciphertext); the account email is bound in as AAD,
// so a ciphertext copied onto another account's row fails to decrypt. Tokens are never logged.

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
  ready ??= db().execute(`
    CREATE TABLE IF NOT EXISTS mail_accounts (
      email TEXT PRIMARY KEY,
      refresh_token_enc TEXT,
      status TEXT NOT NULL,
      last_error TEXT,
      connected_at TEXT,
      updated_at TEXT NOT NULL
    )
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  await ready;
  return db();
}

function key(): Buffer {
  const k = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptToken(token: string, email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(email));
  const ct = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptToken(value: string, email: string): string {
  const buf = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(email));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export interface StoredAccount {
  email: string;
  status: AccountStatus;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string;
  hasToken: boolean;
}

export async function listStoredAccounts(): Promise<Map<string, StoredAccount>> {
  const c = await init();
  const { rows } = await c.execute("SELECT email, status, last_error, connected_at, updated_at, refresh_token_enc IS NOT NULL AS has_token FROM mail_accounts");
  return new Map(rows.map((r) => [String(r.email), {
    email: String(r.email),
    status: String(r.status) as AccountStatus,
    lastError: r.last_error == null ? null : String(r.last_error),
    connectedAt: r.connected_at == null ? null : String(r.connected_at),
    updatedAt: String(r.updated_at),
    hasToken: Number(r.has_token) === 1,
  }]));
}

export async function getRefreshToken(email: string): Promise<string | null> {
  const c = await init();
  const { rows } = await c.execute({ sql: "SELECT refresh_token_enc FROM mail_accounts WHERE email = ?", args: [email] });
  const enc = rows[0]?.refresh_token_enc;
  return enc ? decryptToken(String(enc), email) : null;
}

export async function saveRefreshToken(email: string, refreshToken: string): Promise<void> {
  const c = await init();
  const now = new Date().toISOString();
  await c.execute({
    sql: `INSERT INTO mail_accounts (email, refresh_token_enc, status, last_error, connected_at, updated_at)
          VALUES (?, ?, 'connected', NULL, ?, ?)
          ON CONFLICT(email) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc, status = 'connected',
            last_error = NULL, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
    args: [email, encryptToken(refreshToken, email), now, now],
  });
}

export async function setAccountStatus(email: string, status: AccountStatus, error: string | null): Promise<void> {
  const c = await init();
  await c.execute({
    sql: "UPDATE mail_accounts SET status = ?, last_error = ?, updated_at = ? WHERE email = ?",
    args: [status, error?.slice(0, 300) ?? null, new Date().toISOString(), email],
  });
}

export async function deleteAccount(email: string): Promise<void> {
  const c = await init();
  await c.execute({ sql: "DELETE FROM mail_accounts WHERE email = ?", args: [email] });
}
