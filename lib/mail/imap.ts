import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";
import {
  cleanText, isAutomated, LIMITS, stripQuoted,
  type Address, type MessageMeta, type ThreadMessage, type ThreadMeta,
} from "./common";

// Personal Gmail over IMAP (imap.gmail.com:993, TLS) with an app password.
// Mailboxes are only ever opened read-only (EXAMINE), so flags like \Seen never change.
// Gmail extensions keep results in the Gmail API shape: X-GM-RAW for search,
// X-GM-THRID for threads (converted to the hex id Gmail's web UI uses), X-GM-LABELS for Inbox/Sent.

function config() {
  const user = process.env.GMAIL_PERSONAL_ADDRESS?.trim();
  const pass = process.env.GMAIL_PERSONAL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) throw new Error("GMAIL_PERSONAL_ADDRESS / GMAIL_PERSONAL_APP_PASSWORD not set");
  return { user, pass };
}

function newClient(): ImapFlow {
  const { user, pass } = config();
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

async function withImap<T>(fn: (client: ImapFlow, boxes: { all: string; sent: string }) => Promise<T>): Promise<T> {
  const client = newClient();
  await client.connect();
  try {
    // Find folders by special-use flag, not by (localized) name: "[Gmail]/Enviados" etc.
    const list = await client.list();
    const all = list.find((b) => b.specialUse === "\\All")?.path;
    const sent = list.find((b) => b.specialUse === "\\Sent")?.path;
    if (!all || !sent) throw new Error("Could not find the All Mail / Sent folders (special-use flags missing)");
    return await fn(client, { all, sent });
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Login check only (no folder listing), used for the account status.
export async function imapCheck(): Promise<void> {
  const client = newClient();
  await client.connect();
  await client.logout().catch(() => client.close());
}

const toHex = (thrid: string) => BigInt(thrid).toString(16);
const fromHex = (hex: string) => BigInt(`0x${hex}`).toString();

function addr(list?: MessageAddressObject[]): Address[] {
  return (list ?? []).filter((a) => a.address).map((a) => ({ name: a.name ?? "", email: a.address!.toLowerCase() }));
}

function headerGetter(buf?: Buffer) {
  const map = new Map<string, string>();
  // Unfold continuation lines, then read "Name: value".
  for (const line of (buf?.toString("utf8") ?? "").replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) map.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return (name: string) => map.get(name.toLowerCase());
}

function toMeta(account: string, m: FetchMessageObject): MessageMeta {
  const from = addr(m.envelope?.from)[0] ?? { name: "", email: "" };
  const labels = m.labels ?? new Set<string>();
  return {
    id: String(m.uid),
    from,
    to: addr(m.envelope?.to),
    cc: addr(m.envelope?.cc),
    date: new Date(m.internalDate ?? m.envelope?.date ?? 0),
    subject: m.envelope?.subject ?? "",
    snippet: "",
    fromAccount: labels.has("\\Sent") || from.email === account,
    isDraft: labels.has("\\Draft"),
    inInbox: labels.has("\\Inbox"),
    automated: isAutomated(from.email, headerGetter(m.headers)),
  };
}

// Short preview from the start of the plain-text body (IMAP has no Gmail snippet).
async function snippetFor(client: ImapFlow, uid: number): Promise<string> {
  const msg = await client.fetchOne(String(uid), { source: { maxLength: 16_384 } }, { uid: true });
  if (!msg || !msg.source) return "";
  const parsed = await simpleParser(msg.source);
  return cleanText(stripQuoted(parsed.text ?? "").replace(/\s+/g, " "), LIMITS.snippetChars);
}

// All messages active in the window, grouped into threads (oldest → newest per thread).
// Messages are searched in All Mail; replies the account sent are found through the \Sent folder.
async function windowThreads(
  client: ImapFlow, boxes: { all: string; sent: string }, account: string, gmraw: string, viaSent: boolean,
  select: (t: ThreadMeta) => boolean,
): Promise<ThreadMeta[]> {
  let threadIds: string[] | null = null;
  if (viaSent) {
    const lock = await client.getMailboxLock(boxes.sent, { readOnly: true });
    try {
      const uids = (await client.search({ gmraw }, { uid: true })) || [];
      const recent = uids.slice(-LIMITS.candidatesPerAccount);
      const sent = recent.length ? await client.fetchAll(recent, { threadId: true }, { uid: true }) : [];
      threadIds = [...new Set(sent.map((m) => m.threadId).filter((t): t is string => !!t))];
    } finally {
      lock.release();
    }
    if (!threadIds.length) return [];
  }

  const lock = await client.getMailboxLock(boxes.all, { readOnly: true });
  try {
    const uids = (await client.search({ gmraw }, { uid: true })) || [];
    const recent = uids.slice(-LIMITS.imapMessagesScanned);
    if (!recent.length) return [];
    const fetched = await client.fetchAll(recent, {
      uid: true, envelope: true, internalDate: true, threadId: true, labels: true,
      headers: ["list-unsubscribe", "auto-submitted", "precedence", "content-type"],
    }, { uid: true });

    const byThread = new Map<string, FetchMessageObject[]>();
    for (const m of fetched) {
      if (!m.threadId || (threadIds && !threadIds.includes(m.threadId))) continue;
      byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    }
    const threads = [...byThread.entries()].map(([thrid, msgs]) => {
      const sorted = msgs.sort((a, b) => new Date(a.internalDate ?? 0).getTime() - new Date(b.internalDate ?? 0).getTime());
      return { threadId: toHex(thrid), raw: sorted, messages: sorted.map((m) => toMeta(account, m)) };
    })
      .sort((a, b) => b.messages.at(-1)!.date.getTime() - a.messages.at(-1)!.date.getTime())
      .filter(select)
      .slice(0, LIMITS.threadsPerAccount);

    // Snippets only for the threads that will be returned (one small fetch each).
    for (const t of threads) {
      const last = t.messages.at(-1)!;
      last.snippet = await snippetFor(client, t.raw.at(-1)!.uid).catch(() => "");
    }
    return threads.map(({ threadId, messages }) => ({ threadId, messages }));
  } finally {
    lock.release();
  }
}

export async function imapThreads(
  account: string, gmraw: string, opts: { viaSent: boolean; select: (t: ThreadMeta) => boolean },
): Promise<ThreadMeta[]> {
  return withImap((client, boxes) => windowThreads(client, boxes, account, gmraw, opts.viaSent, opts.select));
}

export async function imapThreadMessages(threadId: string): Promise<{ subject: string; messages: ThreadMessage[] } | null> {
  if (!/^[0-9a-f]{6,24}$/i.test(threadId)) return null;
  return withImap(async (client, boxes) => {
    const lock = await client.getMailboxLock(boxes.all, { readOnly: true });
    try {
      const uids = (await client.search({ threadId: fromHex(threadId) }, { uid: true })) || [];
      if (!uids.length) return null;
      const fetched = await client.fetchAll(uids.slice(-30), { uid: true, source: true, labels: true, internalDate: true }, { uid: true });
      const messages: ThreadMessage[] = [];
      for (const m of fetched.sort((a, b) => new Date(a.internalDate ?? 0).getTime() - new Date(b.internalDate ?? 0).getTime())) {
        if (m.labels?.has("\\Draft") || !m.source) continue;
        const p = await simpleParser(m.source);
        const list = (v: typeof p.to) => (v ? [v].flat().flatMap((x) => x.value) : []);
        const toAddr = (a: { name?: string; address?: string }) => ({ name: a.name ?? "", email: (a.address ?? "").toLowerCase() });
        messages.push({
          from: toAddr(p.from?.value[0] ?? {}),
          to: list(p.to).map(toAddr),
          cc: list(p.cc).map(toAddr),
          date: (p.date ?? new Date(m.internalDate ?? 0)).toISOString(),
          subject: cleanText(p.subject ?? "", 300),
          text: cleanText(stripQuoted(p.text ?? ""), LIMITS.messageChars),
        });
      }
      return messages.length ? { subject: messages[0].subject, messages } : null;
    } finally {
      lock.release();
    }
  });
}
