import { NextRequest, NextResponse } from "next/server";
import { updateTask } from "@/lib/meetings-tasks";
import type { TaskCategory } from "@/lib/meetings-store";

const CATEGORIES: TaskCategory[] = ["FG", "COPSUP", "VEN", "4o", "WF", "OPS", "PFGs", "TiB"];

// Protected by proxy.ts (signed-in Toolbox user only). Only the fields sent are changed;
// dueDate null clears it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    { taskId?: unknown; text?: unknown; category?: unknown; dueDate?: unknown } | null;
  if (typeof body?.taskId !== "string") {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  const { text, category, dueDate } = body;
  if (text !== undefined && (typeof text !== "string" || text.trim().length < 3 || text.length > 500)) {
    return NextResponse.json({ error: "text must be 3–500 characters" }, { status: 400 });
  }
  if (category !== undefined && !CATEGORIES.includes(category as TaskCategory)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (dueDate !== undefined && dueDate !== null && (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    return NextResponse.json({ error: "dueDate must be YYYY-MM-DD or null" }, { status: 400 });
  }
  const result = await updateTask(body.taskId, {
    text: text as string | undefined, category: category as TaskCategory | undefined, dueDate: dueDate as string | null | undefined,
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
