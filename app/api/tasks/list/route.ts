import { NextResponse } from "next/server";
import { listTasks } from "@/lib/meetings-tasks";

// Protected by proxy.ts (signed-in Toolbox user only).
export async function GET() {
  const data = await listTasks({ doneSinceHours: 24 * 14 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
