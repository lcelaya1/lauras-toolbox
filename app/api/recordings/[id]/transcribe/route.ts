import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { listRecordings, updateRecordingTranscript } from "@/lib/blob-store";

export const maxDuration = 60;

function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const recordings = await listRecordings();
  const rec = recordings.find((r) => r.id === id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch audio from R2
  const ext = (rec.mimeType.split("/")[1] ?? "m4a").split(";")[0];
  const key = `audio/${id}.${ext}`;
  let audioBytes: Uint8Array;
  try {
    const res = await r2Client().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    );
    audioBytes = await res.Body!.transformToByteArray();
  } catch {
    return NextResponse.json({ error: "Audio not found in storage" }, { status: 404 });
  }

  // Send to Groq
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const form = new FormData();
  // Normalize MIME type — Groq doesn't accept audio/x-m4a
  const groqMime = rec.mimeType.includes("x-m4a") ? "audio/mp4" : rec.mimeType;
  const groqExt  = ext === "x-m4a" ? "m4a" : ext;
  form.append("file", new Blob([Buffer.from(audioBytes)], { type: groqMime }), `audio.${groqExt}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "es");
  form.append("response_format", "text");

  const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!groqRes.ok) {
    const raw = await groqRes.text();

    // Parse rate-limit errors into a readable message
    if (groqRes.status === 429) {
      try {
        // Groq always sends a Retry-After header (seconds)
        const retryAfter = groqRes.headers.get("retry-after");
        let retryIn: string | null = null;

        if (retryAfter) {
          const secs = Math.ceil(parseFloat(retryAfter));
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          retryIn = m > 0 ? `${m}m ${s}s` : `${s}s`;
        } else {
          // Fallback: parse from the message text
          const body = JSON.parse(raw);
          const msg: string = body?.error?.message ?? "";
          const match = msg.match(/try again in ([\d]+m\s*[\d]+s|[\d]+m|[\d]+s)/i);
          retryIn = match ? match[1] : null;
        }

        const friendly = retryIn
          ? `Límite de transcripción alcanzado. Inténtalo de nuevo en ${retryIn}.`
          : "Límite de transcripción alcanzado. Inténtalo en unos minutos.";
        return NextResponse.json({ error: friendly }, { status: 429 });
      } catch { /* fall through to generic */ }
    }

    return NextResponse.json({ error: "Error al transcribir. Inténtalo de nuevo." }, { status: 500 });
  }

  const transcript = (await groqRes.text()).trim();
  await updateRecordingTranscript(id, transcript);

  return NextResponse.json({ transcript });
}
