import { NextRequest, NextResponse } from "next/server";
import { personalAccount } from "@/lib/mail/common";
import { ImapAuthError, imapCheck, normalizeAppPassword } from "@/lib/mail/imap";
import { saveAppPassword } from "@/lib/mail/store";

export const maxDuration = 30;

// Reconnect the personal Gmail: test a new app password against Gmail, then store it
// encrypted. Protected by proxy.ts (signed-in Toolbox user only). Never logged.
export async function POST(req: NextRequest) {
  const account = personalAccount();
  if (!account) return NextResponse.json({ error: "Falta GMAIL_PERSONAL_ADDRESS en Vercel." }, { status: 500 });

  const body = await req.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? normalizeAppPassword(body.password) : "";
  if (!/^[a-zA-Z]{16}$/.test(password)) {
    return NextResponse.json({ error: "La contraseña de aplicación tiene 16 letras (los espacios dan igual)." }, { status: 400 });
  }

  try {
    await imapCheck(password);
  } catch (e) {
    if (e instanceof ImapAuthError) {
      return NextResponse.json({ error: "Gmail ha rechazado esta contraseña. Comprueba que la has creado con la cuenta correcta y vuelve a pegarla." }, { status: 400 });
    }
    return NextResponse.json({ error: "No se ha podido contactar con Gmail para probarla. Inténtalo de nuevo en un minuto." }, { status: 502 });
  }

  await saveAppPassword(account.email, password);
  return NextResponse.json({ ok: true });
}
