import { NextRequest, NextResponse } from "next/server";
import { removeRecording } from "@/lib/blob-store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await removeRecording(id);
  return NextResponse.json({ ok: true });
}
