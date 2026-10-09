import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";

export function GET(req: NextRequest) {
  const session = getSession(req);
  return Response.json({ email: session?.email ?? null }, { headers: { "Cache-Control": "no-store" } });
}
