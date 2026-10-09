import { NextRequest, NextResponse } from "next/server";
import { issuer } from "@/lib/auth/config";
import { safeEqual } from "@/lib/auth/crypto";
import { escapeHtml } from "@/lib/auth/http";
import { clearCookie, COOKIE, getSession, readSignedCookie, type PendingAuthorization } from "@/lib/auth/session";
import { createAuthCode } from "@/lib/auth/store";

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laura's Toolbox · Autorizar acceso</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f9fafb;color:#111827;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;max-width:420px;width:100%}
  h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.5;color:#374151}
  code{background:#f3f4f6;padding:1px 6px;border-radius:4px;font-size:13px;word-break:break-all}
  .row{display:flex;gap:8px;margin-top:20px}
  button{flex:1;padding:10px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font-size:14px;cursor:pointer}
  button.primary{background:#4f46e5;border-color:#4f46e5;color:#fff}
</style><body><div class="card">${body}</div></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      },
    },
  );
}

function load(req: NextRequest) {
  const session = getSession(req);
  const pending = readSignedCookie<PendingAuthorization>(req, COOKIE.authz);
  return { session, pending };
}

export function GET(req: NextRequest) {
  const { session, pending } = load(req);
  if (!pending) return page("<h1>Solicitud caducada</h1><p>Vuelve a conectar desde Claude.</p>", 400);
  if (!session) return NextResponse.redirect(new URL("/api/auth/google/login?next=/oauth/consent", req.nextUrl));

  const name = pending.clientName || "Una aplicación";
  const host = new URL(pending.redirectUri).host;
  return page(`
    <h1>¿Permitir acceso a Laura's Toolbox?</h1>
    <p><strong>${escapeHtml(name)}</strong> quiere acceder a las herramientas MCP de Laura's Toolbox
       (reuniones, grabaciones y correo).</p>
    <p>Volverá a <code>${escapeHtml(host)}</code>.</p>
    <p>Sesión iniciada como <code>${escapeHtml(session.email)}</code>.</p>
    <form method="post" class="row">
      <input type="hidden" name="csrf" value="${escapeHtml(pending.csrf)}">
      <button name="decision" value="deny">Cancelar</button>
      <button name="decision" value="allow" class="primary">Permitir</button>
    </form>`);
}

export async function POST(req: NextRequest) {
  const { session, pending } = load(req);
  if (!pending || !session) return page("<h1>Solicitud caducada</h1><p>Vuelve a conectar desde Claude.</p>", 400);

  const form = await req.formData();
  const csrf = String(form.get("csrf") ?? "");
  if (!safeEqual(csrf, pending.csrf)) return page("<h1>Solicitud no válida</h1>", 400);

  const url = new URL(pending.redirectUri);
  if (pending.state) url.searchParams.set("state", pending.state);
  url.searchParams.set("iss", issuer(req));

  if (form.get("decision") === "allow") {
    const code = await createAuthCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      email: session.email,
    });
    url.searchParams.set("code", code);
  } else {
    url.searchParams.set("error", "access_denied");
  }

  const res = NextResponse.redirect(url, 303);
  clearCookie(res, COOKIE.authz);
  return res;
}
