import { NextRequest, NextResponse } from "next/server";
import { removeRecording, updateRecordingTranscript, updateRecordingName } from "@/lib/blob-store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  if (body.transcript !== undefined) await updateRecordingTranscript(id, body.transcript);
  if (body.name !== undefined) await updateRecordingName(id, body.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await removeRecording(id);
  return NextResponse.json({ ok: true });
}
