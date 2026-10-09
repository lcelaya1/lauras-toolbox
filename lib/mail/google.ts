import { convert } from "html-to-text";
import {
  cleanText, isAutomated, LIMITS, mapLimit, parseAddressList, stripQuoted,
  type Address, type MessageMeta, type ThreadMessage, type ThreadMeta,
} from "./common";
import { getRefreshToken, setAccountStatus } from "./store";

// Gmail API (read-only scope) for the Workspace accounts. Uses the Internal project's OAuth client.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function credentials() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  return { id, secret };
}

export class ReconnectNeeded extends Error {}

// ── OAuth ────────────────────────────────────────────────────────────────

export function gmailAuthUrl(p: { redirectUri: string; state: string; codeChallenge: string; loginHint: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: credentials().id,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    login_hint: p.loginHint,
  }).toString();
  return url.toString();
}

export async function exchangeGmailCode(p: { code: string; redirectUri: string; codeVerifier: string }): Promise<{
  accessToken: string; refreshToken: string | null; scope: string;
}> {
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.code, client_id: id, client_secret: secret, redirect_uri: p.redirectUri,
      grant_type: "authorization_code", code_verifier: p.codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const j = await res.json() as { access_token: string; refresh_token?: string; scope?: string };
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, scope: j.scope ?? "" };
}

export async function gmailProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail profile request failed (${res.status})`);
  const j = await res.json() as { emailAddress?: string };
  if (!j.emailAddress) throw new Error("Gmail profile has no email address");
  return j.emailAddress.toLowerCase();
}

// Access tokens are cached per serverless instance; refresh tokens stay encrypted in Turso.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export async function accessTokenFor(account: string): Promise<string> {
  const cached = accessTokens.get(account);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = await getRefreshToken(account);
  if (!refreshToken) throw new ReconnectNeeded("Not connected");
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    if (err.error === "invalid_grant") {
      await setAccountStatus(account, "needs_reconnect", "Google revoked or expired the authorization");
      throw new ReconnectNeeded("Authorization expired or revoked — reconnect this account");
    }
    throw new Error(`Token refresh failed (${res.status}${err.error ? `: ${err.error}` : ""})`);
  }
  const j = await res.json() as { access_token: string; expires_in: number };
  accessTokens.set(account, { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

// ── Reading (GET requests only) ──────────────────────────────────────────

async function gmailGet<T>(account: string, path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) url.searchParams.append(k, x);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessTokenFor(account)}` } });
  if (res.status === 401) {
    accessTokens.delete(account);
    throw new ReconnectNeeded("Gmail rejected the access token — reconnect this account");
  }
  if (!res.ok) throw new Error(`Gmail API ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

interface GmailHeader { name: string; value: string }
interface GmailPart { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailPart[] }
interface GmailMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart }

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date", "List-Unsubscribe", "Auto-Submitted", "Precedence", "Content-Type"];

function headerGetter(part?: GmailPart) {
  const map = new Map((part?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  return (name: string) => map.get(name.toLowerCase());
}

function toMeta(account: string, m: GmailMessage): MessageMeta {
  const h = headerGetter(m.payload);
  const from = parseAddressList(h("from"))[0] ?? { name: "", email: "" };
  const labels = new Set(m.labelIds ?? []);
  return {
    id: m.id,
    from,
    to: parseAddressList(h("to")),
    cc: parseAddressList(h("cc")),
    date: new Date(Number(m.internalDate ?? 0)),
    subject: h("subject") ?? "",
    snippet: m.snippet ?? "",
    fromAccount: labels.has("SENT") || from.email === account,
    isDraft: labels.has("DRAFT"),
    inInbox: labels.has("INBOX"),
    automated: isAutomated(from.email, h),
  };
}

export async function gmailThreads(account: string, query: string): Promise<ThreadMeta[]> {
  const list = await gmailGet<{ threads?: { id: string }[] }>(account, "/threads", {
    q: query, maxResults: String(LIMITS.candidatesPerAccount),
  });
  const ids = (list.threads ?? []).map((t) => t.id);
  return mapLimit(ids, 10, async (id) => {
    const t = await gmailGet<{ id: string; messages?: GmailMessage[] }>(account, `/threads/${id}`, {
      format: "metadata", metadataHeaders: META_HEADERS,
    });
    const messages = (t.messages ?? []).map((m) => toMeta(account, m)).sort((a, b) => a.date.getTime() - b.date.getTime());
    return { threadId: t.id, messages };
  });
}

function decodeBody(data?: string): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function bodyText(part?: GmailPart): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename) return; // attachments
    if (p.mimeType === "text/plain") plain.push(decodeBody(p.body?.data));
    else if (p.mimeType === "text/html") html.push(decodeBody(p.body?.data));
    p.parts?.forEach(walk);
  };
  walk(part);
  if (plain.length) return plain.join("\n");
  return html.map((h) => convert(h, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }, { selector: "a", options: { ignoreHref: true } }] })).join("\n");
}

export async function gmailThreadMessages(account: string, threadId: string): Promise<{ subject: string; messages: ThreadMessage[] } | null> {
  if (!/^[0-9a-f]{6,24}$/i.test(threadId)) return null;
  const t = await gmailGet<{ messages?: GmailMessage[] }>(account, `/threads/${threadId}`, { format: "full" });
  const msgs = (t.messages ?? []).filter((m) => !m.labelIds?.includes("DRAFT"));
  if (!msgs.length) return null;
  const messages = msgs.map((m) => {
    const h = headerGetter(m.payload);
    const from: Address = parseAddressList(h("from"))[0] ?? { name: "", email: "" };
    return {
      from,
      to: parseAddressList(h("to")),
      cc: parseAddressList(h("cc")),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(),
      subject: cleanText(h("subject") ?? "", 300),
      text: cleanText(stripQuoted(bodyText(m.payload)), LIMITS.messageChars),
    };
  });
  return { subject: messages[0].subject, messages };
}
