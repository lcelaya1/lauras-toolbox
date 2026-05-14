import { NextRequest, NextResponse } from "next/server";
import { listRecordings, addRecording, registerRecording } from "@/lib/blob-store";

export const maxDuration = 60;

export async function GET() {
  const recs = await listRecordings();
  return NextResponse.json(recs);
}

export async function POST(req: NextRequest) {
  let file: File | null = null;
  let name = "Grabación";
  let durationMs: number | undefined;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: Record<string, string>;
    try {
      const raw = await req.text();
      body = JSON.parse(raw.replace(/[\r\n]/g, ""));
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Case 1: file already uploaded to R2 via presigned URL
    if (body.preUploaded === "true") {
      const { id: recId, name: recName, mimeType: recMime, ext: recExt } = body;
      const rawExt = recExt ?? (recMime.split("/")[1] ?? "m4a").split(";")[0];
      const ext = rawExt === "x-m4a" ? "m4a" : rawExt;
      const key = `audio/${recId}.${ext}`;
      const rec = await registerRecording({
        id: recId,
        name: recName ?? "Grabación",
        date: new Date().toISOString(),
        transcript: "",
        audioUrl: `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`,
        mimeType: recMime ?? "audio/mp4",
      });
      return NextResponse.json(rec, { status: 201 });
    }

    // Case 2: iOS Shortcut — base64-encoded audio
    const b64: string = (body.audioBase64 ?? "").replace(/\s/g, "");
    const mimeType: string = body.mimeType ?? "audio/mp4";
    name = body.name ?? "Nota de voz";
    if (b64) {
      const bytes = Buffer.from(b64, "base64");
      const ext = mimeType.split("/")[1]?.split(";")[0] ?? "m4a";
      file = new File([bytes], `recording.${ext}`, { type: mimeType });
    }
  } else {
    const formData = await req.formData();
    file = formData.get("file") as File | null;
    name = (formData.get("name") as string | null) ?? file?.name ?? "Grabación";
    durationMs = formData.get("durationMs") ? Number(formData.get("durationMs")) : undefined;
  }

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // No inline transcription — keeps the function fast and within Vercel's timeout.
  // Transcription is triggered on-demand from the recording detail view.
  const rec = await addRecording(
    {
      id: crypto.randomUUID(),
      name,
      date: new Date().toISOString(),
      transcript: "",
      audioUrl: "",
      mimeType: file.type || "audio/mp4",
      durationMs,
    },
    file,
  );

  return NextResponse.json(rec, { status: 201 });
}
