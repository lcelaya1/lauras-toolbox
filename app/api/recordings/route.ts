import { NextRequest, NextResponse } from "next/server";
import { listRecordings, addRecording } from "@/lib/blob-store";

export async function GET() {
  const recs = await listRecordings();
  return NextResponse.json(recs);
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = (formData.get("name") as string | null) ?? file?.name ?? "Grabación";
  const providedTranscript = formData.get("transcript") as string | null;
  const autoTranscribe = formData.get("transcribe") === "true" || !providedTranscript;
  const durationMs = formData.get("durationMs") ? Number(formData.get("durationMs")) : undefined;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  let transcript = providedTranscript ?? "";

  // Transcribe if not already done (e.g. upload from iPhone Shortcut)
  if (autoTranscribe || !transcript) {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      try {
        const groqForm = new FormData();
        groqForm.append("file", file, file.name);
        groqForm.append("model", "whisper-large-v3-turbo");
        groqForm.append("language", "es");
        groqForm.append("response_format", "text");
        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: groqForm,
        });
        if (res.ok) transcript = (await res.text()).trim();
      } catch { /* proceed without transcript */ }
    }
  }

  const rec = await addRecording(
    {
      id: crypto.randomUUID(),
      name,
      date: new Date().toISOString(),
      transcript,
      audioUrl: "",       // filled by addRecording
      mimeType: file.type || "audio/webm",
      durationMs,
    },
    file,
  );

  return NextResponse.json(rec, { status: 201 });
}
