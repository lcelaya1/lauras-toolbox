import { NextRequest, NextResponse } from "next/server";
import { removeRecording, updateRecordingTranscript } from "@/lib/blob-store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { transcript } = await req.json();
  await updateRecordingTranscript(id, transcript);
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
