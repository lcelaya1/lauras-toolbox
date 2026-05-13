import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { listRecordings } from "@/lib/blob-store";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const recordings = await listRecordings();
  const rec = recordings.find((r) => r.id === id);
  if (!rec) return new NextResponse("Not found", { status: 404 });

  const ext = (rec.mimeType.split("/")[1] ?? "webm").split(";")[0];
  const key = `audio/${id}.${ext}`;

  try {
    const res = await r2Client().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    );
    const body = res.Body;
    if (!body) return new NextResponse("No content", { status: 404 });

    const bytes = await body.transformToByteArray();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": rec.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Audio not found", { status: 404 });
  }
}
