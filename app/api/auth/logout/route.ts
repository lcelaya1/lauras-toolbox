import { NextRequest, NextResponse } from "next/server";
import { clearCookie, COOKIE } from "@/lib/auth/session";

export function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.nextUrl), 303);
  clearCookie(res, COOKIE.session);
  return res;
}
