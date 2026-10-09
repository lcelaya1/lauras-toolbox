"use client";

import { useEffect, useState } from "react";

interface AccountInfo {
  email: string;
  label: string;
  kind: "oauth" | "imap";
  status: "connected" | "not_connected" | "needs_reconnect" | "error";
  detail: string | null;
  connected_at: string | null;
}

const STATUS: Record<AccountInfo["status"], { text: string; dot: string; tone: string }> = {
  connected: { text: "Conectada", dot: "bg-emerald-500", tone: "text-emerald-700" },
  not_connected: { text: "Sin conectar", dot: "bg-gray-300", tone: "text-gray-500" },
  needs_reconnect: { text: "Hay que reconectar", dot: "bg-amber-500", tone: "text-amber-700" },
  error: { text: "Error", dot: "bg-red-500", tone: "text-red-700" },
};

const ERRORS: Record<string, string> = {
  invalid_state: "La solicitud caducó. Vuelve a intentarlo.",
  cancelled: "Se canceló la conexión con Google.",
  missing_code: "Google no devolvió el código de autorización.",
  scope_missing: "No se concedió el permiso de lectura de Gmail.",
  wrong_account: "Has autorizado una cuenta distinta a la seleccionada.",
  no_refresh_token: "Google no devolvió un token de larga duración. Vuelve a intentarlo.",
  exchange_failed: "No se pudo completar la conexión con Google.",
  unknown_account: "Esa cuenta no está en la lista permitida.",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export default function MailPage() {
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/mail/accounts", { cache: "no-store" });
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected) setNotice({ kind: "ok", text: `${connected} conectada.` });
    else if (error) {
      const got = q.get("got");
      setNotice({ kind: "error", text: (ERRORS[error] ?? "Algo salió mal.") + (got ? ` (autorizada: ${got})` : "") });
    }
    if (connected || error) window.history.replaceState(null, "", "/mail");
    load();
  }, []);

  async function disconnect(email: string) {
    if (!confirm(`¿Desconectar ${email}? El Toolbox dejará de leer este buzón.`)) return;
    await fetch(`/api/mail/accounts?account=${encodeURIComponent(email)}`, { method: "DELETE" });
    setNotice({ kind: "ok", text: `${email} desconectada.` });
    load();
  }

  const workspace = accounts?.filter((a) => a.kind === "oauth") ?? [];
  const personal = accounts?.filter((a) => a.kind === "imap") ?? [];

  return (
    <div className="px-8 py-10 max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mis correos</h1>
          <p className="mt-1 text-sm text-gray-500">
            Buzones que el morning brief puede leer (solo lectura) para ver correos pendientes.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="shrink-0 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">
          {loading ? "Comprobando…" : "Comprobar estado"}
        </button>
      </div>

      {notice && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {notice.text}
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Teamlabs (Google Workspace)</h2>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {accounts === null
            ? <p className="px-5 py-6 text-sm text-gray-400">Cargando…</p>
            : workspace.map((a) => <AccountRow key={a.email} a={a} onDisconnect={disconnect} />)}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Personal (IMAP)</h2>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {accounts === null
            ? <p className="px-5 py-6 text-sm text-gray-400">Cargando…</p>
            : personal.length
              ? personal.map((a) => <AccountRow key={a.email} a={a} />)
              : <p className="px-5 py-4 text-sm text-gray-500">Falta configurar GMAIL_PERSONAL_ADDRESS en Vercel.</p>}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Usa una contraseña de aplicación de Google (GMAIL_PERSONAL_APP_PASSWORD). Si deja de funcionar, crea una nueva y actualízala en Vercel.
        </p>
      </section>
    </div>
  );
}

function AccountRow({ a, onDisconnect }: { a: AccountInfo; onDisconnect?: (email: string) => void }) {
  const s = STATUS[a.status];
  const connectHref = `/api/mail/oauth/start?account=${encodeURIComponent(a.email)}`;
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{a.email}</p>
        <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${s.tone}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.text}
          {a.status === "connected" && a.connected_at && <span className="text-gray-400">· desde {formatDate(a.connected_at)}</span>}
        </p>
        {a.detail && a.status !== "connected" && <p className="mt-1 text-xs text-gray-500">{a.detail}</p>}
      </div>
      {a.kind === "oauth" && (
        <div className="flex shrink-0 items-center gap-2">
          {a.status !== "not_connected" && onDisconnect && (
            <button onClick={() => onDisconnect(a.email)} className="text-xs text-gray-400 hover:text-gray-600">Desconectar</button>
          )}
          <a href={connectHref}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${a.status === "connected"
              ? "border border-gray-200 text-gray-600 hover:bg-gray-50"
              : "bg-indigo-600 text-white hover:bg-indigo-500"}`}>
            {a.status === "not_connected" ? "Conectar" : "Reconectar"}
          </a>
        </div>
      )}
    </div>
  );
}
