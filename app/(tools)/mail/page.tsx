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
              ? personal.map((a) => (
                <PersonalRow key={a.email} a={a} onSaved={() => { setNotice({ kind: "ok", text: "Gmail personal reconectado." }); load(); }} />
              ))
              : <p className="px-5 py-4 text-sm text-gray-500">Falta configurar GMAIL_PERSONAL_ADDRESS en Vercel.</p>}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Se conecta con una contraseña de aplicación de Google. Si deja de funcionar (por ejemplo, al cambiar la contraseña de Google), pulsa Reconectar y pega una nueva.
        </p>
      </section>
    </div>
  );
}

function PersonalRow({ a, onSaved }: { a: AccountInfo; onSaved: () => void }) {
  const s = STATUS[a.status];
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mail/app-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo guardar."); return; }
      setPassword("");
      setOpen(false);
      onSaved();
    } catch {
      setError("No se pudo contactar con el Toolbox. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const failed = a.status === "needs_reconnect" || a.status === "error";
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{a.email}</p>
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${s.tone}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.text}
          </p>
          {a.status === "needs_reconnect" && (
            <p className="mt-1 text-xs text-gray-500">Gmail ha rechazado la contraseña de aplicación (se ha revocado o ha caducado).</p>
          )}
          {a.status === "error" && a.detail && <p className="mt-1 text-xs text-gray-500">{a.detail}</p>}
        </div>
        {!open && (
          <button onClick={() => setOpen(true)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${failed
              ? "bg-indigo-600 text-white hover:bg-indigo-500"
              : "border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {failed ? "Reconectar" : "Cambiar contraseña"}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={save} className="mt-4 flex flex-col gap-3 rounded-lg bg-gray-50 p-4">
          <ol className="list-decimal pl-4 text-xs leading-relaxed text-gray-600">
            <li>
              Abre{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">
                myaccount.google.com/apppasswords
              </a>{" "}
              con {a.email}.
            </li>
            <li>Crea una contraseña llamada &quot;Laura&apos;s Toolbox&quot; (si ya existe una antigua, bórrala).</li>
            <li>Pega aquí las 16 letras. El Toolbox la prueba con Gmail antes de guardarla.</li>
          </ol>
          <label htmlFor="app-password" className="sr-only">Contraseña de aplicación</label>
          <input id="app-password" type="password" autoComplete="off" spellCheck={false}
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="abcd efgh ijkl mnop"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm tracking-wider text-gray-900 focus:border-indigo-400 focus:outline-none" />
          {error && <p className="text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || password.replace(/\s+/g, "").length < 16}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
              {saving ? "Probando con Gmail…" : "Probar y guardar"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setPassword(""); setError(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
              Cancelar
            </button>
          </div>
        </form>
      )}
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
