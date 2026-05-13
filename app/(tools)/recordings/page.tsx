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
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
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

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  }

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
        <button
          onClick={handleDelete}
          className={`shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors font-medium
            ${confirming ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
        >
          {confirming ? "¿Segura?" : "Eliminar"}
        </button>
      </div>

      {/* Audio player */}
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
          src={rec.audioUrl}
          onEnded={() => setPlaying(false)}
          controls
          className="flex-1"
          style={{ height: 32 }}
        />
      </div>

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

function ShortcutStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold shrink-0 mt-0.5">
        {n}
      </span>
      <p className="text-xs text-indigo-800 leading-relaxed">{children}</p>
    </div>
  );
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "setup">("list");
  const [appUrl, setAppUrl] = useState("");

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

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

  const uploadUrl = `${appUrl}/api/recordings`;
  const qrUrl = appUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(uploadUrl)}`
    : null;

  return (
    <div className="px-8 py-10 max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">📼</span>
          <h1 className="text-2xl font-semibold text-gray-900">Mis grabaciones</h1>
        </div>
        <p className="text-sm text-gray-500">Tus grabaciones guardadas, accesibles desde cualquier dispositivo.</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-gray-100 p-1 gap-1 mb-6">
        {([["list", "Grabaciones"], ["setup", "Conectar iPhone"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
              ${tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── RECORDINGS LIST ── */}
      {tab === "list" && (
        <>
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
              <p className="text-xs text-gray-400 mt-1">
                Configura el Atajo de iPhone o guarda una desde el Transcriptor.
              </p>
              <button
                onClick={() => setTab("setup")}
                className="mt-4 text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                Conectar iPhone →
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {recordings.map((rec) => (
                <RecordingCard key={rec.id} rec={rec} onDelete={load} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── IPHONE SETUP ── */}
      {tab === "setup" && (
        <div className="flex flex-col gap-6">

          {/* How it works */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-3">
            <p className="text-sm font-semibold text-gray-900">Cómo funciona</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Un <strong>Atajo de iOS</strong> configurado como Automatización envía automáticamente
              tu última Nota de Voz a esta app cada vez que cierras la app de Notas de Voz.
              El audio se transcribe y aparece aquí al instante.
            </p>
          </div>

          {/* Step by step */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5 flex flex-col gap-4">
            <p className="text-sm font-semibold text-indigo-900">Configuración — 5 minutos</p>

            <div className="flex flex-col gap-3.5">
              <ShortcutStep n={1}>
                Abre la app <strong>Atajos</strong> en tu iPhone y ve a la pestaña <strong>Automatización</strong>.
              </ShortcutStep>
              <ShortcutStep n={2}>
                Pulsa <strong>+</strong> → <strong>Nueva automatización</strong> → busca <strong>App</strong> → selecciona <strong>Notas de Voz</strong> → elige <strong>Se cierra</strong> → desactiva &ldquo;Preguntar antes de ejecutar&rdquo;.
              </ShortcutStep>
              <ShortcutStep n={3}>
                Pulsa <strong>Siguiente</strong> → <strong>Nueva acción en blanco</strong> y añade estas acciones en orden:
              </ShortcutStep>

              <div className="ml-8 flex flex-col gap-2 bg-white rounded-lg border border-indigo-100 p-3">
                {[
                  "Obtener últimas notas de voz → Límite: 1",
                  "Codificar medio → M4A",
                  'Obtener detalles de nota de voz → "Nombre"',
                  'Solicitud URL → POST → ' + uploadUrl,
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[10px] text-indigo-400 font-mono mt-0.5">{i + 1}.</span>
                    <span className="text-xs text-gray-700 font-mono">{step}</span>
                  </div>
                ))}
              </div>

              <ShortcutStep n={4}>
                Para la acción <strong>Solicitud URL</strong>, configura el cuerpo como <strong>Formulario</strong> con dos campos:
                <br /><br />
                &bull; <strong>file</strong> → selecciona la variable <em>Medio codificado</em><br />
                &bull; <strong>name</strong> → selecciona la variable <em>Nombre</em>
              </ShortcutStep>

              <ShortcutStep n={5}>
                Guarda la automatización. A partir de ahora, cada vez que grabes una nota de voz y cierres la app, aparecerá aquí automáticamente transcrita.
              </ShortcutStep>
            </div>
          </div>

          {/* URL + QR */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-5 items-center">
            {qrUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt="QR endpoint" width={90} height={90}
                className="rounded-lg shrink-0 border border-gray-100" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-700 mb-1">URL del endpoint</p>
              <p className="text-xs text-gray-400 mb-2">Usa esta URL en el paso 4 de la configuración:</p>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                <code className="text-xs text-indigo-700 break-all flex-1">{uploadUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(uploadUrl)}
                  className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
                >
                  Copiar
                </button>
              </div>
            </div>
          </div>

          {/* Test */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-semibold text-gray-700 mb-2">Probar la conexión</p>
            <p className="text-xs text-gray-500 mb-3">
              Graba cualquier cosa en Notas de Voz, cierra la app y vuelve aquí en unos segundos.
              La grabación debería aparecer en la pestaña Grabaciones.
            </p>
            <button
              onClick={load}
              className="text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
            >
              Recargar grabaciones
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
