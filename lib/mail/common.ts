// Shared types and helpers for reading mail across Gmail API (Workspace) and IMAP (personal).
// Everything here is read-only. Email content is untrusted third-party data.

export type AccountKind = "oauth" | "imap";
export type AccountStatus = "connected" | "not_connected" | "needs_reconnect" | "error";

export interface MailAccount {
  email: string;
  kind: AccountKind;
  label: string;
}

export const WORKSPACE_ACCOUNTS: MailAccount[] = [
  { email: "laura.celaya@teamlabs.es", kind: "oauth", label: "Laura (Teamlabs)" },
  { email: "copsup@teamlabs.es", kind: "oauth", label: "COP / SUP" },
  { email: "techinbiz@teamlabs.es", kind: "oauth", label: "Tech in Biz" },
  { email: "futuregame@teamlabs.es", kind: "oauth", label: "Future Game" },
  { email: "operaciones@teamlabs.es", kind: "oauth", label: "Operaciones" },
];

export function personalAccount(): MailAccount | null {
  const email = process.env.GMAIL_PERSONAL_ADDRESS?.trim().toLowerCase();
  return email ? { email, kind: "imap", label: "Personal" } : null;
}

export function allAccounts(): MailAccount[] {
  const personal = personalAccount();
  return personal ? [...WORKSPACE_ACCOUNTS, personal] : WORKSPACE_ACCOUNTS;
}

export function isWorkspaceAccount(email: string): boolean {
  return WORKSPACE_ACCOUNTS.some((a) => a.email === email.trim().toLowerCase());
}

export interface Address { name: string; email: string }

// One message in a thread, as metadata (no body).
export interface MessageMeta {
  id: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: Date;
  subject: string;
  snippet: string;
  fromAccount: boolean;          // sent by the account itself
  isDraft: boolean;
  inInbox: boolean;
  automated: boolean;            // newsletter / no-reply / auto-submitted
}

export interface ThreadMeta {
  threadId: string;              // hex Gmail thread id (same for API and IMAP)
  messages: MessageMeta[];       // oldest → newest
}

// Normalized shape returned by the MCP tools, identical for OAuth and IMAP accounts.
export interface ThreadSummary {
  account: string;
  thread_id: string;
  subject: string;
  from: Address;
  last_message_at: string;
  snippet: string;
  directly_addressed: boolean;
  message_count: number;
  gmail_link: string;
}

export interface ThreadMessage {
  from: Address;
  to: Address[];
  cc: Address[];
  date: string;
  subject: string;
  text: string;
}

export interface AccountError { account: string; status: AccountStatus; message: string }

export const LIMITS = {
  threadsPerAccount: 25,        // results returned per account
  candidatesPerAccount: 60,     // threads inspected per account before filtering
  imapMessagesScanned: 500,
  messageChars: 8_000,
  threadChars: 40_000,
  snippetChars: 200,
  accountTimeoutMs: 20_000,
};

export function gmailLink(account: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${threadId}`;
}

// Gmail's search syntax works for both the API (q=) and IMAP (X-GM-RAW).
// Calendar invites carry an .ics attachment; Google Calendar notifications come from calendar-notification@google.com.
export function windowQuery(sinceHours: number, extra: string): string {
  const after = Math.floor((Date.now() - sinceHours * 3_600_000) / 1000);
  return `after:${after} -in:chats -filename:ics -from:calendar-notification@google.com ${extra}`.trim();
}

// Pending mail also skips Gmail's Promotions and Social tabs (reliable categories;
// "Updates" overlaps with Primary over IMAP, so it is not used).
export const PENDING_EXTRA = "-category:promotions -category:social";

// Matched against the local part of the sender address, as a whole word: "no-reply@", "invoice+x@", "alerts.y@".
const AUTOMATED_SENDER = /^(.*[._+-])?(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|invoices?|receipts?|billing|statements?|newsletters?)([._+-].*)?@/i;

export function isAutomated(fromEmail: string, headers: (name: string) => string | undefined): boolean {
  if (AUTOMATED_SENDER.test(fromEmail)) return true;
  if (headers("list-unsubscribe")) return true;
  const autoSubmitted = headers("auto-submitted")?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const precedence = headers("precedence")?.toLowerCase();
  if (precedence && ["bulk", "list", "junk"].includes(precedence)) return true;
  const contentType = headers("content-type")?.toLowerCase();
  if (contentType?.includes("text/calendar")) return true;
  return false;
}

export function parseAddressList(value: string | undefined): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  // Split on commas that are not inside quotes or angle brackets.
  for (const part of value.match(/(?:"[^"]*"|<[^>]*>|[^,])+/g) ?? []) {
    const m = part.trim().match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/);
    if (m) out.push({ name: (m[1] ?? "").trim(), email: m[2].trim().toLowerCase() });
    else if (part.includes("@")) out.push({ name: "", email: part.trim().toLowerCase() });
  }
  return out;
}

// Plain, safe text: decode common entities, drop control / zero-width / bidi characters.
export function cleanText(s: string, max?: number): string {
  let t = s
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (max && t.length > max) t = t.slice(0, max).trimEnd() + "…";
  return t;
}

function safeChar(code: number): string {
  try { return String.fromCodePoint(code); } catch { return ""; }
}

// Cut quoted history ("On … wrote:" / "El … escribió:" and > blocks) to keep threads compact.
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((l) =>
    /^(On|El|Le|Am)\s.+(wrote|escribió|a écrit|schrieb):\s*$/i.test(l.trim()) ||
    /^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}$/i.test(l.trim()) ||
    /^_{10,}$/.test(l.trim()),
  );
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">"));
  return kept.join("\n").trim();
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Runs fn over items with a concurrency limit, preserving order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// Pending: someone else wrote last, the thread is in the inbox, and it isn't automated.
export function summarizePending(account: string, t: ThreadMeta): ThreadSummary | null {
  const msgs = t.messages.filter((m) => !m.isDraft);
  const last = msgs.at(-1);
  if (!last || last.fromAccount || last.automated) return null;
  if (!msgs.some((m) => m.inInbox)) return null;
  return toSummary(account, t.threadId, msgs, last);
}

// Recently replied: the account's own message is the latest one.
export function summarizeReplied(account: string, t: ThreadMeta): ThreadSummary | null {
  const msgs = t.messages.filter((m) => !m.isDraft);
  const last = msgs.at(-1);
  if (!last || !last.fromAccount) return null;
  // Show the person the account replied to (latest message from someone else), else the recipient.
  const other = [...msgs].reverse().find((m) => !m.fromAccount);
  return toSummary(account, t.threadId, msgs, last, other?.from ?? last.to[0] ?? last.from);
}

function toSummary(account: string, threadId: string, msgs: MessageMeta[], last: MessageMeta, from = last.from): ThreadSummary {
  const lastInbound = [...msgs].reverse().find((m) => !m.fromAccount) ?? last;
  const recipients = [...lastInbound.to, ...lastInbound.cc].map((a) => a.email);
  return {
    account,
    thread_id: threadId,
    subject: cleanText(msgs[0].subject || last.subject || "(sin asunto)", 300),
    from: { name: cleanText(from.name, 200), email: from.email },
    last_message_at: last.date.toISOString(),
    snippet: cleanText(last.snippet, LIMITS.snippetChars),
    directly_addressed: recipients.includes(account),
    message_count: msgs.length,
    gmail_link: gmailLink(account, threadId),
  };
}
