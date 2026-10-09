import { createClient } from "@libsql/client";

export type TaskCategory = "FG" | "COPSUP" | "VEN" | "4o" | "WF" | "OPS" | "PFGs" | "TiB";

export interface Task {
  id: string;       // stable UUID so Reminders can reference back
  text: string;
  done: boolean;
  category?: TaskCategory;
  createdAt?: string;
  source?: "claude" | "manual";
  doneAt?: string;
  doneBy?: "laura" | "claude" | "reminders";
  doneEvidence?: string;   // why Claude marked it done (shown so Laura can undo)
}

export interface MeetingMeta {
  id: string;
  granolaId: string;
  title: string;
  summary: string;
  summaryMarkdown: string;
  transcriptJson: string;
  sessionNotes: string; // raw notes taken during the session (manually pasted)
  tasks: Task[];        // tasks extracted by Claude
  createdAt: string;
  syncedAt: string;
  rawJson: string;
}

function db() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
}

export async function initDb(): Promise<void> {
  const client = db();
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      granola_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      summary_markdown TEXT NOT NULL DEFAULT '',
      transcript_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Add columns that may not exist in older DBs
  for (const col of [
    "ALTER TABLE meetings ADD COLUMN transcript_json TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE meetings ADD COLUMN session_notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE meetings ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]'",
  ]) {
    try { await client.execute(col); } catch { /* already exists */ }
  }
}

export interface SyncStats {
  granola_total: number;
  app_total: number;
  added: number;
}

export async function listMeetings(): Promise<{
  meetings: MeetingMeta[];
  lastSyncedAt: string | null;
  syncStats: SyncStats | null;
}> {
  const client = db();
  await initDb();

  const [meetingsResult, metaResult] = await Promise.all([
    client.execute("SELECT * FROM meetings ORDER BY created_at DESC"),
    client.execute("SELECT key, value FROM meta WHERE key IN ('last_synced_at', 'last_sync_stats')"),
  ]);

  const meetings: MeetingMeta[] = meetingsResult.rows.map((r) => {
    let tasks: Task[] = [];
    try { tasks = JSON.parse((r.tasks as string) || "[]"); } catch { /* ignore */ }
    return {
      id: r.id as string,
      granolaId: r.granola_id as string,
      title: r.title as string,
      summary: r.summary as string,
      summaryMarkdown: r.summary_markdown as string,
      transcriptJson: (r.transcript_json as string) ?? "",
      sessionNotes: (r.session_notes as string) ?? "",
      tasks,
      createdAt: r.created_at as string,
      syncedAt: r.synced_at as string,
      rawJson: r.raw_json as string,
    };
  });

  const meta: Record<string, string> = {};
  for (const row of metaResult.rows) {
    meta[row.key as string] = row.value as string;
  }

  let syncStats: SyncStats | null = null;
  try { syncStats = meta.last_sync_stats ? JSON.parse(meta.last_sync_stats) : null; } catch { /* ignore */ }

  return { meetings, lastSyncedAt: meta.last_synced_at ?? null, syncStats };
}

export async function createMeeting(data: { title: string; createdAt: string; summaryMarkdown: string }): Promise<MeetingMeta> {
  const client = db();
  await initDb();
  const id = crypto.randomUUID();
  const syncedAt = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO meetings (id, granola_id, title, summary, summary_markdown, transcript_json, session_notes, created_at, synced_at, raw_json)
          VALUES (?, ?, ?, ?, ?, '', '', ?, ?, '{}')`,
    args: [id, `manual_${id}`, data.title, "", data.summaryMarkdown, data.createdAt, syncedAt],
  });
  return {
    id,
    granolaId: `manual_${id}`,
    title: data.title,
    summary: "",
    summaryMarkdown: data.summaryMarkdown,
    transcriptJson: "",
    sessionNotes: "",
    tasks: [],
    createdAt: data.createdAt,
    syncedAt,
    rawJson: "{}",
  };
}

export async function updateNotes(id: string, summaryMarkdown: string): Promise<void> {
  const client = db();
  await client.execute({
    sql: "UPDATE meetings SET summary_markdown = ? WHERE id = ?",
    args: [summaryMarkdown, id],
  });
}

export async function updateSessionNotes(id: string, notes: string): Promise<void> {
  const client = db();
  await client.execute({
    sql: "UPDATE meetings SET session_notes = ? WHERE id = ?",
    args: [notes, id],
  });
}

export async function updateTranscript(id: string, transcript: string): Promise<void> {
  const client = db();
  await client.execute({
    sql: "UPDATE meetings SET transcript_json = ? WHERE id = ?",
    args: [transcript, id],
  });
}

export async function removeMeeting(id: string): Promise<void> {
  const client = db();
  await client.execute({ sql: "DELETE FROM meetings WHERE id = ?", args: [id] });
}

export async function updateTasks(id: string, tasks: Task[]): Promise<void> {
  const client = db();
  // Ensure every task has a stable UUID
  const withIds = tasks.map((t) => ({ ...t, id: t.id || crypto.randomUUID() }));
  await client.execute({
    sql: "UPDATE meetings SET tasks = ? WHERE id = ?",
    args: [JSON.stringify(withIds), id],
  });
}

export async function getMeeting(id: string): Promise<MeetingMeta | null> {
  const { meetings } = await listMeetings();
  return meetings.find((m) => m.id === id) ?? null;
}
