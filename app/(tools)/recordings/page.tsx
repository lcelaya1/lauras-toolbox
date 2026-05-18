"use client";

import { useEffect, useRef, useState } from "react";
import type { RecordingMeta } from "@/lib/blob-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

function downloadTxt(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(name: string, date: string, text: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${name}</title>
    <style>
      body{font-family:Georgia,serif;max-width:680px;margin:48px auto;padding:0 24px;color:#111;line-height:1.7}
      h1{font-size:20px;font-weight:600;margin:0 0 6px}
      .meta{font-size:12px;color:#888;margin-bottom:32px}
      p{font-size:14px;white-space:pre-wrap;margin:0}
      @media print{body{margin:0;padding:24px}}
    </style></head><body>
    <h1>${name}</h1><div class="meta">${date} · Transcripción</div>
    <p>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
    <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`);
  win.document.close();
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numSamples = buffer.length;
  const out = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(out);
  const s = (o: number, v: string) => { for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i)); };
  s(0, "RIFF"); view.setUint32(4, out.byteLength - 8, true);
  s(8, "WAVE"); s(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  s(36, "data"); view.setUint32(40, numSamples * 2, true);
  // Mix all channels to mono
  const ch: Float32Array[] = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    let v = 0; for (const c of ch) v += c[i]; v /= ch.length;
    view.setInt16(off, Math.max(-1, Math.min(1, v)) * (v < 0 ? 0x8000 : 0x7FFF), true);
    off += 2;
  }
  return out;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms?: number) {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ─── Upload panel ────────────────────────────────────────────────────────────

interface UploadedFile {
  id: string;        // local UI id
  recId: string | null; // id in the recordings index (set after registration)
  name: string;
  file: File;
  status: "idle" | "uploading" | "done" | "error";
  error: string;
}

function UploadPanel({ onSaved }: { onSaved: () => void }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function upd(id: string, patch: Partial<UploadedFile>) {
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } : f));
  }

  async function processFile(uf: UploadedFile) {
    const mimeType = uf.file.type || "audio/mp4";
    const recId = crypto.randomUUID();
    const CHUNK = 3.5 * 1024 * 1024; // 3.5 MB — safely under Vercel's 4.5 MB limit
    const totalChunks = Math.max(1, Math.ceil(uf.file.size / CHUNK));

    // ── Upload file in chunks through Next.js (avoids R2 CORS entirely) ──
    upd(uf.id, { status: "uploading" });
    try {
      for (let i = 0; i < totalChunks; i++) {
        const slice = uf.file.slice(i * CHUNK, (i + 1) * CHUNK);
        const form = new FormData();
        form.append("chunk", new Blob([slice], { type: mimeType }), uf.file.name);
        form.append("id", recId);
        form.append("chunkIndex", String(i));
        form.append("totalChunks", String(totalChunks));
        form.append("mimeType", mimeType);
        if (i === totalChunks - 1) form.append("name", uf.name); // only needed on last chunk

        const res = await fetch("/api/recordings/upload", { method: "POST", body: form });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? `Error al subir parte ${i + 1}`);
        }
      }
    } catch (err) {
      upd(uf.id, { status: "error", error: err instanceof Error ? err.message : "Error al subir" });
      return;
    }

    upd(uf.id, { recId, status: "done" });
    onSaved(); // recording now visible in left panel — transcribe from there if needed
  }

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    const added: UploadedFile[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      recId: null,
      name: file.name.replace(/\.[^.]+$/, ""),
      file,
      status: "idle" as const,
      error: "",
    }));
    setFiles((prev) => [...prev, ...added]);
    if (added.length > 0 && !selectedId) setSelectedId(added[0].id);
    added.forEach((f) => processFile(f));
  }

  const selected = files.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false);
        const f = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("audio/") || /\.(m4a|mp3|wav|ogg|webm)$/i.test(f.name));
        if (f.length) addFiles(f);
      }}>

      <input ref={fileInputRef} type="file" multiple
        accept="audio/mp4,audio/mpeg,audio/wav,audio/ogg,audio/webm,.m4a,.mp3,.wav,.ogg,.webm"
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ""; } }} />

      {dragging ? (
        <div className="flex-1 m-6 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50 flex items-center justify-center pointer-events-none">
          <p className="text-sm font-medium text-indigo-600">Suelta el archivo aquí</p>
        </div>
      ) : files.length === 0 ? (
        /* ── Empty state ── */
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center px-8">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-20 h-20 rounded-2xl bg-gray-100 hover:bg-indigo-50 flex items-center justify-center transition-colors group"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-9 h-9 text-gray-300 group-hover:text-indigo-400 transition-colors">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </button>
          <div>
            <p className="text-sm font-medium text-gray-600">Arrastra un audio o haz clic para seleccionar</p>
            <p className="text-xs text-gray-400 mt-1">m4a · mp3 · wav · ogg · webm</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            Seleccionar archivo
          </button>
        </div>
      ) : (
        /* ── File list ── */
        <>
          <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between gap-4 shrink-0">
            <h2 className="text-base font-semibold text-gray-900">
              {files.length === 1 ? files[0].name : `${files.length} archivos`}
            </h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium"
            >
              + Añadir
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* File tabs on the left */}
            {files.length > 1 && (
              <div className="w-56 shrink-0 border-r border-gray-100 overflow-y-auto py-2">
                {files.map((f) => (
                  <button key={f.id} onClick={() => setSelectedId(f.id)}
                    className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 transition-colors
                      ${selectedId === f.id ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-50"}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{f.name}</p>
                      <p className="text-[10px] mt-0.5">
                        {f.status === "uploading" && <span className="text-indigo-400">Subiendo…</span>}
                        {f.status === "done" && <span className="text-green-500">✓ Guardada</span>}
                        {f.status === "error" && <span className="text-red-400">Error</span>}
                        {f.status === "idle" && <span className="text-gray-400">Esperando…</span>}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Content area */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {!selected ? null
                : selected.status === "uploading" ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <p className="text-sm text-gray-500">Subiendo…</p>
                  </div>
                ) : selected.status === "error" ? (
                  <div className="rounded-xl bg-red-50 border border-red-100 px-5 py-4 text-sm text-red-600">{selected.error}</div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                    <p className="text-sm text-green-600 font-medium">✓ Guardada</p>
                    <p className="text-xs text-gray-400">Puedes transcribirla desde tu lista de grabaciones.</p>
                  </div>
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Audio player ────────────────────────────────────────────────────────────

function AudioPlayer({ id, durationMs }: { id: string; durationMs?: number }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const durSec = durationMs ? durationMs / 1000 : null;

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { try { await a.play(); setPlaying(true); } catch { setAudioError(true); } }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const dur = durationMs ? durationMs / 1000 : a.duration;
    if (dur && isFinite(dur)) { a.currentTime = ratio * dur; setProgress(ratio); }
  }

  if (audioError) return <p className="text-xs text-red-400">No se pudo cargar el audio.</p>;

  return (
    <div className="flex items-center gap-3">
      <audio ref={audioRef} src={`/api/recordings/${id}/audio`} preload="metadata"
        onTimeUpdate={() => {
          const a = audioRef.current; if (!a) return;
          setCurrentTime(a.currentTime);
          const dur = durationMs ? durationMs / 1000 : a.duration;
          if (dur && isFinite(dur)) setProgress(a.currentTime / dur);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
        onError={() => setAudioError(true)} />
      <button onClick={togglePlay}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 transition-colors">
        {playing
          ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M6 4a1 1 0 00-1 1v10a1 1 0 002 0V5a1 1 0 00-1-1zm8 0a1 1 0 00-1 1v10a1 1 0 002 0V5a1 1 0 00-1-1z" /></svg>
          : <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-0.5"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>}
      </button>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="relative h-1.5 bg-gray-200 rounded-full cursor-pointer" onClick={handleSeek}>
          <div className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>{fmtTime(currentTime)}</span>
          <span>{durSec ? fmtTime(durSec) : "—"}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"upload" | "recording">("recording");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splitStep, setSplitStep] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/recordings");
      const data = await res.json();
      setRecordings(data);
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
    } catch { setRecordings([]); }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Reload whenever the user returns to this tab (e.g. after sending from iPhone)
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    setSelectedSize(null);
    setEditingName(false);
    if (!selectedId) return;
    fetch(`/api/recordings/${selectedId}/size`)
      .then(r => r.json())
      .then(d => { if (d.sizeBytes) setSelectedSize(d.sizeBytes); })
      .catch(() => {});
  }, [selectedId]);

  async function handleDelete(id: string) {
    if (confirming !== id) { setConfirming(id); return; }
    await fetch(`/api/recordings/${id}`, { method: "DELETE" });
    setConfirming(null);
    if (selectedId === id) setSelectedId(null);
    await load();
  }

  async function handleTranscribe(id: string) {
    setTranscribing(id);
    setTranscribeError(null);
    try {
      const res = await fetch(`/api/recordings/${id}/transcribe`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      setRecordings((prev) => prev.map((r) => r.id === id ? { ...r, transcript: data.transcript } : r));
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Error al transcribir");
    }
    setTranscribing(null);
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSplit(rec: RecordingMeta) {
    setSplitting(true);
    try {
      setSplitStep("Descargando…");
      const res = await fetch(`/api/recordings/${rec.id}/audio`);
      if (!res.ok) throw new Error("No se pudo descargar el audio");
      const arrayBuf = await res.arrayBuffer();

      setSplitStep("Analizando audio…");
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuf);
      await audioCtx.close();

      const mid = decoded.duration / 2;
      // Adaptive sample rate: target < 24 MB per half (16-bit mono = 2 bytes/sample)
      const maxSamples = (24 * 1024 * 1024) / 2;
      const targetRate = Math.floor(maxSamples / mid);
      const sampleRate = Math.max(8000, Math.min(targetRate, decoded.sampleRate));

      // Strip any existing split suffix before adding new ones
      const baseName = rec.name.replace(/\s*\(\d+\/\d+\)$/, "").trim();
      const parts = [
        { start: 0,   end: mid,             name: `${baseName} (1/2)` },
        { start: mid, end: decoded.duration, name: `${baseName} (2/2)` },
      ];

      for (let i = 0; i < parts.length; i++) {
        const { start, end, name } = parts[i];
        setSplitStep(`Procesando parte ${i + 1}/2…`);
        const partDur = end - start;
        const offCtx = new OfflineAudioContext(1, Math.ceil(partDur * sampleRate), sampleRate);
        const src = offCtx.createBufferSource();
        src.buffer = decoded;
        src.connect(offCtx.destination);
        src.start(0, start, partDur);
        const rendered = await offCtx.startRendering();
        const wav = audioBufferToWav(rendered);
        const blob = new Blob([wav], { type: "audio/wav" });

        setSplitStep(`Subiendo parte ${i + 1}/2…`);
        const newId = crypto.randomUUID();
        const CHUNK = 3.5 * 1024 * 1024;
        const total = Math.max(1, Math.ceil(blob.size / CHUNK));
        for (let c = 0; c < total; c++) {
          const form = new FormData();
          form.append("chunk", blob.slice(c * CHUNK, (c + 1) * CHUNK), `${name}.wav`);
          form.append("id", newId);
          form.append("chunkIndex", String(c));
          form.append("totalChunks", String(total));
          form.append("mimeType", "audio/wav");
          if (c === total - 1) form.append("name", name);
          const r = await fetch("/api/recordings/upload", { method: "POST", body: form });
          if (!r.ok) throw new Error(`Error al subir parte ${i + 1}`);
        }
      }

      setSplitStep("Limpiando…");
      await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
      setSelectedId(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al dividir");
    } finally {
      setSplitting(false);
      setSplitStep("");
    }
  }

  function startEditingName() {
    if (!selected) return;
    setNameInput(selected.name);
    setEditingName(true);
    setTimeout(() => { nameInputRef.current?.select(); }, 0);
  }

  async function saveEditingName() {
    if (!selected || !nameInput.trim()) { setEditingName(false); return; }
    const trimmed = nameInput.trim();
    setEditingName(false);
    setRecordings(prev => prev.map(r => r.id === selected.id ? { ...r, name: trimmed } : r));
    await fetch(`/api/recordings/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
  }

  const selected = recordings.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full">

      {/* ── Left panel ── */}
      <div className="w-72 shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Mis grabaciones</h1>
            <p className="text-xs text-gray-400 mt-0.5">Grabaciones del iPhone y del Transcriptor</p>
          </div>
          <button onClick={load} title="Actualizar"
            className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5">
            <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}>
              <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Recordings list */}
        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <svg className="animate-spin h-4 w-4 text-gray-300" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          ) : recordings.map((rec) => (
            <button
              key={rec.id}
              onClick={() => { setSelectedId(rec.id); setView("recording"); setConfirming(null); }}
              className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors
                ${view === "recording" && selectedId === rec.id ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-100"}`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5">
                <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4zm-2 6a.75.75 0 00-1.5 0 6.5 6.5 0 0013 0 .75.75 0 00-1.5 0 5 5 0 01-10 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{rec.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(rec.date)}</p>
                {formatDuration(rec.durationMs) && (
                  <p className="text-[10px] text-gray-300">{formatDuration(rec.durationMs)}</p>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Subir audio — pinned to bottom */}
        <div className="border-t border-gray-100">
          <button
            onClick={() => { setView("upload"); setConfirming(null); }}
            className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors
              ${view === "upload" ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-100"}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor"
              className={`w-4 h-4 shrink-0 ${view === "upload" ? "text-indigo-500" : "text-gray-400"}`}>
              <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636v8.614z" />
              <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
            </svg>
            <span className={`text-sm font-medium ${view === "upload" ? "text-indigo-700" : "text-gray-700"}`}>
              Subir audio
            </span>
          </button>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === "upload" ? (
          <UploadPanel onSaved={load} />
        ) : !selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-gray-300">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">Selecciona una grabación</p>
          </div>
        ) : (
          <>
            <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between gap-4 shrink-0">
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <input
                    ref={nameInputRef}
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onBlur={saveEditingName}
                    onKeyDown={e => {
                      if (e.key === "Enter") saveEditingName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="text-base font-semibold text-gray-900 w-full border-b border-indigo-400 outline-none bg-transparent pb-0.5"
                  />
                ) : (
                  <h2
                    onClick={startEditingName}
                    title="Haz clic para editar"
                    className="text-base font-semibold text-gray-900 truncate cursor-text hover:text-indigo-600 transition-colors"
                  >
                    {selected.name}
                  </h2>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(selected.date)}
                  {selectedSize !== null && ` · ${(selectedSize / 1024 / 1024).toFixed(1)} MB`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {selected.transcript && (
                  <>
                    <button onClick={() => copy(selected.transcript)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium">
                      {copied ? "✓ Copiado" : "Copiar"}
                    </button>
                    <button onClick={() => downloadTxt(selected.name, selected.transcript)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium">
                      .txt
                    </button>
                    <button onClick={() => downloadPdf(selected.name, formatDate(selected.date), selected.transcript)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium">
                      PDF
                    </button>
                  </>
                )}
                <button
                  onClick={() => handleSplit(selected)}
                  disabled={splitting}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {splitting ? splitStep : "Dividir en 2"}
                </button>
                <button onClick={() => handleDelete(selected.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                    ${confirming === selected.id ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {confirming === selected.id ? "¿Segura?" : "Eliminar"}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <AudioPlayer id={selected.id} durationMs={selected.durationMs} />
              </div>
              {selected.transcript ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Transcripción</p>
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{selected.transcript}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <p className="text-sm text-gray-400">Esta grabación no tiene transcripción.</p>
                  <button onClick={() => handleTranscribe(selected.id)} disabled={transcribing === selected.id}
                    className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl bg-indigo-600
                      hover:bg-indigo-500 disabled:opacity-60 text-white font-medium transition-colors">
                    {transcribing === selected.id ? (
                      <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>Transcribiendo…</>
                    ) : "Transcribir ahora"}
                  </button>
                  {transcribeError && <p className="text-xs text-red-400">{transcribeError}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
