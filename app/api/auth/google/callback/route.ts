import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail, issuer } from "@/lib/auth/config";
import { safeEqual } from "@/lib/auth/crypto";
import { exchangeGoogleCode, type GoogleLoginState } from "@/lib/auth/google";
import { escapeHtml } from "@/lib/auth/http";
import { clearCookie, COOKIE, readSignedCookie, setSession } from "@/lib/auth/session";

function deny(message: string): Response {
  const res = new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Acceso denegado</title>
     <body style="font-family:system-ui;padding:3rem;color:#111"><h1>Acceso denegado</h1><p>${escapeHtml(message)}</p>
     <p><a href="/api/auth/google/login">Probar con otra cuenta</a></p></body>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
  clearCookie(res, COOKIE.google);
  return res;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const login = readSignedCookie<GoogleLoginState>(req, COOKIE.google);
  const state = q.get("state") ?? "";
  if (!login || !safeEqual(state, login.state)) return deny("La solicitud de inicio de sesión ha caducado o no es válida.");
  if (q.get("error")) return deny("Se canceló el inicio de sesión con Google.");

  const code = q.get("code");
  if (!code) return deny("Falta el código de Google.");

  let email: string;
  try {
    email = await exchangeGoogleCode({
      code,
      redirectUri: `${issuer(req)}/api/auth/google/callback`,
      codeVerifier: login.verifier,
      nonce: login.nonce,
    });
  } catch (e) {
    console.error("Google sign-in failed:", e instanceof Error ? e.message : "unknown error");
    return deny("No se pudo verificar la cuenta de Google.");
  }
  if (!isAllowedEmail(email)) return deny(`La cuenta ${email} no tiene acceso a esta app.`);

  const res = NextResponse.redirect(new URL(login.next, req.nextUrl));
  setSession(res, email);
  clearCookie(res, COOKIE.google);
  return res;
}
