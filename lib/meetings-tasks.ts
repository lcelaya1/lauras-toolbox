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

export const OWN_TASK_TITLE = "Own task";

// Standalone tasks (not from a meeting). Skips the insert when an open standalone task
// with the same text already exists, so retries don't create duplicates.
export async function addStandaloneTask(
  text: string, category: TaskCategory, dueDate?: string,
): Promise<{ task_id: string; duplicate: boolean }> {
  await initDb();
  const client = db();
  const key = normalize(text);
  const { rows } = await client.execute("SELECT id, text FROM standalone_tasks WHERE done = 0");
  const existing = rows.find((r) => normalize(String(r.text)) === key);
  if (existing) return { task_id: String(existing.id), duplicate: true };
  const id = crypto.randomUUID();
  await client.execute({
    sql: "INSERT INTO standalone_tasks (id, text, category, due_date, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [id, text.trim(), category, dueDate ?? null, new Date().toISOString()],
  });
  return { task_id: id, duplicate: false };
}

function standaloneToTask(r: Record<string, unknown>): Task {
  return {
    id: String(r.id),
    text: String(r.text),
    done: Number(r.done) === 1,
    category: r.category as TaskCategory,
    createdAt: String(r.created_at),
    doneAt: (r.done_at as string | null) ?? undefined,
    doneBy: (r.done_by as Task["doneBy"] | null) ?? undefined,
    doneEvidence: (r.done_evidence as string | null) ?? undefined,
  };
}

async function setStandaloneDone(taskId: string, done: boolean, by: Task["doneBy"], evidence?: string): Promise<Task | null> {
  const client = db();
  const res = await client.execute(done
    ? { sql: "UPDATE standalone_tasks SET done = 1, done_at = ?, done_by = ?, done_evidence = ? WHERE id = ?",
        args: [new Date().toISOString(), by ?? null, evidence?.slice(0, 500) ?? null, taskId] }
    : { sql: "UPDATE standalone_tasks SET done = 0, done_at = NULL, done_by = NULL, done_evidence = NULL WHERE id = ?",
        args: [taskId] });
  if (!res.rowsAffected) return null;
  const { rows } = await client.execute({ sql: "SELECT * FROM standalone_tasks WHERE id = ?", args: [taskId] });
  return rows[0] ? standaloneToTask(rows[0] as Record<string, unknown>) : null;
}

export async function setTaskDone(
  taskId: string, done: boolean, by: Task["doneBy"], evidence?: string,
): Promise<{ task: Task; meetingTitle: string } | null> {
  await initDb();
  const own = await setStandaloneDone(taskId, done, by, evidence);
  if (own) return { task: own, meetingTitle: OWN_TASK_TITLE };
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
  source: "meeting" | "manual";   // "manual" = standalone task, not from a meeting
  meeting_id: string | null;      // null for standalone tasks
  meeting_title: string;          // "Own task" for standalone tasks
  meeting_date: string;           // standalone tasks: creation date
  due_date: string | null;
  age_days: number;
}

// Open tasks (oldest first), plus tasks completed within the given window.
// Standalone tasks are merged in by creation date.
export async function listTasks(opts: { doneSinceHours?: number } = {}): Promise<{ open: TaskView[]; recently_done: TaskView[] }> {
  await initDb();
  const client = db();
  const [meetings, standalone] = await Promise.all([
    client.execute("SELECT id, title, created_at, tasks FROM meetings WHERE tasks != '[]' ORDER BY created_at ASC"),
    client.execute("SELECT * FROM standalone_tasks"),
  ]);
  const since = opts.doneSinceHours ? Date.now() - opts.doneSinceHours * 3_600_000 : null;
  const open: TaskView[] = [];
  const recentlyDone: TaskView[] = [];
  const add = (t: Task, meeting: { id: string | null; title: string; date: string }, dueDate: string | null) => {
    const view: TaskView = {
      task_id: t.id,
      text: t.text,
      category: t.category ?? null,
      done: t.done,
      done_at: t.doneAt ?? null,
      done_by: t.doneBy ?? null,
      done_evidence: t.doneEvidence ?? null,
      source: meeting.id ? "meeting" : "manual",
      meeting_id: meeting.id,
      meeting_title: meeting.title,
      meeting_date: meeting.date,
      due_date: dueDate,
      age_days: Math.floor((Date.now() - new Date(meeting.date).getTime()) / 86_400_000),
    };
    if (!t.done) open.push(view);
    else if (since && t.doneAt && new Date(t.doneAt).getTime() >= since) recentlyDone.push(view);
  };
  for (const r of meetings.rows) {
    let tasks: Task[] = [];
    try { tasks = JSON.parse(String(r.tasks)); } catch { continue; }
    for (const t of tasks) add(t, { id: String(r.id), title: String(r.title), date: String(r.created_at) }, null);
  }
  for (const r of standalone.rows) {
    const t = standaloneToTask(r as Record<string, unknown>);
    add(t, { id: null, title: OWN_TASK_TITLE, date: t.createdAt! }, (r.due_date as string | null) ?? null);
  }
  const byDate = (a: TaskView, b: TaskView) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime();
  return { open: open.sort(byDate), recently_done: recentlyDone.sort(byDate) };
}
