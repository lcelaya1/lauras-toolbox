import {
  allAccounts, LIMITS, PENDING_EXTRA, summarizePending, summarizeReplied, windowQuery, withTimeout,
  type AccountError, type AccountStatus, type MailAccount, type ThreadMessage, type ThreadMeta, type ThreadSummary,
} from "./common";
import { accessTokenFor, gmailThreadMessages, gmailThreads, ReconnectNeeded } from "./google";
import { imapCheck, imapThreadMessages, imapThreads } from "./imap";
import { listStoredAccounts } from "./store";

// Read-only mail access across all accounts. Accounts run in parallel with a per-account
// timeout; one failing account never hides results from the others.

export interface AccountInfo {
  email: string;
  label: string;
  kind: MailAccount["kind"];
  status: AccountStatus;
  detail: string | null;
  connected_at: string | null;
}

function describe(e: unknown): { status: AccountStatus; message: string } {
  if (e instanceof ReconnectNeeded) return { status: "needs_reconnect", message: e.message };
  const message = e instanceof Error ? e.message : "Unknown error";
  // IMAP auth failures (bad / revoked app password) need user action too.
  if (/AUTHENTICATIONFAILED|Invalid credentials|authenticat/i.test(message)) {
    return { status: "needs_reconnect", message: "Gmail rejected the app password — create a new one and update GMAIL_PERSONAL_APP_PASSWORD" };
  }
  return { status: "error", message: message.slice(0, 300) };
}

// Live status: refreshes each OAuth token and logs in to IMAP (in parallel, ~1–2s total).
export async function listAccounts(): Promise<AccountInfo[]> {
  const stored = await listStoredAccounts();
  return Promise.all(allAccounts().map(async (a): Promise<AccountInfo> => {
    const row = stored.get(a.email);
    const base = { email: a.email, label: a.label, kind: a.kind, connected_at: row?.connectedAt ?? null };
    if (a.kind === "oauth" && !row?.hasToken) return { ...base, status: "not_connected", detail: null };
    try {
      await withTimeout<unknown>(a.kind === "oauth" ? accessTokenFor(a.email) : imapCheck(), 10_000, a.email);
      return { ...base, status: "connected", detail: null };
    } catch (e) {
      const { status, message } = describe(e);
      return { ...base, status, detail: message };
    }
  }));
}

function selectAccounts(requested?: string[]): { accounts: MailAccount[]; unknown: string[] } {
  const all = allAccounts();
  if (!requested?.length) return { accounts: all, unknown: [] };
  const wanted = requested.map((e) => e.trim().toLowerCase());
  return {
    accounts: all.filter((a) => wanted.includes(a.email)),
    unknown: wanted.filter((e) => !all.some((a) => a.email === e)),
  };
}

async function acrossAccounts(
  requested: string[] | undefined,
  run: (a: MailAccount) => Promise<ThreadSummary[]>,
): Promise<{ threads: ThreadSummary[]; errors: AccountError[] }> {
  const { accounts, unknown } = selectAccounts(requested);
  const stored = await listStoredAccounts();
  const errors: AccountError[] = unknown.map((account) => ({ account, status: "error", message: "Unknown account" }));

  const results = await Promise.all(accounts.map(async (a) => {
    if (a.kind === "oauth" && !stored.get(a.email)?.hasToken) {
      errors.push({ account: a.email, status: "not_connected", message: "Not connected yet — connect it on the Toolbox mail page" });
      return [];
    }
    try {
      return await withTimeout(run(a), LIMITS.accountTimeoutMs, a.email);
    } catch (e) {
      const { status, message } = describe(e);
      errors.push({ account: a.email, status, message });
      return [];
    }
  }));

  const threads = results.flat().sort((x, y) => y.last_message_at.localeCompare(x.last_message_at));
  return { threads, errors };
}

function clampHours(h: number | undefined): number {
  return Math.min(Math.max(Math.round(h ?? 48), 1), 24 * 14);
}

export async function getPendingThreads(sinceHours?: number, accounts?: string[]) {
  const hours = clampHours(sinceHours);
  const query = windowQuery(hours, `in:inbox ${PENDING_EXTRA}`);
  const select = (a: MailAccount) => (t: ThreadMeta) => summarizePending(a.email, t) !== null;
  return acrossAccounts(accounts, async (a) => {
    const threads = a.kind === "oauth"
      ? await gmailThreads(a.email, query)
      : await imapThreads(a.email, windowQuery(hours, PENDING_EXTRA), { viaSent: false, select: select(a) });
    return threads.map((t) => summarizePending(a.email, t)).filter((t): t is ThreadSummary => !!t).slice(0, LIMITS.threadsPerAccount);
  });
}

export async function getRecentlyReplied(sinceHours?: number, accounts?: string[]) {
  const hours = clampHours(sinceHours);
  const query = windowQuery(hours, "in:sent");
  const select = (a: MailAccount) => (t: ThreadMeta) => summarizeReplied(a.email, t) !== null;
  return acrossAccounts(accounts, async (a) => {
    const threads = a.kind === "oauth"
      ? await gmailThreads(a.email, query)
      : await imapThreads(a.email, windowQuery(hours, ""), { viaSent: true, select: select(a) });
    return threads.map((t) => summarizeReplied(a.email, t)).filter((t): t is ThreadSummary => !!t).slice(0, LIMITS.threadsPerAccount);
  });
}

export async function getThread(account: string, threadId: string): Promise<
  { account: string; thread_id: string; subject: string; messages: ThreadMessage[]; truncated: boolean } | { error: AccountError }
> {
  const a = allAccounts().find((x) => x.email === account.trim().toLowerCase());
  if (!a) return { error: { account, status: "error", message: "Unknown account" } };
  try {
    const t = await withTimeout(
      a.kind === "oauth" ? gmailThreadMessages(a.email, threadId) : imapThreadMessages(threadId),
      LIMITS.accountTimeoutMs, a.email,
    );
    if (!t) return { error: { account: a.email, status: "error", message: "Thread not found" } };
    // Keep the newest messages within the overall size budget.
    let budget = LIMITS.threadChars;
    const kept: ThreadMessage[] = [];
    for (const m of [...t.messages].reverse()) {
      if (budget - m.text.length < 0 && kept.length) break;
      budget -= m.text.length;
      kept.unshift(m);
    }
    return { account: a.email, thread_id: threadId.toLowerCase(), subject: t.subject, messages: kept, truncated: kept.length < t.messages.length };
  } catch (e) {
    const { status, message } = describe(e);
    return { error: { account: a.email, status, message } };
  }
}
