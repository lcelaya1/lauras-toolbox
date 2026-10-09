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
  meeting_id: string;
  meeting_title: string;
  meeting_date: string;
  age_days: number;
}

const CATEGORIES: Record<string, string> = {
  FG: "Future Game", COPSUP: "COP / SUP", VEN: "Ventures", "4o": "4o", WF: "Workshop Fundamentals",
  OPS: "Operaciones", PFGs: "PFGs", TiB: "Tech in Biz",
};

const DONE_BY: Record<string, string> = { laura: "tú", claude: "Claude", reminders: "Recordatorios" };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
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
      setOpen((prev) => [...(prev ?? []), { ...t, done: false }].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)));
    }
    await fetch("/api/tasks/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: t.task_id, done: next }),
    });
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of open ?? []) c[t.category ?? "OPS"] = (c[t.category ?? "OPS"] ?? 0) + 1;
    return c;
  }, [open]);

  const visibleOpen = (open ?? []).filter((t) => category === "all" || (t.category ?? "OPS") === category);
  const visibleDone = done.filter((t) => category === "all" || (t.category ?? "OPS") === category);

  return (
    <div className="px-8 py-10 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Mis tareas</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tareas tuyas extraídas de las reuniones. Las más antiguas primero.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        <FilterChip active={category === "all"} onClick={() => setCategory("all")} label={`Todas · ${open?.length ?? 0}`} />
        {Object.entries(counts).sort().map(([c, n]) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)} label={`${CATEGORIES[c] ?? c} · ${n}`} />
        ))}
      </div>

      <section className="mb-10">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Pendientes</h2>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {open === null ? (
            <p className="px-5 py-6 text-sm text-gray-400">Cargando…</p>
          ) : visibleOpen.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500">No hay tareas pendientes. 🎉</p>
          ) : visibleOpen.map((t) => <TaskRow key={t.task_id} t={t} onToggle={toggle} />)}
        </div>
      </section>

      {visibleDone.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Hechas en las últimas 2 semanas</h2>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {visibleDone.map((t) => <TaskRow key={t.task_id} t={t} onToggle={toggle} />)}
          </div>
        </section>
      )}
    </div>
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

function TaskRow({ t, onToggle }: { t: TaskView; onToggle: (t: TaskView) => void }) {
  const old = !t.done && t.age_days >= 14;
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <input type="checkbox" checked={t.done} onChange={() => onToggle(t)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-indigo-600" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug ${t.done ? "text-gray-400 line-through" : "text-gray-900"}`}>{t.text}</p>
        <p className="mt-1 text-xs text-gray-400">
          <span className="font-semibold text-indigo-600">{t.category ?? "OPS"}</span>
          {" · "}{t.meeting_title} · {formatDate(t.meeting_date)}
          {!t.done && <span className={old ? "text-amber-600" : ""}> · {ageLabel(t.age_days)}</span>}
          {t.done && t.done_at && <> · hecha {formatDate(t.done_at)} por {DONE_BY[t.done_by ?? ""] ?? "ti"}</>}
        </p>
        {t.done && t.done_by === "claude" && t.done_evidence && (
          <p className="mt-1 text-xs text-indigo-500">Motivo: {t.done_evidence}</p>
        )}
      </div>
    </div>
  );
}
