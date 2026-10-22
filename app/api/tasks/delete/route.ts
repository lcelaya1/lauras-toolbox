import { NextRequest, NextResponse } from "next/server";
import { deleteTask } from "@/lib/meetings-tasks";

// Protected by proxy.ts (signed-in Toolbox user only).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { taskId?: unknown } | null;
  if (typeof body?.taskId !== "string") {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  const result = await deleteTask(body.taskId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
