"use client";

import { useEffect, useMemo, useState } from "react";

interface TaskView {
  task_id: string;
  text: string;
  category: string | null;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  done_evidence: string | null;
  source?: "meeting" | "manual";
  meeting_id: string | null;
  meeting_title: string;
  meeting_date: string;
  due_date?: string | null;
  days_until_due?: number | null;
  is_overdue?: boolean;
  age_days: number;
}

type SortMode = "age" | "due";

const CATEGORIES: Record<string, string> = {
  FG: "Future Game", COPSUP: "COP / SUP", VEN: "Ventures", "4o": "4o", WF: "Workshop Fundamentals",
  OPS: "Operaciones", PFGs: "PFGs", TiB: "Tech in Biz",
};

const DONE_BY: Record<string, string> = { laura: "tú", claude: "Claude", reminders: "Recordatorios" };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// due is YYYY-MM-DD; parse as a local date so it doesn't shift a day in Madrid
function formatDue(due: string) {
  const [y, m, d] = due.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function todayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

const byAge = (a: TaskView, b: TaskView) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime();

// Overdue first, then nearest due date, then tasks without a date (oldest first within ties).
// YYYY-MM-DD strings compare correctly as text.
function byDue(a: TaskView, b: TaskView) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date) || byAge(a, b);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return byAge(a, b);
}

function ageLabel(days: number) {
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 14) return `hace ${days} días`;
  return `hace ${Math.floor(days / 7)} semanas`;
}

