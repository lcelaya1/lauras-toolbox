"use client";

import { useEffect, useRef, useState } from "react";
import type { MeetingMeta, Task, TaskCategory } from "@/lib/meetings-store";

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  FG:     "Future Game",
  COPSUP: "COP / SUP",
  VEN:    "Ventures",
  "4o":   "4o",
  WF:     "Workshop Fundamentals",
  OPS:    "Operations",
  PFGs:   "PFGs",
  TiB:    "Tech in Biz",
};

const CATEGORY_ORDER: TaskCategory[] = ["FG", "COPSUP", "VEN", "4o", "WF", "OPS", "PFGs", "TiB"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function summaryPreview(text: string, maxLen = 80) {
  if (!text) return "Sin resumen";
  const plain = text.replace(/^#+\s*/gm, "").replace(/^[-*]\s*/gm, "").trim();
  return plain.length > maxLen ? plain.slice(0, maxLen).trimEnd() + "…" : plain;
}

// Renders Granola's markdown (### headings, - bullets, nested bullets)
function MarkdownNotes({ markdown }: { markdown: string }) {
  if (!markdown) return <p className="text-sm text-gray-400 italic">Sin resumen disponible.</p>;

  // Strip trailing Granola chat link
  const clean = markdown.replace(/\n---\n[\s\S]*$/, "").trim();

  const lines = clean.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="text-sm font-semibold text-gray-900 mt-5 mb-2 first:mt-0">
          {line.slice(4)}
        </h3>,
      );
      i++;
    } else if (/^(\d+\. |- )/.test(line)) {
      // Collect a block of list items
      const items: { text: string; level: number }[] = [];
      while (i < lines.length && /^(\s*[-*]|\s*\d+\. )/.test(lines[i])) {
        const raw = lines[i];
        const level = raw.match(/^(\s*)/)?.[1].length ?? 0;
        const text = raw.replace(/^\s*[-*]\s*/, "").replace(/^\s*\d+\.\s*/, "");
        items.push({ text, level });
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="text-sm text-gray-800 leading-relaxed space-y-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-1.5" style={{ paddingLeft: `${item.level * 0.75}rem` }}>
              <span className="text-gray-300 shrink-0 mt-0.5">{item.level > 0 ? "○" : "•"}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>,
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      elements.push(
        <p key={i} className="text-sm text-gray-800 leading-relaxed">{line}</p>,
      );
      i++;
    }
  }

  return <div className="flex flex-col gap-1">{elements}</div>;
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingMeta[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("meetings_selected_id");
  });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tareas" | "notas">("tareas");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<{ meetingId: string; index: number } | null>(null);
  const [editingTaskText, setEditingTaskText] = useState("");
  const cancelTaskEditRef = useRef(false);
  const [categoryDropdown, setCategoryDropdown] = useState<{ meetingId: string; index: number } | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState<TaskCategory>("OPS");
  const [showCategoryPickerForNew, setShowCategoryPickerForNew] = useState(false);

  useEffect(() => {
    if (selectedId) localStorage.setItem("meetings_selected_id", selectedId);
    else localStorage.removeItem("meetings_selected_id");
  }, [selectedId]);

  function showReminderStatus(msg: string) {
    setReminderStatus(msg);
    setTimeout(() => setReminderStatus(null), 3500);
  }

  async function openShortcut(name: string, payload: string) {
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      alert("No se pudo copiar al portapapeles. Asegúrate de dar permiso al navegador.");
      return;
    }
    showReminderStatus("📋 Copiado — abriendo Shortcuts…");
    window.open(`shortcuts://run-shortcut?name=${encodeURIComponent(name)}`, "_self");
  }

  async function load(): Promise<string | null> {
    setLoading(true);
    try {
      const res = await fetch("/api/meetings");
      const data = await res.json();
      const meetings: MeetingMeta[] = data.meetings ?? [];

      // Backfill missing task IDs (tasks saved before the id field was added)
      for (const m of meetings) {
        const missing = m.tasks.some((t) => !t.id);
        if (missing) {
          const fixed = m.tasks.map((t) => ({ ...t, id: t.id || crypto.randomUUID() }));
          await fetch(`/api/meetings/${m.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: fixed }),
          });
          m.tasks = fixed;
        }
      }

      setMeetings(meetings);
      setLastSyncedAt(data.lastSyncedAt ?? null);
      return data.lastSyncedAt ?? null;
    } catch {
      setMeetings([]);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().then((syncedAt) => {
      const stale = !syncedAt || Date.now() - new Date(syncedAt).getTime() > 24 * 60 * 60 * 1000;
      if (stale) handleSync();
    });
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/meetings", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al sincronizar");
      const msg = `✓ ${data.added} nueva${data.added !== 1 ? "s" : ""}, ${data.updated} actualizadas`;
      setSyncResult(msg);
      setTimeout(() => setSyncResult(null), 4000);
      await load();
    } catch (err) {
      setSyncResult(`Error: ${err instanceof Error ? err.message : "desconocido"}`);
    }
    setSyncing(false);
  }

  async function handleAddManual() {
    if (!newTitle.trim() || !newDate) return;
    setSaving(true);
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manual: true,
        title: newTitle.trim(),
        createdAt: new Date(newDate).toISOString(),
        summaryMarkdown: newNotes.trim(),
      }),
    });
    const created = await res.json();
    setMeetings((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setAdding(false);
    setNewTitle(""); setNewDate(""); setNewNotes("");
    setSaving(false);
  }

  async function handleSaveNotes() {
    if (!selected) return;
    setSavingNotes(true);
    await fetch(`/api/meetings/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summaryMarkdown: notesDraft }),
    });
    setMeetings((prev) => prev.map((m) => m.id === selected.id ? { ...m, summaryMarkdown: notesDraft } : m));
    setEditingNotes(false);
    setSavingNotes(false);
  }

  async function handleDelete(id: string) {
    if (confirming !== id) { setConfirming(id); return; }
    await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    setConfirming(null);
    if (selectedId === id) setSelectedId(null);
    await load();
  }

  async function handleToggleTask(meetingId: string, index: number) {
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const updated: Task[] = meeting.tasks.map((t, i) => i === index ? { ...t, done: !t.done } : t);
    setMeetings((prev) => prev.map((m) => m.id === meetingId ? { ...m, tasks: updated } : m));
    await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: updated }),
    });
  }

  async function handleDeleteTask(meetingId: string, index: number) {
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const updated: Task[] = meeting.tasks.filter((_, i) => i !== index);
    setMeetings((prev) => prev.map((m) => m.id === meetingId ? { ...m, tasks: updated } : m));
    await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: updated }),
    });
  }

  async function handleUpdateTaskCategory(meetingId: string, index: number, category: TaskCategory) {
    setCategoryDropdown(null);
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const updated: Task[] = meeting.tasks.map((t, i) => i === index ? { ...t, category } : t);
    setMeetings((prev) => prev.map((m) => m.id === meetingId ? { ...m, tasks: updated } : m));
    await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: updated }),
    });
  }

  async function handleAddTask() {
    const text = newTaskText.trim();
    if (!text || !selected) return;
    setAddingTask(false);
    setNewTaskText("");
    const newTask: Task = { id: crypto.randomUUID(), text, done: false, category: newTaskCategory };
    const updated = [...selected.tasks, newTask];
    setMeetings((prev) => prev.map((m) => m.id === selected.id ? { ...m, tasks: updated } : m));
    await fetch(`/api/meetings/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: updated }),
    });
  }

  async function handleSaveTaskEdit(meetingId: string, index: number) {
    const text = editingTaskText.trim();
    setEditingTask(null);
    if (!text) return;
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const updated: Task[] = meeting.tasks.map((t, i) => i === index ? { ...t, text } : t);
    setMeetings((prev) => prev.map((m) => m.id === meetingId ? { ...m, tasks: updated } : m));
    await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: updated }),
    });
  }

  const selected = meetings.find((m) => m.id === selectedId) ?? null;

  // Parse attendees from rawJson
  let attendees: string[] = [];
  if (selected?.rawJson) {
    try {
      const raw = JSON.parse(selected.rawJson);
      const people = raw.attendees ?? raw.participants ?? [];
      attendees = Array.isArray(people)
        ? people.map((p: { name?: string; email?: string } | string) =>
            typeof p === "string" ? p : (p.name ?? p.email ?? "")
          ).filter(Boolean)
        : [];
    } catch { /* ignore */ }
  }

  return (
    <div className="flex h-full">

      {/* ── Left panel ── */}
      <div className="w-72 shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900">Mis reuniones</h1>
            {lastSyncedAt ? (
              <p className="text-[10px] text-gray-400 mt-0.5">Sync: {formatDate(lastSyncedAt)}</p>
            ) : (
              <p className="text-[10px] text-gray-400 mt-0.5">Sin sincronizar</p>
            )}
          </div>
          <button onClick={handleSync} title="Sincronizar con Granola"
            className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5 shrink-0">
            <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}>
              <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Meeting list */}
        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <svg className="animate-spin h-4 w-4 text-gray-300" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          ) : meetings.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-gray-400">No hay reuniones guardadas.</p>
              <p className="text-xs text-gray-300 mt-1">Haz clic en &quot;Sincronizar&quot;</p>
            </div>
          ) : (
            meetings.map((m) => (
              <button
                key={m.id}
                onClick={() => { setSelectedId(m.id); setConfirming(null); setEditingNotes(false); setAdding(false); setActiveTab("tareas"); setAddingTask(false); setNewTaskText(""); }}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors
                  ${selectedId === m.id ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-100"}`}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5">
                  <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{formatDateShort(m.createdAt)}</p>
                </div>
                {m.tasks.some(t => !t.done) && (
                  <span className="shrink-0 mt-1 w-2 h-2 rounded-full bg-indigo-400" title="Tiene tareas pendientes" />
                )}
              </button>
            ))
          )}
        </div>

        {/* New meeting button */}
        <div className="border-t border-gray-100">
          <button
            onClick={() => { setAdding(true); setSelectedId(null); setConfirming(null); }}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors
              ${adding ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-100"}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor"
              className={`w-4 h-4 shrink-0 ${adding ? "text-indigo-500" : "text-gray-400"}`}>
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            <span className={`text-sm font-medium ${adding ? "text-indigo-700" : "text-gray-700"}`}>
              Añadir reunión
            </span>
          </button>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {adding ? (
          <div className="flex-1 overflow-y-auto px-8 py-6 max-w-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-5">Nueva reunión</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">Título</label>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Nombre de la reunión"
                  className="w-full text-sm text-gray-900 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">Fecha</label>
                <input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full text-sm text-gray-900 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">Notas</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Pega aquí las notas de la reunión…"
                  className="w-full h-56 text-sm text-gray-800 border border-gray-200 rounded-xl p-3 resize-none outline-none focus:border-indigo-400 leading-relaxed"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddManual}
                  disabled={saving || !newTitle.trim() || !newDate}
                  className="text-sm px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors"
                >
                  {saving ? "Guardando…" : "Guardar reunión"}
                </button>
                <button
                  onClick={() => { setAdding(false); setNewTitle(""); setNewDate(""); setNewNotes(""); }}
                  className="text-sm px-5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">

            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-gray-300">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">
              {meetings.length === 0 ? "Sincroniza desde Granola para ver tus reuniones" : "Selecciona una reunión"}
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-8 py-5 border-b border-gray-100 flex items-start justify-between gap-4 shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-gray-900 leading-snug">{selected.title}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(selected.createdAt)}</p>
              </div>
              <button
                onClick={() => handleDelete(selected.id)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                  ${confirming === selected.id
                    ? "bg-red-100 text-red-600 hover:bg-red-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
              >
                {confirming === selected.id ? "¿Segura?" : "Eliminar"}
              </button>
            </div>

            {/* Tabs bar */}
            <div className="px-8 border-b border-gray-100 flex gap-1 shrink-0">
              {(["tareas", "notas"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); setEditingNotes(false); }}
                  className={`px-4 py-2.5 text-xs font-semibold capitalize transition-colors border-b-2 -mb-px
                    ${activeTab === tab
                      ? "border-indigo-500 text-indigo-600"
                      : "border-transparent text-gray-400 hover:text-gray-600"}`}
                >
                  {tab === "tareas" && selected.tasks.length > 0
                    ? `Tareas (${selected.tasks.filter(t => t.done).length}/${selected.tasks.length})`
                    : tab === "tareas" ? "Tareas" : "Notas"}
                </button>
              ))}
            </div>

            {/* Reminder status toast */}
            {reminderStatus && (
              <div className="mx-8 mt-3 px-4 py-2.5 rounded-xl bg-green-50 border border-green-100 text-sm text-green-700 font-medium shrink-0">
                {reminderStatus}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6">

              {/* Attendees — always visible */}
              {attendees.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Asistentes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {attendees.map((name) => (
                      <span key={name} className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks tab */}
              {activeTab === "tareas" && (
                <div>
                  {selected.tasks.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      No hay tareas todavía. Pídele a Claude que extraiga las tareas de esta reunión.
                    </p>
                  ) : (<>
                  {selected.tasks.some(t => !t.done) && (
                    <div className="mb-4">
                      <button
                        onClick={async () => {
                          const res = await fetch(`/api/tasks/all-reminder-links?meetingId=${selected.id}`);
                          const { payload, count } = await res.json();
                          if (count === 0) return;
                          const tasks = (JSON.parse(payload) as { tasks: { name: string; notes: string }[] }).tasks;

                          if (window.location.hostname === "localhost") {
                            // Local: osascript creates date-only reminders directly
                            const local = await fetch("/api/tasks/send-to-reminders", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ tasks }),
                            });
                            if (local.ok) {
                              showReminderStatus(`✓ ${tasks.length} recordatorio${tasks.length !== 1 ? "s" : ""} añadido${tasks.length !== 1 ? "s" : ""}`);
                            } else {
                              const err = await local.json().catch(() => ({}));
                              alert(`No se pudieron enviar a Reminders.\n\n${err.detail ?? err.error ?? "Error desconocido"}`);
                            }
                          } else {
                            // Vercel: clipboard → Shortcuts
                            await openShortcut("Añadir todas a Reminders", payload);
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-500 font-medium transition-colors"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                          <path fillRule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9 1V5.5a1 1 0 0 0-2 0v4a1 1 0 0 0 .553.894l2.5 1.25a1 1 0 0 0 .894-1.788L9 9Z" clipRule="evenodd"/>
                        </svg>
                        Enviar todas a Reminders ({selected.tasks.filter(t => !t.done).length})
                      </button>
                    </div>
                  )}
                  {(() => {
                    const grouped = new Map<string, { task: Task; index: number }[]>();
                    selected.tasks.forEach((task, i) => {
                      const cat = task.category ?? "OPS";
                      if (!grouped.has(cat)) grouped.set(cat, []);
                      grouped.get(cat)!.push({ task, index: i });
                    });
                    const orderedKeys = [
                      ...CATEGORY_ORDER.filter((c) => grouped.has(c)),
                      ...[...grouped.keys()].filter((c) => !CATEGORY_ORDER.includes(c as TaskCategory)),
                    ];
                    return (
                      <div className="flex flex-col gap-5">
                        {orderedKeys.map((cat) => (
                          <div key={cat}>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                              {CATEGORY_LABELS[cat as TaskCategory] ?? cat}
                            </p>
                            <ul className="flex flex-col gap-1.5">
                              {grouped.get(cat)!.map(({ task, index: i }) => (
                                <li key={i} className="group flex items-start gap-2.5">
                                  <button
                                    onClick={() => handleToggleTask(selected.id, i)}
                                    className={`mt-[4px] w-4 h-4 shrink-0 rounded border transition-colors flex items-center justify-center
                                      ${task.done
                                        ? "bg-indigo-600 border-indigo-600"
                                        : "border-gray-300 hover:border-indigo-400 bg-white"}`}
                                  >
                                    {task.done && (
                                      <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </button>
                                  {editingTask?.meetingId === selected.id && editingTask?.index === i ? (
                                    <>
                                      <span className="text-sm font-semibold text-gray-400 shrink-0 py-0.5 leading-snug">{cat} —</span>
                                      <textarea
                                        autoFocus
                                        rows={1}
                                        value={editingTaskText}
                                        ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                                        onChange={(e) => {
                                          setEditingTaskText(e.target.value);
                                          e.target.style.height = "auto";
                                          e.target.style.height = e.target.scrollHeight + "px";
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveTaskEdit(selected.id, i); }
                                          if (e.key === "Escape") { cancelTaskEditRef.current = true; setEditingTask(null); }
                                        }}
                                        onBlur={() => {
                                          if (cancelTaskEditRef.current) { cancelTaskEditRef.current = false; return; }
                                          handleSaveTaskEdit(selected.id, i);
                                        }}
                                        className="flex-1 min-w-0 text-sm text-gray-800 border-b border-indigo-400 outline-none bg-transparent py-0.5 resize-none overflow-hidden leading-snug"
                                      />
                                    </>
                                  ) : (
                                    <>
                                      {/* Category label with dropdown */}
                                      <span className="relative shrink-0">
                                        {task.done ? (
                                          <span className="text-sm font-semibold text-gray-400">{cat} —</span>
                                        ) : (
                                          <>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setCategoryDropdown(categoryDropdown?.index === i && categoryDropdown?.meetingId === selected.id ? null : { meetingId: selected.id, index: i }); }}
                                              className="text-sm font-semibold text-gray-400 hover:text-indigo-500 transition-colors"
                                            >
                                              {cat} —
                                            </button>
                                            {categoryDropdown?.meetingId === selected.id && categoryDropdown?.index === i && (
                                              <>
                                                <div className="fixed inset-0 z-[5]" onClick={() => setCategoryDropdown(null)} />
                                                <div className="absolute left-0 top-5 z-10 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-48">
                                                  {CATEGORY_ORDER.map((c) => (
                                                    <button
                                                      key={c}
                                                      onClick={() => handleUpdateTaskCategory(selected.id, i, c)}
                                                      className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-indigo-50
                                                        ${c === (task.category ?? "OPS") ? "text-indigo-600" : "text-gray-600"}`}
                                                    >
                                                      {c}
                                                    </button>
                                                  ))}
                                                </div>
                                              </>
                                            )}
                                          </>
                                        )}
                                      </span>
                                      {/* Task text */}
                                      <span
                                        onClick={() => { if (!task.done) { setEditingTask({ meetingId: selected.id, index: i }); setEditingTaskText(task.text); } }}
                                        className={`flex-1 text-sm leading-snug mt-[2px] ${task.done ? "line-through text-gray-400" : "text-gray-800 cursor-text hover:text-indigo-700"}`}
                                      >
                                        {task.text}
                                      </span>
                                    </>
                                  )}
                                  {!task.done && <button
                                    onClick={async () => {
                                      const params = new URLSearchParams({
                                        taskId: task.id,
                                        meetingId: selected.id,
                                        name: `${cat} - ${task.text}`,
                                      });
                                      const linkRes = await fetch(`/api/tasks/reminder-link?${params}`);
                                      const { payload } = await linkRes.json();
                                      const parsed = JSON.parse(payload);

                                      if (window.location.hostname === "localhost") {
                                        // Local: osascript creates date-only reminder directly
                                        const local = await fetch("/api/tasks/send-to-reminders", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ name: parsed.name, notes: parsed.notes }),
                                        });
                                        if (local.ok) {
                                          showReminderStatus("✓ Recordatorio añadido");
                                        } else {
                                          const err = await local.json().catch(() => ({}));
                                          alert(`No se pudo enviar a Reminders.\n\n${err.detail ?? err.error ?? "Error desconocido"}`);
                                        }
                                      } else {
                                        // Vercel: clipboard → Shortcuts
                                        await openShortcut("Añadir a Reminders", payload);
                                      }
                                    }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-orange-400 mt-0.5 shrink-0"
                                    title="Enviar a Reminders"
                                  >
                                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                      <path fillRule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9 1V5.5a1 1 0 0 0-2 0v4a1 1 0 0 0 .553.894l2.5 1.25a1 1 0 0 0 .894-1.788L9 9Z" clipRule="evenodd"/>
                                    </svg>
                                  </button>}
                                  <button
                                    onClick={() => handleDeleteTask(selected.id, i)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 mt-0.5 shrink-0"
                                    title="Eliminar tarea"
                                  >
                                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                      <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 6.932A1.75 1.75 0 0 0 5.61 14h4.78a1.75 1.75 0 0 0 1.745-1.568L12.95 5.5h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  </>
                  )}

                  {/* Add task */}
                  {addingTask ? (
                    <div className="flex items-start gap-2.5 mt-3">
                      <div className="mt-[4px] w-4 h-4 shrink-0 rounded border border-gray-200" />
                      <span className="relative shrink-0">
                        <button
                          onClick={() => setShowCategoryPickerForNew(!showCategoryPickerForNew)}
                          className="text-sm font-semibold text-gray-400 hover:text-indigo-500 transition-colors"
                        >
                          {newTaskCategory} —
                        </button>
                        {showCategoryPickerForNew && (
                          <>
                            <div className="fixed inset-0 z-[5]" onClick={() => setShowCategoryPickerForNew(false)} />
                            <div className="absolute left-0 top-5 z-10 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-48">
                              {CATEGORY_ORDER.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => { setNewTaskCategory(c); setShowCategoryPickerForNew(false); }}
                                  className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-indigo-50
                                    ${c === newTaskCategory ? "text-indigo-600" : "text-gray-600"}`}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </span>
                      <textarea
                        autoFocus
                        rows={1}
                        value={newTaskText}
                        ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                        onChange={(e) => { setNewTaskText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddTask(); }
                          if (e.key === "Escape") { setAddingTask(false); setNewTaskText(""); }
                        }}
                        onBlur={() => { if (newTaskText.trim()) handleAddTask(); else setAddingTask(false); }}
                        placeholder="Nueva tarea…"
                        className="flex-1 min-w-0 text-sm text-gray-800 border-b border-indigo-400 outline-none bg-transparent py-0.5 resize-none overflow-hidden leading-snug placeholder:text-gray-300 mt-[2px]"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingTask(true)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-500 transition-colors mt-3"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M8.75 3.75a.75.75 0 00-1.5 0v3.5h-3.5a.75.75 0 000 1.5h3.5v3.5a.75.75 0 001.5 0v-3.5h3.5a.75.75 0 000-1.5h-3.5v-3.5z" />
                      </svg>
                      Añadir tarea
                    </button>
                  )}
                </div>
              )}

              {/* Notes tab */}
              {activeTab === "notas" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Notas</p>
                  {!editingNotes && (
                    <button
                      onClick={() => { setNotesDraft(selected.summaryMarkdown); setEditingNotes(true); }}
                      className="text-[10px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 font-medium transition-colors"
                    >
                      Editar
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      autoFocus
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      className="w-full h-64 text-sm text-gray-800 border border-gray-200 rounded-xl p-3 resize-none outline-none focus:border-indigo-400 leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveNotes}
                        disabled={savingNotes}
                        className="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors"
                      >
                        {savingNotes ? "Guardando…" : "Guardar"}
                      </button>
                      <button
                        onClick={() => setEditingNotes(false)}
                        className="text-xs px-4 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <MarkdownNotes markdown={selected.summaryMarkdown || selected.summary} />
                )}
                <p className="text-[10px] text-gray-300 mt-4">
                  Guardado el {formatDate(selected.syncedAt)}
                </p>
              </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
