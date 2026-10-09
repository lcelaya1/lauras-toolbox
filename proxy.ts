import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

// Pages and APIs that require signing in with an allowed Google account.
// (/api/mcp is protected separately with OAuth bearer tokens.)
export function proxy(req: NextRequest) {
  if (getSession(req)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const next = req.nextUrl.pathname + req.nextUrl.search;
  return NextResponse.redirect(new URL(`/api/auth/google/login?next=${encodeURIComponent(next)}`, req.nextUrl));
}

export const config = {
  matcher: ["/mail/:path*", "/api/mail/:path*", "/tasks/:path*", "/api/tasks/list", "/api/tasks/toggle"],
};
