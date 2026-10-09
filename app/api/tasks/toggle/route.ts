import { NextRequest, NextResponse } from "next/server";
import { setTaskDone } from "@/lib/meetings-tasks";

// Protected by proxy.ts (signed-in Toolbox user only).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { taskId?: unknown; done?: unknown } | null;
  if (typeof body?.taskId !== "string" || typeof body.done !== "boolean") {
    return NextResponse.json({ error: "taskId and done are required" }, { status: 400 });
  }
  const result = await setTaskDone(body.taskId, body.done, body.done ? "laura" : undefined);
  if (!result) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
