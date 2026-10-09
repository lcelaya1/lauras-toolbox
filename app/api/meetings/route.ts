import { NextRequest, NextResponse } from "next/server";
import { listMeetings, createMeeting } from "@/lib/meetings-store";

export const maxDuration = 60;

export async function GET() {
  const { meetings, lastSyncedAt, syncStats } = await listMeetings();
  return NextResponse.json({ meetings, lastSyncedAt, syncStats });
}

// Granola meetings are saved by the morning brief through the MCP tools
// (find_unsaved_meetings / save_meetings); Granola's public API is no longer used.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.manual) {
    return NextResponse.json({ error: "Only manual meeting creation is supported" }, { status: 400 });
  }
  const meeting = await createMeeting({
    title: body.title,
    createdAt: body.createdAt,
    summaryMarkdown: body.summaryMarkdown ?? "",
  });
  return NextResponse.json(meeting, { status: 201 });
}
