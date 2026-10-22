import { NextResponse } from "next/server";
import { listDeletedTasks } from "@/lib/meetings-tasks";

// Protected by proxy.ts (signed-in Toolbox user only). Tasks deleted in the last 30 days.
export async function GET() {
  const deleted = await listDeletedTasks(30);
  return NextResponse.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
}
