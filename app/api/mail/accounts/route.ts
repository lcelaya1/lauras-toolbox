import { NextRequest, NextResponse } from "next/server";
import { isWorkspaceAccount } from "@/lib/mail/common";
import { listAccounts } from "@/lib/mail";
import { deleteAccount } from "@/lib/mail/store";

export const maxDuration = 30;

// Protected by proxy.ts (signed-in Toolbox user only).
export async function GET() {
  return NextResponse.json({ accounts: await listAccounts() }, { headers: { "Cache-Control": "no-store" } });
}

// Disconnect: forget the stored refresh token (revoke access in Google too, from the account's security settings).
export async function DELETE(req: NextRequest) {
  const account = (req.nextUrl.searchParams.get("account") ?? "").trim().toLowerCase();
  if (!isWorkspaceAccount(account)) return NextResponse.json({ error: "Unknown account" }, { status: 400 });
  await deleteAccount(account);
  return NextResponse.json({ ok: true });
}
