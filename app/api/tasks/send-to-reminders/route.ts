import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// POST /api/tasks/send-to-reminders
// Uses osascript to create a date-only reminder (no time) on macOS.
// Only works when the app is running locally. Falls back gracefully otherwise.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const list = body.list ?? "Recordatorios";

  // Accept either a single task or an array
  const tasks: { name: string; notes: string }[] = body.tasks
    ? body.tasks
    : [{ name: body.name, notes: body.notes }];

  // Escape for AppleScript string literals
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const remindersBlock = tasks.map(({ name, notes }) => `
    set r to make new reminder with properties {name:"${esc(name)}", body:"${esc(notes)}"}
    set d to current date
    set hours of d to 0
    set minutes of d to 0
    set seconds of d to 0
    set due date of r to d`).join("\n");

  const script = `tell application "Reminders"\n  tell list "${esc(list)}"${remindersBlock}\n  end tell\nend tell`;

  try {
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "osascript failed — only works when running locally on macOS" },
      { status: 500 },
    );
  }
}
