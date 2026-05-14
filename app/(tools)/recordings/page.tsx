"use client";

import { useEffect, useRef, useState } from "react";
import type { RecordingMeta } from "@/lib/blob-store";

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


function AudioPlayer({ id, durationMs, mimeType }: { id: string; durationMs?: number; mimeType: string }) {
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
    else {
      try { await a.play(); setPlaying(true); }
      catch { setAudioError(true); }
    }
  }

  function handleTimeUpdate() {
    const a = audioRef.current;
    if (!a) return;
    setCurrentTime(a.currentTime);
    const dur = durationMs ? durationMs / 1000 : a.duration;
    if (dur && isFinite(dur)) setProgress(a.currentTime / dur);
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
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
        onError={() => setAudioError(true)} />

      <button onClick={togglePlay}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-indigo-600
          hover:bg-indigo-500 text-white shrink-0 transition-colors">
        {playing ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M6 4a1 1 0 00-1 1v10a1 1 0 002 0V5a1 1 0 00-1-1zm8 0a1 1 0 00-1 1v10a1 1 0 002 0V5a1 1 0 00-1-1z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 ml-0.5">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1.5">
        <div className="relative h-1.5 bg-gray-200 rounded-full cursor-pointer" onClick={handleSeek}>
          <div className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full transition-all"
            style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>{fmtTime(currentTime)}</span>
          <span>{durSec ? fmtTime(durSec) : "—"}</span>
        </div>
      </div>
    </div>
  );
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

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

  useEffect(() => { load(); }, []);

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
      setRecordings((prev) =>
        prev.map((r) => r.id === id ? { ...r, transcript: data.transcript } : r)
      );
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

  const selected = recordings.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-full">

      {/* ── Left panel ── */}
      <div className="w-72 shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-sm font-semibold text-gray-900">Mis grabaciones</h1>
          <p className="text-xs text-gray-400 mt-0.5">Grabaciones del iPhone y del Transcriptor</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <svg className="animate-spin h-4 w-4 text-gray-300" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          ) : recordings.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-8 px-4">No hay grabaciones todavía</p>
          ) : (
            recordings.map((rec) => (
              <button
                key={rec.id}
                onClick={() => { setSelectedId(rec.id); setConfirming(null); }}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors
                  ${selectedId === rec.id ? "bg-indigo-50 border-r-2 border-indigo-500" : "hover:bg-gray-100"}`}
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
            ))
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="w-8 h-8 text-gray-300">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">Selecciona una grabación</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900 truncate">{selected.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(selected.date)}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {selected.transcript && (
                  <button onClick={() => copy(selected.transcript)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium">
                    {copied ? "✓ Copiado" : "Copiar"}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(selected.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                    ${confirming === selected.id
                      ? "bg-red-100 text-red-600 hover:bg-red-200"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {confirming === selected.id ? "¿Segura?" : "Eliminar"}
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6">
              {/* Audio player */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <AudioPlayer id={selected.id} durationMs={selected.durationMs} mimeType={selected.mimeType} />
              </div>

              {/* Transcript */}
              {selected.transcript && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Transcripción</p>
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {selected.transcript}
                  </p>
                </div>
              )}
              {!selected.transcript && (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <p className="text-sm text-gray-400">Esta grabación no tiene transcripción.</p>
                  <button
                    onClick={() => handleTranscribe(selected.id)}
                    disabled={transcribing === selected.id}
                    className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl bg-indigo-600
                      hover:bg-indigo-500 disabled:opacity-60 text-white font-medium transition-colors"
                  >
                    {transcribing === selected.id ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Transcribiendo…
                      </>
                    ) : "Transcribir ahora"}
                  </button>
                  {transcribeError && (
                    <p className="text-xs text-red-400">{transcribeError}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
