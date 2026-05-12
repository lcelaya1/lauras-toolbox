import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not configured" }, { status: 500 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  const groqForm = new FormData();
  groqForm.append("file", file, (file as File).name ?? "audio.webm");
  groqForm.append("model", "whisper-large-v3-turbo");
  groqForm.append("language", "es");
  groqForm.append("response_format", "text");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: groqForm,
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json({ error: `Groq API error: ${detail}` }, { status: response.status });
  }

  const text = await response.text();
  return NextResponse.json({ text });
}
