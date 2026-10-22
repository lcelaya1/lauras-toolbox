import { NextRequest, NextResponse } from "next/server";
import { addStandaloneTask } from "@/lib/meetings-tasks";
import type { TaskCategory } from "@/lib/meetings-store";

const CATEGORIES: TaskCategory[] = ["FG", "COPSUP", "VEN", "4o", "WF", "OPS", "PFGs", "TiB"];

// Protected by proxy.ts (signed-in Toolbox user only).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { text?: unknown; category?: unknown; dueDate?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const category = (body?.category ?? "OPS") as TaskCategory;
  const dueDate = body?.dueDate || undefined;
  if (text.length < 3 || text.length > 500) {
    return NextResponse.json({ error: "text must be 3–500 characters" }, { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (dueDate !== undefined && (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    return NextResponse.json({ error: "dueDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const result = await addStandaloneTask(text, category, dueDate);
  return NextResponse.json({ ok: true, ...result });
}
