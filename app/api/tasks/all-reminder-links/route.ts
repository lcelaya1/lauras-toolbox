import { NextRequest, NextResponse } from "next/server";
import { listMeetings } from "@/lib/meetings-store";

// GET /api/tasks/all-reminder-links?meetingId=X
// Returns a JSON array of all pending tasks with meeting name + date as notes.
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

  const meetingDate = new Date(meeting.createdAt).toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric",
  });
  const notes = `${meeting.title} · ${meetingDate}`;

  const pending = meeting.tasks.filter((t) => !t.done);

  const payload = JSON.stringify(
    pending.map((task) => ({
      name:  `${task.category ?? "OPS"} - ${task.text}`,
      notes,
    }))
  );

  return NextResponse.json({ payload, count: pending.length });
}
