import { createClient, type Client } from "@libsql/client";
import { initDb } from "./meetings-store";

// Daily Granola → Toolbox sync, run by the morning brief routine: it reads meetings
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

// Also records the check as the latest sync, so days without new meetings
// still show the daily sync as having run.
export async function findUnsavedMeetings(granolaIds: string[]): Promise<string[]> {
  await initDb();
  const client = db();
  let unsaved: string[] = [];
  if (granolaIds.length > 0) {
    const { rows } = await client.execute({
      sql: `SELECT granola_id FROM meetings WHERE granola_id IN (${granolaIds.map(() => "?").join(",")})`,
      args: granolaIds,
    });
    const saved = new Set(rows.map((r) => String(r.granola_id)));
    unsaved = granolaIds.filter((id) => !saved.has(id));
  }
  await recordSync(client, granolaIds.length, 0);
  return unsaved;
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

  // A run calls find_unsaved_meetings once, then save_meetings in batches:
  // keep the checked total from the find and add up the batches.
  const prev = await currentSync(client);
  const sameRun = prev && Date.now() - prev.at < 30 * 60 * 1000;
  const total = await recordSync(
    client,
    sameRun ? prev.granolaTotal : meetings.length,
    (sameRun ? prev.added : 0) + added.length,
  );
  return { added, skipped, total };
}

async function currentSync(client: Client): Promise<{ at: number; granolaTotal: number; added: number } | null> {
  const { rows } = await client.execute(
    "SELECT key, value FROM meta WHERE key IN ('last_synced_at', 'last_sync_stats')",
  );
  const meta = Object.fromEntries(rows.map((r) => [String(r.key), String(r.value)]));
  try {
    const stats = JSON.parse(meta.last_sync_stats);
    return { at: new Date(meta.last_synced_at).getTime(), granolaTotal: stats.granola_total, added: stats.added };
  } catch {
    return null;
  }
}

async function recordSync(client: Client, granolaTotal: number, added: number): Promise<number> {
  const total = Number((await client.execute("SELECT COUNT(*) AS n FROM meetings")).rows[0].n);
  await client.batch([
    { sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_synced_at', ?)", args: [new Date().toISOString()] },
    {
      sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync_stats', ?)",
      args: [JSON.stringify({ granola_total: granolaTotal, app_total: total, added })],
    },
  ], "write");
  return total;
}
