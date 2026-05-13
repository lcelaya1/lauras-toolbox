"use client";

import { useEffect, useRef, useState } from "react";
import { getAllRecordings, deleteRecording, type Recording } from "@/lib/recordings-db";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms?: number) {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function RecordingCard({ rec, onDelete }: { rec: Recording; onDelete: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(rec.audioBlob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [rec.audioBlob]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  }

  async function copy() {
    await navigator.clipboard.writeText(rec.transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    await deleteRecording(rec.id);
    onDelete();
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm truncate">{rec.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(rec.date)}
            {formatDuration(rec.durationMs) && (
              <span className="ml-2 text-gray-300">·</span>
            )}
            {formatDuration(rec.durationMs) && (
              <span className="ml-2">{formatDuration(rec.durationMs)}</span>
            )}
          </p>
        </div>

        <button
          onClick={handleDelete}
          className={`shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors font-medium
            ${confirming
              ? "bg-red-100 text-red-600 hover:bg-red-200"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
        >
          {confirming ? "¿Segura?" : "Eliminar"}
        </button>
      </div>

      {/* Audio player */}
      {url && (
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-indigo-600
              hover:bg-indigo-500 text-white shrink-0 transition-colors"
          >
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
          <audio
            ref={audioRef}
            src={url}
            onEnded={() => setPlaying(false)}
            className="flex-1 h-8"
            controls
            style={{ height: 32 }}
          />
        </div>
      )}

      {/* Transcript */}
      {rec.transcript && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Transcripción
            </span>
            <button onClick={copy}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200
                transition-colors text-gray-600 font-medium">
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 bg-gray-50
            rounded-lg px-3 py-2.5 border border-gray-100">
            {rec.transcript}
          </p>
        </div>
      )}
    </div>
  );
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setRecordings(await getAllRecordings());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(appUrl)}`;

  return (
    <div className="px-8 py-10 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">📼</span>
          <h1 className="text-2xl font-semibold text-gray-900">Mis grabaciones</h1>
        </div>
        <p className="text-sm text-gray-500">Grabaciones guardadas con su transcripción.</p>
      </div>

      {/* iPhone section */}
      <div className="mb-8 rounded-xl border border-indigo-100 bg-indigo-50 p-5 flex gap-5 items-start">
        {appUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrUrl} alt="QR code" width={80} height={80}
            className="rounded-lg shrink-0 border border-indigo-200" />
        )}
        <div>
          <p className="text-sm font-semibold text-indigo-900 mb-1">Subir desde iPhone</p>
          <p className="text-xs text-indigo-700 leading-relaxed">
            Escanea el QR con tu iPhone para abrir la app en Safari.
            Desde <strong>Transcriptor → Subir archivo</strong>, iOS te permite seleccionar
            directamente desde <strong>Notas de Voz</strong> o la app de Archivos.
            Una vez transcrita, pulsa <strong>Guardar grabación</strong> para que aparezca aquí.
          </p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
      ) : recordings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-4xl mb-3">📭</span>
          <p className="text-sm font-medium text-gray-500">Todavía no hay grabaciones guardadas</p>
          <p className="text-xs text-gray-400 mt-1">
            Transcribe un audio y pulsa &ldquo;Guardar grabación&rdquo; para verlo aquí.
          </p>
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
