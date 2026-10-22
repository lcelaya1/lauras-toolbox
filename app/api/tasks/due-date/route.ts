import { NextRequest, NextResponse } from "next/server";
import { setDueDate } from "@/lib/meetings-tasks";

// Protected by proxy.ts (signed-in Toolbox user only). dueDate null clears it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { taskId?: unknown; dueDate?: unknown } | null;
  if (typeof body?.taskId !== "string") {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  const dueDate = body.dueDate ?? null;
  if (dueDate !== null && (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    return NextResponse.json({ error: "dueDate must be YYYY-MM-DD or null" }, { status: 400 });
  }
  const result = await setDueDate(body.taskId, dueDate);
  if (!result) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ ok: true, due_date: result.task.dueDate ?? null });
}
