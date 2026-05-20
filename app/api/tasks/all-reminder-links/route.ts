import { NextRequest, NextResponse } from "next/server";
import { listMeetings } from "@/lib/meetings-store";

// GET /api/tasks/all-reminder-links?meetingId=X
// Returns a single shortcuts:// URL that passes all tasks as a JSON array.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const meetingId = searchParams.get("meetingId");

  if (!meetingId) {
    return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
  }

  const { meetings } = await listMeetings();
  const meeting = meetings.find((m) => m.id === meetingId);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const secret = process.env.TASKS_SECRET ?? "";

  const pending = meeting.tasks.filter((t) => !t.done);

  const payload = pending.map((task) => ({
    name: `${task.category ?? "OPS"} - ${task.text}`,
    notes: `${appUrl}/api/tasks/complete?taskId=${task.id}&meetingId=${meetingId}&token=${secret}`,
  }));

  const shortcutUrl = `shortcuts://run-shortcut?name=A%C3%B1adir%20todas%20a%20Reminders&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`;

  return NextResponse.json({ shortcutUrl, count: pending.length });
}
