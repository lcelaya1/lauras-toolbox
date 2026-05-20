import { NextRequest, NextResponse } from "next/server";
import { removeMeeting, updateTranscript, updateSessionNotes, updateNotes, updateTasks } from "@/lib/meetings-store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body.transcript === "string") {
    await updateTranscript(id, body.transcript);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.sessionNotes === "string") {
    await updateSessionNotes(id, body.sessionNotes);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.summaryMarkdown === "string") {
    await updateNotes(id, body.summaryMarkdown);
    return NextResponse.json({ ok: true });
  }
  if (Array.isArray(body.tasks)) {
    await updateTasks(id, body.tasks);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Invalid body" }, { status: 400 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await removeMeeting(id);
  return NextResponse.json({ ok: true });
}
