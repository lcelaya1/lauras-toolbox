import { NextRequest, NextResponse } from "next/server";
import { listMeetings } from "@/lib/meetings-store";

// GET /api/tasks/reminder-link?taskId=X&meetingId=Y&name=TASK_NAME
// Returns a JSON payload {name, notes} where notes is the meeting title + date.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId    = searchParams.get("taskId");
  const meetingId = searchParams.get("meetingId");
  const name      = searchParams.get("name") ?? "";

  if (!taskId || !meetingId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const { meetings } = await listMeetings();
  const meeting = meetings.find((m) => m.id === meetingId);

  const meetingTitle = meeting?.title ?? "";
  const meetingDate  = meeting
    ? new Date(meeting.createdAt).toLocaleDateString("es-ES", {
        day: "numeric", month: "long", year: "numeric",
      })
    : "";

  const notes   = meetingTitle ? `${meetingTitle} · ${meetingDate}` : meetingDate;
  const payload = JSON.stringify({ name, notes });

  return NextResponse.json({ payload });
}
