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

function RecordingCard({ rec, onDelete }: { rec: RecordingMeta; onDelete: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function copy() {
    await navigator.clipboard.writeText(rec.transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
    onDelete();
  }

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      try {
        await a.play();
        setPlaying(true);
      } catch {
        setAudioError(true);
      }
    }
  }

  function handleTimeUpdate() {
    const a = audioRef.current;
    if (!a) return;
    setCurrentTime(a.currentTime);
    const dur = rec.durationMs ? rec.durationMs / 1000 : a.duration;
    if (dur && isFinite(dur)) setProgress(a.currentTime / dur);
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const dur = rec.durationMs ? rec.durationMs / 1000 : a.duration;
    if (dur && isFinite(dur)) {
      a.currentTime = ratio * dur;
      setProgress(ratio);
    }
  }

  const durSec = rec.durationMs ? rec.durationMs / 1000 : null;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm truncate">{rec.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(rec.date)}
            {formatDuration(rec.durationMs) && (
              <span className="ml-2 text-gray-300">· {formatDuration(rec.durationMs)}</span>
            )}
          </p>
        </div>
        <button onClick={handleDelete}
          className={`shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors font-medium
            ${confirming ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
          {confirming ? "¿Segura?" : "Eliminar"}
        </button>
      </div>

      {/* Custom audio player */}
      {audioError ? (
        <p className="text-xs text-red-400">No se pudo cargar el audio. El archivo puede haberse perdido.</p>
      ) : (
      <div className="flex items-center gap-3">
        <audio ref={audioRef} src={`/api/recordings/${rec.id}/audio`} preload="metadata"
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
      )}

      {rec.transcript && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Transcripción</span>
            <button onClick={copy}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 font-medium">
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
            {rec.transcript}
          </p>
        </div>
      )}
    </div>
  );
}


export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/recordings");
      setRecordings(await res.json());
    } catch {
      setRecordings([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="px-8 py-10 max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">📼</span>
          <h1 className="text-2xl font-semibold text-gray-900">Mis grabaciones</h1>
        </div>
        <p className="text-sm text-gray-500">Tus grabaciones guardadas, accesibles desde cualquier dispositivo.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-300">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
      ) : recordings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-4xl mb-3">📭</span>
          <p className="text-sm font-medium text-gray-500">Todavía no hay grabaciones</p>
          <p className="text-xs text-gray-400 mt-1">Guarda una desde el Transcriptor o envía una desde el iPhone.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {recordings.map((rec) => (
            <RecordingCard key={rec.id} rec={rec} onDelete={load} />
          ))}
        </div>
      )}

    </div>
  );
}