export default function TasksPage() {
  const [open, setOpen] = useState<TaskView[] | null>(null);
  const [done, setDone] = useState<TaskView[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("age");

  async function load() {
    const res = await fetch("/api/tasks/list", { cache: "no-store" });
    const data = await res.json();
    setOpen(data.open ?? []);
    setDone((data.recently_done ?? []).sort((a: TaskView, b: TaskView) => (b.done_at ?? "").localeCompare(a.done_at ?? "")));
  }

  useEffect(() => { load(); }, []);

  async function toggle(t: TaskView) {
    const next = !t.done;
    // Optimistic update
    if (next) {
      setOpen((prev) => prev?.filter((x) => x.task_id !== t.task_id) ?? null);
      setDone((prev) => [{ ...t, done: true, done_by: "laura", done_at: new Date().toISOString(), done_evidence: null }, ...prev]);
    } else {
      setDone((prev) => prev.filter((x) => x.task_id !== t.task_id));
      setOpen((prev) => [...(prev ?? []), { ...t, done: false }]);
    }
    await fetch("/api/tasks/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: t.task_id, done: next }),
    });
  }

  async function changeDue(t: TaskView, dueDate: string | null) {
    const patch = (list: TaskView[]) => list.map((x) => x.task_id === t.task_id ? { ...x, due_date: dueDate } : x);
    setOpen((prev) => prev && patch(prev));
    setDone((prev) => patch(prev));
    const res = await fetch("/api/tasks/due-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: t.task_id, dueDate }),
    });
    if (!res.ok) await load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of open ?? []) c[t.category ?? "OPS"] = (c[t.category ?? "OPS"] ?? 0) + 1;
    return c;
  }, [open]);

  const visibleOpen = (open ?? []).filter((t) => category === "all" || (t.category ?? "OPS") === category)
    .sort(sort === "due" ? byDue : byAge);
  const visibleDone = done.filter((t) => category === "all" || (t.category ?? "OPS") === category);

  return (
    <div className="px-8 py-10 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Mis tareas</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tareas tuyas de las reuniones y las que añades tú.
        </p>
      </div>

      <AddTaskForm onAdded={load} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={category === "all"} onClick={() => setCategory("all")} label={`Todas · ${open?.length ?? 0}`} />
          {Object.entries(counts).sort().map(([c, n]) => (
            <FilterChip key={c} active={category === c} onClick={() => setCategory(c)} label={`${CATEGORIES[c] ?? c} · ${n}`} />
          ))}
        </div>
        <div className="flex shrink-0 rounded-lg bg-gray-100 p-0.5 text-xs font-medium" role="group" aria-label="Ordenar">
          {([["age", "Más antiguas"], ["due", "Fecha límite"]] as const).map(([mode, label]) => (
            <button key={mode} onClick={() => setSort(mode)} aria-pressed={sort === mode}
              className={`rounded-md px-2.5 py-1 transition-colors ${sort === mode ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="mb-10">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Pendientes</h2>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {open === null ? (
            <p className="px-5 py-6 text-sm text-gray-400">Cargando…</p>
          ) : visibleOpen.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500">No hay tareas pendientes. 🎉</p>
          ) : visibleOpen.map((t) => <TaskRow key={t.task_id} t={t} onToggle={toggle} onDueChange={changeDue} />)}
        </div>
      </section>

      {visibleDone.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Hechas en las últimas 2 semanas</h2>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {visibleDone.map((t) => <TaskRow key={t.task_id} t={t} onToggle={toggle} onDueChange={changeDue} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function AddTaskForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("OPS");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3 || saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/tasks/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), category, dueDate: dueDate || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "No se pudo añadir la tarea");
      return;
    }
    setText("");
    setDueDate("");
    await onAdded();
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir tarea…" maxLength={500}
          className="min-w-0 flex-1 basis-60 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría"
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none">
          {Object.entries(CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Fecha límite (opcional)"
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none" />
        <button type="submit" disabled={saving || text.trim().length < 3}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
          {saving ? "Añadiendo…" : "Añadir"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
      {label}
    </button>
  );
}

function TaskRow({ t, onToggle, onDueChange }: {
  t: TaskView; onToggle: (t: TaskView) => void; onDueChange: (t: TaskView, dueDate: string | null) => void;
}) {
  const old = !t.done && t.age_days >= 14;
  const own = t.source === "manual";
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <input type="checkbox" checked={t.done} onChange={() => onToggle(t)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-indigo-600" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug ${t.done ? "text-gray-400 line-through" : "text-gray-900"}`}>{t.text}</p>
        <p className="mt-1 text-xs text-gray-400">
          <span className="font-semibold text-indigo-600">{t.category ?? "OPS"}</span>
          {" · "}
          {own
            ? <span className="rounded bg-gray-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-gray-500">Own</span>
            : t.meeting_title}
          {" · "}{formatDate(t.meeting_date)}
          {!t.done && <span className={old ? "text-amber-600" : ""}> · {ageLabel(t.age_days)}</span>}
          {t.done && t.done_at && <> · hecha {formatDate(t.done_at)} por {DONE_BY[t.done_by ?? ""] ?? "ti"}</>}
          {" · "}<DueDate t={t} onChange={(d) => onDueChange(t, d)} />
        </p>
        {t.done && t.done_by === "claude" && t.done_evidence && (
          <p className="mt-1 text-xs text-indigo-500">Motivo: {t.done_evidence}</p>
        )}
      </div>
    </div>
  );
}

// Shows the due date (red when overdue, amber when due today) and edits it inline.
function DueDate({ t, onChange }: { t: TaskView; onChange: (dueDate: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const due = t.due_date ?? null;

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input type="date" autoFocus defaultValue={due ?? ""} aria-label="Fecha límite"
          onChange={(e) => { if (e.target.value) { onChange(e.target.value); setEditing(false); } }}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
          className="rounded border border-gray-200 px-1 py-px text-xs text-gray-700 focus:border-indigo-400 focus:outline-none" />
        {due && <button onClick={() => { onChange(null); setEditing(false); }} className="text-gray-500 hover:text-red-600">quitar</button>}
        <button onClick={() => setEditing(false)} aria-label="Cancelar" className="text-gray-400 hover:text-gray-600">✕</button>
      </span>
    );
  }

  if (!due) {
    return <button onClick={() => setEditing(true)} className="text-gray-300 hover:text-indigo-600">+ fecha</button>;
  }

  const today = todayKey();
  const tone = t.done ? "text-gray-400"
    : due < today ? "font-medium text-red-600"
    : due === today ? "font-medium text-amber-600"
    : "text-gray-500";
  const label = !t.done && due === today ? "vence hoy" : `vence ${formatDue(due)}`;
  return (
    <button onClick={() => setEditing(true)} title="Cambiar fecha límite" className={`${tone} hover:underline`}>
      {label}{!t.done && due < today && " · vencida"}
    </button>
  );
}
