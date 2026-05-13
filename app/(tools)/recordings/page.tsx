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
      <div className="flex items-center gap-3">
        <audio ref={audioRef} src={rec.audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }} />

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

function Step({ n, color, children }: { n: number; color: "indigo" | "orange"; children: React.ReactNode }) {
  const cls = color === "indigo"
    ? "bg-indigo-100 text-indigo-700"
    : "bg-orange-100 text-orange-700";
  const text = color === "indigo" ? "text-indigo-800" : "text-orange-900";
  return (
    <div className="flex gap-3">
      <span className={`flex items-center justify-center w-5 h-5 rounded-full ${cls} text-[11px] font-bold shrink-0 mt-0.5`}>
        {n}
      </span>
      <p className={`text-xs ${text} leading-relaxed`}>{children}</p>
    </div>
  );
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200 mt-1">
      <code className="text-xs text-indigo-700 break-all flex-1 select-all">{value}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="shrink-0 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
      >
        {copied ? "✓" : "Copiar"}
      </button>
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

      {/* ── SETUP ── */}
      {tab === "setup" && (
        <div className="flex flex-col gap-6">

          {/* Part 1 — Cloudflare R2 */}
          <div className="rounded-xl border border-orange-100 bg-orange-50 p-5 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-orange-900">Parte 1 — Cloudflare R2 (almacenamiento)</p>
              <p className="text-xs text-orange-700 mt-1">10 GB gratis · sin coste por reproducción · una sola vez</p>
            </div>
            <div className="flex flex-col gap-3.5">
              <Step n={1} color="orange">
                Ve a <strong>dash.cloudflare.com</strong> → sección <strong>R2</strong> → <strong>Create bucket</strong>.
                Llámalo <code className="bg-white px-1 rounded">lauras-toolbox</code> y pulsa <strong>Create bucket</strong>.
              </Step>
              <Step n={2} color="orange">
                Dentro del bucket ve a <strong>Settings → Public access</strong> y activa el acceso público.
                Copia la URL que aparece (algo como <code className="bg-white px-1 rounded">pub-xxx.r2.dev</code>).
              </Step>
              <Step n={3} color="orange">
                Vuelve a R2 (fuera del bucket) → <strong>Manage R2 API tokens</strong> → <strong>Create API token</strong>.
                Permisos: <strong>Object Read &amp; Write</strong>. Guarda el <em>Access Key ID</em> y el <em>Secret Access Key</em>.
              </Step>
              <Step n={4} color="orange">
                Tu Account ID está en la barra lateral derecha del dashboard de Cloudflare (bajo &ldquo;Account ID&rdquo;).
              </Step>
              <Step n={5} color="orange">
                Añade estas variables en tu <code className="bg-white px-1 rounded">.env.local</code> y también en
                Vercel → <strong>Settings → Environment Variables</strong>:
              </Step>
            </div>
            <div className="flex flex-col gap-1.5 ml-8">
              {[
                "R2_ACCOUNT_ID=tu_account_id",
                "R2_ACCESS_KEY_ID=tu_access_key",
                "R2_SECRET_ACCESS_KEY=tu_secret_key",
                "R2_BUCKET_NAME=lauras-toolbox",
                "R2_PUBLIC_URL=https://pub-xxx.r2.dev",
              ].map((v) => <CopyBox key={v} value={v} />)}
            </div>
          </div>

          {/* Part 2 — iOS Shortcut */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-5 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-indigo-900">Parte 2 — Atajo de iPhone (sincronización automática)</p>
              <p className="text-xs text-indigo-600 mt-1">Cada vez que cierres Notas de Voz, la última grabación llegará aquí sola.</p>
            </div>
            <div className="flex flex-col gap-3.5">
              <Step n={1} color="indigo">
                Abre la app <strong>Atajos</strong> → pestaña <strong>Automatización</strong> → <strong>+</strong> → <strong>Nueva automatización</strong>.
              </Step>
              <Step n={2} color="indigo">
                Busca <strong>App</strong> → elige <strong>Notas de Voz</strong> → activa <strong>Se cierra</strong> → desactiva &ldquo;Preguntar antes de ejecutar&rdquo; → <strong>Siguiente</strong>.
              </Step>
              <Step n={3} color="indigo">
                Pulsa <strong>Nueva acción en blanco</strong> y añade estas 4 acciones en orden:
                <div className="mt-2 flex flex-col gap-1.5 bg-white rounded-lg border border-indigo-100 p-3">
                  {[
                    "Obtener últimas notas de voz  →  Límite: 1",
                    "Codificar medio  →  M4A",
                    "Obtener detalles de nota de voz  →  Nombre",
                    "Solicitud URL  →  Método: POST",
                  ].map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[10px] text-indigo-400 font-mono mt-0.5 shrink-0">{i + 1}.</span>
                      <span className="text-xs text-gray-700">{s}</span>
                    </div>
                  ))}
                </div>
              </Step>
              <Step n={4} color="indigo">
                En <strong>Solicitud URL</strong> pega esta URL y configura el cuerpo como <strong>Formulario</strong>:
                <CopyBox value={uploadUrl} />
                <div className="mt-2 bg-white rounded-lg border border-indigo-100 p-3 flex flex-col gap-1.5">
                  <p className="text-xs text-gray-600"><strong>file</strong> → variable <em>Medio codificado</em></p>
                  <p className="text-xs text-gray-600"><strong>name</strong> → variable <em>Nombre</em></p>
                </div>
              </Step>
              <Step n={5} color="indigo">
                Guarda. Listo — graba una nota de voz, cierra la app y en unos segundos aparecerá aquí con la transcripción.
              </Step>
            </div>
          </div>

          {/* QR + test */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 flex gap-5 items-center">
            {qrUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt="QR" width={80} height={80} className="rounded-lg shrink-0 border border-gray-100" />
            )}
            <div className="flex-1">
              <p className="text-xs font-semibold text-gray-700 mb-1">Probar la conexión</p>
              <p className="text-xs text-gray-500 mb-3">Graba algo en Notas de Voz, cierra la app y recarga.</p>
              <button onClick={load}
                className="text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors">
                Recargar grabaciones
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
