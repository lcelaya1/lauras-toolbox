import { NextRequest, NextResponse } from "next/server";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { registerRecording } from "@/lib/blob-store";

export const maxDuration = 60;

function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET_NAME!;
const PUBLIC_URL = () => process.env.R2_PUBLIC_URL!.replace(/\/$/, "");

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const chunk = form.get("chunk") as Blob | null;
  const id = form.get("id") as string;
  const chunkIndex = Number(form.get("chunkIndex"));
  const totalChunks = Number(form.get("totalChunks"));
  const mimeType = (form.get("mimeType") as string | null) ?? "audio/mp4";
  const name = (form.get("name") as string | null) ?? "Grabación";

  if (!chunk || !id) {
    return NextResponse.json({ error: "Missing chunk or id" }, { status: 400 });
  }

  // Keep ext as-is (don't normalise x-m4a → m4a here).
  // The transcribe route derives the key the same way from the stored mimeType,
  // so they must stay in sync — both use the raw subtype string.
  const ext = (mimeType.split("/")[1] ?? "m4a").split(";")[0];

  const client = r2Client();
  const bucket = BUCKET();

  // Store this chunk in R2
  const chunkBytes = Buffer.from(await chunk.arrayBuffer());
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `temp/${id}/${chunkIndex}`,
      Body: chunkBytes,
    }),
  );

  // If not the last chunk, we're done for now
  if (chunkIndex < totalChunks - 1) {
    return NextResponse.json({ done: false, chunkIndex });
  }

  // ── Last chunk received — assemble all chunks ──
  const parts: Buffer[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: `temp/${id}/${i}` }),
    );
    parts.push(Buffer.from(await res.Body!.transformToByteArray()));
  }

  const assembled = Buffer.concat(parts);
  const finalKey = `audio/${id}.${ext}`;

  // Upload assembled file
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: finalKey,
      Body: assembled,
      ContentType: mimeType,
    }),
  );

  // Register in the recordings index
  await registerRecording({
    id,
    name,
    date: new Date().toISOString(),
    transcript: "",
    audioUrl: `${PUBLIC_URL()}/${finalKey}`,
    mimeType,
  });

  // Clean up temp chunks (fire-and-forget)
  for (let i = 0; i < totalChunks; i++) {
    client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: `temp/${id}/${i}` }))
      .catch(() => {});
  }

  return NextResponse.json({ done: true, id });
}
