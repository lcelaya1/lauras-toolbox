import { createClient, type Client } from "@libsql/client";
import { initDb, type Task, type TaskCategory } from "./meetings-store";

// Laura's tasks across meetings. Tasks live as a JSON array in meetings.tasks; every
// update here is a compare-and-swap on that column, so concurrent edits from the web
// page, the Reminders shortcut and Claude don't overwrite each other.

function db(): Client {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
}

async function readTasks(client: Client, meetingId: string): Promise<{ raw: string; tasks: Task[] } | null> {
  const { rows } = await client.execute({ sql: "SELECT tasks FROM meetings WHERE id = ?", args: [meetingId] });
  if (!rows[0]) return null;
  const raw = String(rows[0].tasks ?? "[]");
  try { return { raw, tasks: JSON.parse(raw) as Task[] }; } catch { return { raw, tasks: [] }; }
}

async function modifyTasks<T>(meetingId: string, fn: (tasks: Task[]) => { tasks: Task[]; result: T }): Promise<T | null> {
  await initDb();
  const client = db();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readTasks(client, meetingId);
    if (!current) return null;
    const { tasks, result } = fn(current.tasks);
    const res = await client.execute({
      sql: "UPDATE meetings SET tasks = ? WHERE id = ? AND tasks = ?",
      args: [JSON.stringify(tasks), meetingId, current.raw],
    });
    if (res.rowsAffected === 1) return result;
  }
  throw new Error("Tasks changed concurrently, please retry");
}

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Add-only: tasks already on the meeting (same text, ignoring case/accents/punctuation)
// are skipped; existing tasks and their done state are never touched.
export async function addTasks(meetingId: string, incoming: { text: string; category: TaskCategory }[]) {
  return modifyTasks(meetingId, (tasks) => {
    const seen = new Set(tasks.map((t) => normalize(t.text)));
    const added: Task[] = [];
    const skipped: string[] = [];
    for (const { text, category } of incoming) {
      const key = normalize(text);
      if (!key || seen.has(key)) { skipped.push(text); continue; }
      seen.add(key);
      added.push({ id: crypto.randomUUID(), text: text.trim(), done: false, category, createdAt: new Date().toISOString(), source: "claude" });
    }
    return { tasks: [...tasks, ...added], result: { added, skipped } };
  });
}

async function findTask(taskId: string): Promise<{ meetingId: string; meetingTitle: string } | null> {
  await initDb();
  const { rows } = await db().execute({
    sql: "SELECT id, title FROM meetings WHERE tasks LIKE ?",
    args: [`%"id":"${taskId.replace(/[%_"\\]/g, "")}"%`],
  });
  return rows[0] ? { meetingId: String(rows[0].id), meetingTitle: String(rows[0].title) } : null;
}

export async function setTaskDone(
  taskId: string, done: boolean, by: Task["doneBy"], evidence?: string,
): Promise<{ task: Task; meetingTitle: string } | null> {
  const found = await findTask(taskId);
  if (!found) return null;
  const task = await modifyTasks(found.meetingId, (tasks) => {
    let changed: Task | null = null;
    const next = tasks.map((t) => {
      if (t.id !== taskId) return t;
      changed = done
        ? { ...t, done: true, doneAt: new Date().toISOString(), doneBy: by, doneEvidence: evidence?.slice(0, 500) }
        : { ...t, done: false, doneAt: undefined, doneBy: undefined, doneEvidence: undefined };
      return changed;
    });
    return { tasks: next, result: changed as Task | null };
  });
  return task ? { task, meetingTitle: found.meetingTitle } : null;
}

export interface TaskView {
  task_id: string;
  text: string;
  category: TaskCategory | null;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  done_evidence: string | null;
  meeting_id: string;
  meeting_title: string;
  meeting_date: string;
  age_days: number;
}

// Open tasks (oldest meeting first), plus tasks completed within the given window.
export async function listTasks(opts: { doneSinceHours?: number } = {}): Promise<{ open: TaskView[]; recently_done: TaskView[] }> {
  await initDb();
  const { rows } = await db().execute("SELECT id, title, created_at, tasks FROM meetings WHERE tasks != '[]' ORDER BY created_at ASC");
  const since = opts.doneSinceHours ? Date.now() - opts.doneSinceHours * 3_600_000 : null;
  const open: TaskView[] = [];
  const recentlyDone: TaskView[] = [];
  for (const r of rows) {
    let tasks: Task[] = [];
    try { tasks = JSON.parse(String(r.tasks)); } catch { continue; }
    const date = String(r.created_at);
    for (const t of tasks) {
      const view: TaskView = {
        task_id: t.id,
        text: t.text,
        category: t.category ?? null,
        done: t.done,
        done_at: t.doneAt ?? null,
        done_by: t.doneBy ?? null,
        done_evidence: t.doneEvidence ?? null,
        meeting_id: String(r.id),
        meeting_title: String(r.title),
        meeting_date: date,
        age_days: Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000),
      };
      if (!t.done) open.push(view);
      else if (since && t.doneAt && new Date(t.doneAt).getTime() >= since) recentlyDone.push(view);
    }
  }
  return { open, recently_done: recentlyDone };
}
