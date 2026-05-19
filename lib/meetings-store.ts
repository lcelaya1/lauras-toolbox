import { createClient } from "@libsql/client";

export interface MeetingMeta {
  id: string;
  granolaId: string;
  title: string;
  summary: string;
  summaryMarkdown: string;
  transcriptJson: string;
  sessionNotes: string; // raw notes taken during the session (manually pasted)
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
  ]) {
    try { await client.execute(col); } catch { /* already exists */ }
  }
}

export async function listMeetings(): Promise<{ meetings: MeetingMeta[]; lastSyncedAt: string | null }> {
  const client = db();
  await initDb();

  const [meetingsResult, metaResult] = await Promise.all([
    client.execute("SELECT * FROM meetings ORDER BY created_at DESC"),
    client.execute("SELECT value FROM meta WHERE key = 'last_synced_at'"),
  ]);

  const meetings: MeetingMeta[] = meetingsResult.rows.map((r) => ({
    id: r.id as string,
    granolaId: r.granola_id as string,
    title: r.title as string,
    summary: r.summary as string,
    summaryMarkdown: r.summary_markdown as string,
    transcriptJson: (r.transcript_json as string) ?? "",
    sessionNotes: (r.session_notes as string) ?? "",
    createdAt: r.created_at as string,
    syncedAt: r.synced_at as string,
    rawJson: r.raw_json as string,
  }));

  const lastSyncedAt = (metaResult.rows[0]?.value as string | null) ?? null;
  return { meetings, lastSyncedAt };
}

export async function syncMeetings(
  incoming: Omit<MeetingMeta, "id" | "syncedAt">[],
): Promise<{ added: number; updated: number; total: number }> {
  const client = db();
  await initDb();

  const syncedAt = new Date().toISOString();
  let added = 0;
  let updated = 0;

  for (const note of incoming) {
    const existing = await client.execute({
      sql: "SELECT id FROM meetings WHERE granola_id = ?",
      args: [note.granolaId],
    });

    if (existing.rows.length === 0) {
      await client.execute({
        sql: `INSERT INTO meetings (id, granola_id, title, summary, summary_markdown, transcript_json, session_notes, created_at, synced_at, raw_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          note.granolaId,
          note.title,
          note.summary,
          note.summaryMarkdown,
          note.transcriptJson,
          "",
          note.createdAt,
          syncedAt,
          note.rawJson,
        ],
      });
      added++;
    } else {
      await client.execute({
        sql: `UPDATE meetings SET title=?, summary=?, summary_markdown=?, transcript_json=?, synced_at=?, raw_json=?
              WHERE granola_id=?`,
        args: [note.title, note.summary, note.summaryMarkdown, note.transcriptJson, syncedAt, note.rawJson, note.granolaId],
      });
      updated++;
    }
  }

  await client.execute({
    sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_synced_at', ?)",
    args: [syncedAt],
  });

  const total = await client.execute("SELECT COUNT(*) as count FROM meetings");
  return { added, updated, total: total.rows[0].count as number };
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
