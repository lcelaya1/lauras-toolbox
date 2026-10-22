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
// are skipped; existing tasks and their done state are never touched. Deleted tasks and
// the original text of edited tasks still count, so re-extracting the same meeting notes
// never brings back a task Laura deleted or renamed.
export async function addTasks(meetingId: string, incoming: { text: string; category: TaskCategory; dueDate?: string }[]) {
  return modifyTasks(meetingId, (tasks) => {
    const seen = new Map<string, Task>();
    for (const t of tasks) {
      seen.set(normalize(t.text), t);
      if (t.originalText) seen.set(normalize(t.originalText), t);
    }
    const added: Task[] = [];
    const skipped: string[] = [];
    const skippedDeleted: string[] = [];
    for (const { text, category, dueDate } of incoming) {
      const key = normalize(text);
      const match = seen.get(key);
      if (!key || match) { (match?.deletedAt ? skippedDeleted : skipped).push(text); continue; }
      const task: Task = {
        id: crypto.randomUUID(), text: text.trim(), done: false, category, createdAt: new Date().toISOString(), source: "claude",
        ...(dueDate ? { dueDate } : {}),
      };
      seen.set(key, task);
      added.push(task);
    }
    return { tasks: [...tasks, ...added], result: { added, skipped, skippedDeleted } };
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

// Standalone tasks (not from a meeting). Skips the insert when an open, non-deleted
// standalone task with the same text already exists, so retries don't create duplicates.
export async function addStandaloneTask(
  text: string, category: TaskCategory, dueDate?: string,
): Promise<{ task_id: string; duplicate: boolean }> {
  await initDb();
  const client = db();
  const key = normalize(text);
  const { rows } = await client.execute("SELECT id, text FROM standalone_tasks WHERE done = 0 AND deleted_at IS NULL");
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
    dueDate: (r.due_date as string | null) ?? undefined,
    originalText: (r.original_text as string | null) ?? undefined,
    deletedAt: (r.deleted_at as string | null) ?? undefined,
    doneAt: (r.done_at as string | null) ?? undefined,
    doneBy: (r.done_by as Task["doneBy"] | null) ?? undefined,
    doneEvidence: (r.done_evidence as string | null) ?? undefined,
  };
}

// ── Changing one task ───────────────────────────────────────────────────────
// Every change (done, due date, edit, delete, restore) goes through mutateTask, which
// finds the task in standalone_tasks or in a meeting's JSON and writes it back.

export interface TaskChange { before: Task; task: Task; meetingTitle: string; meetingId: string | null }
export type TaskResult = TaskChange | { error: string; status: 404 | 409 };

const notFound = (taskId: string): TaskResult => ({ error: `Task ${taskId} not found.`, status: 404 });
const conflict = (error: string) => ({ error, status: 409 as const });

// fn returns the new task, or an error message when the change isn't allowed.
async function mutateTask(taskId: string, fn: (t: Task) => Task | { error: string }): Promise<TaskResult> {
  await initDb();
  const client = db();
  const { rows } = await client.execute({ sql: "SELECT * FROM standalone_tasks WHERE id = ?", args: [taskId] });
  if (rows[0]) {
    const before = standaloneToTask(rows[0] as Record<string, unknown>);
    const next = fn(before);
    if ("error" in next) return conflict(next.error);
    await client.execute({
      sql: `UPDATE standalone_tasks SET text = ?, category = ?, due_date = ?, original_text = ?, deleted_at = ?,
              done = ?, done_at = ?, done_by = ?, done_evidence = ? WHERE id = ?`,
      args: [next.text, next.category ?? "OPS", next.dueDate ?? null, next.originalText ?? null, next.deletedAt ?? null,
        next.done ? 1 : 0, next.doneAt ?? null, next.doneBy ?? null, next.doneEvidence ?? null, taskId],
    });
    return { before, task: next, meetingTitle: OWN_TASK_TITLE, meetingId: null };
  }
  const found = await findTask(taskId);
  if (!found) return notFound(taskId);
  const result = await modifyTasks(found.meetingId, (tasks) => {
    const i = tasks.findIndex((t) => t.id === taskId);
    if (i < 0) return { tasks, result: notFound(taskId) };
    const next = fn(tasks[i]);
    if ("error" in next) return { tasks, result: conflict(next.error) };
    return {
      tasks: tasks.map((t, j) => (j === i ? next : t)),
      result: { before: tasks[i], task: next, meetingTitle: found.meetingTitle, meetingId: found.meetingId } as TaskResult,
    };
  });
  return result ?? notFound(taskId);
}

const DELETED = { error: "This task is deleted. Restore it first with restore_task." };

export function setTaskDone(taskId: string, done: boolean, by: Task["doneBy"], evidence?: string): Promise<TaskResult> {
  return mutateTask(taskId, (t) => {
    if (t.deletedAt) return DELETED;
    return done
      ? { ...t, done: true, doneAt: new Date().toISOString(), doneBy: by, doneEvidence: evidence?.slice(0, 500) }
      : { ...t, done: false, doneAt: undefined, doneBy: undefined, doneEvidence: undefined };
  });
}

// Only the fields given are changed; dueDate null clears it. Works on open and done tasks.
export function updateTask(
  taskId: string, changes: { text?: string; category?: TaskCategory; dueDate?: string | null },
): Promise<TaskResult> {
  return mutateTask(taskId, (t) => {
    if (t.deletedAt) return DELETED;
    const next: Task = { ...t };
    if (changes.text !== undefined && changes.text.trim() !== t.text) {
      next.text = changes.text.trim();
      next.originalText = t.originalText ?? t.text;
    }
    if (changes.category !== undefined) next.category = changes.category;
    if (changes.dueDate !== undefined) next.dueDate = changes.dueDate ?? undefined;
    return next;
  });
}

export function setDueDate(taskId: string, dueDate: string | null): Promise<TaskResult> {
  return updateTask(taskId, { dueDate });
}

// Soft delete: the task stays stored (and keeps blocking re-extraction) but is hidden.
export function deleteTask(taskId: string): Promise<TaskResult> {
  return mutateTask(taskId, (t) => (t.deletedAt ? t : { ...t, deletedAt: new Date().toISOString() }));
}

// Undo a delete. duplicateOf is set when an open task with the same text was added since.
export async function restoreTask(taskId: string): Promise<TaskResult & { duplicateOf?: string }> {
  const r = await mutateTask(taskId, (t) => ({ ...t, deletedAt: undefined }));
  if ("error" in r) return r;
  const key = normalize(r.task.text);
  const siblings = r.meetingId
    ? (await readTasks(db(), r.meetingId))?.tasks ?? []
    : (await db().execute("SELECT * FROM standalone_tasks")).rows.map((row) => standaloneToTask(row as Record<string, unknown>));
  const dup = siblings.find((t) => t.id !== taskId && !t.deletedAt && !t.done && normalize(t.text) === key);
  return dup ? { ...r, duplicateOf: dup.id } : r;
}

// ── Listing ─────────────────────────────────────────────────────────────────

// Today's date in Madrid as YYYY-MM-DD (the server runs in UTC).
function todayInMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

function daysBetween(from: string, to: string): number {
  const utc = (d: string) => { const [y, m, day] = d.split("-").map(Number); return Date.UTC(y, m - 1, day); };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
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
  days_until_due: number | null;  // negative when overdue, 0 = due today (Madrid)
  is_overdue: boolean;
  age_days: number;
}

export interface DeletedTaskView extends TaskView { deleted_at: string }

// Every task (deleted ones included) with its meeting, as views.
async function allTaskViews(): Promise<{ t: Task; view: TaskView }[]> {
  await initDb();
  const client = db();
  const [meetings, standalone] = await Promise.all([
    client.execute("SELECT id, title, created_at, tasks FROM meetings WHERE tasks != '[]' ORDER BY created_at ASC"),
    client.execute("SELECT * FROM standalone_tasks"),
  ]);
  const today = todayInMadrid();
  const out: { t: Task; view: TaskView }[] = [];
  const add = (t: Task, meeting: { id: string | null; title: string; date: string }) => {
    const dueDate = t.dueDate ?? null;
    const daysUntilDue = dueDate ? daysBetween(today, dueDate) : null;
    out.push({ t, view: {
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
      days_until_due: daysUntilDue,
      is_overdue: !t.done && daysUntilDue !== null && daysUntilDue < 0,
      age_days: Math.floor((Date.now() - new Date(meeting.date).getTime()) / 86_400_000),
    } });
  };
  for (const r of meetings.rows) {
    let tasks: Task[] = [];
    try { tasks = JSON.parse(String(r.tasks)); } catch { continue; }
    for (const t of tasks) add(t, { id: String(r.id), title: String(r.title), date: String(r.created_at) });
  }
  for (const r of standalone.rows) {
    const t = standaloneToTask(r as Record<string, unknown>);
    add(t, { id: null, title: OWN_TASK_TITLE, date: t.createdAt! });
  }
  return out;
}

// Open tasks plus tasks completed within the given window, deleted tasks excluded.
// Standalone tasks are merged in by creation date. sort "age" (default): oldest first;
// "due": overdue first, then nearest due date, then tasks without a date (oldest first within ties).
export async function listTasks(
  opts: { doneSinceHours?: number; sort?: "age" | "due" } = {},
): Promise<{ open: TaskView[]; recently_done: TaskView[] }> {
  const since = opts.doneSinceHours ? Date.now() - opts.doneSinceHours * 3_600_000 : null;
  const open: TaskView[] = [];
  const recentlyDone: TaskView[] = [];
  for (const { t, view } of await allTaskViews()) {
    if (t.deletedAt) continue;
    if (!t.done) open.push(view);
    else if (since && t.doneAt && new Date(t.doneAt).getTime() >= since) recentlyDone.push(view);
  }
  const byAge = (a: TaskView, b: TaskView) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime();
  const byDue = (a: TaskView, b: TaskView) =>
    (a.days_until_due ?? Infinity) - (b.days_until_due ?? Infinity) || byAge(a, b);
  const order = opts.sort === "due" ? byDue : byAge;
  return { open: open.sort(order), recently_done: recentlyDone.sort(order) };
}

// Tasks deleted within the last `days` days, most recently deleted first.
export async function listDeletedTasks(days = 30): Promise<DeletedTaskView[]> {
  const since = Date.now() - days * 86_400_000;
  return (await allTaskViews())
    .filter(({ t }) => t.deletedAt && new Date(t.deletedAt).getTime() >= since)
    .map(({ t, view }) => ({ ...view, deleted_at: t.deletedAt! }))
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}
