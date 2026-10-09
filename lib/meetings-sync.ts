import { createClient } from "@libsql/client";
import { initDb } from "./meetings-store";

// Daily Granola → Toolbox sync, driven by a Claude scheduled task that reads meetings
// through the Granola connector and saves them via the MCP tools. Insert-only: existing
// meetings (and their tasks / session notes) are never modified.

function db() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
}

export interface IncomingMeeting {
  granolaId: string;
  title: string;
  createdAt: string;
  summaryMarkdown: string;
  participants?: string;
  url?: string;
}

export async function findUnsavedMeetings(granolaIds: string[]): Promise<string[]> {
  if (granolaIds.length === 0) return [];
  await initDb();
  const { rows } = await db().execute({
    sql: `SELECT granola_id FROM meetings WHERE granola_id IN (${granolaIds.map(() => "?").join(",")})`,
    args: granolaIds,
  });
  const saved = new Set(rows.map((r) => String(r.granola_id)));
  return granolaIds.filter((id) => !saved.has(id));
}

export async function saveMeetingsIfNew(meetings: IncomingMeeting[]): Promise<{
  added: string[]; skipped: string[]; total: number;
}> {
  await initDb();
  const client = db();
  const syncedAt = new Date().toISOString();
  const added: string[] = [];
  const skipped: string[] = [];

  for (const m of meetings) {
    const raw = JSON.stringify({
      id: m.granolaId, title: m.title, created_at: m.createdAt,
      url: m.url ?? null, participants: m.participants ?? "", source: "granola-mcp",
    });
    const res = await client.execute({
      sql: `INSERT INTO meetings (id, granola_id, title, summary, summary_markdown, transcript_json, session_notes, created_at, synced_at, raw_json)
            SELECT ?, ?, ?, '', ?, '', '', ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM meetings WHERE granola_id = ?)`,
      args: [crypto.randomUUID(), m.granolaId, m.title, m.summaryMarkdown, m.createdAt, syncedAt, raw, m.granolaId],
    });
    (res.rowsAffected ? added : skipped).push(m.granolaId);
  }

  const total = Number((await client.execute("SELECT COUNT(*) AS n FROM meetings")).rows[0].n);
  await client.batch([
    { sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_synced_at', ?)", args: [syncedAt] },
    {
      sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync_stats', ?)",
      args: [JSON.stringify({ granola_total: meetings.length, app_total: total, added: added.length })],
    },
  ], "write");

  return { added, skipped, total };
}
