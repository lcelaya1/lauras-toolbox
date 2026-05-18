import { NextRequest, NextResponse } from "next/server";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  try {
    const { id } = await params;

    const recordings = await listRecordings();
    const rec = recordings.find((r) => r.id === id);
    if (!rec) return NextResponse.json({ sizeBytes: 0 });

    const publicUrl = process.env.R2_PUBLIC_URL ?? "";
    const key = rec.audioUrl.startsWith(publicUrl)
      ? rec.audioUrl.slice(publicUrl.length).replace(/^\//, "")
      : rec.audioUrl;

    const res = await r2Client().send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    );

    return NextResponse.json({ sizeBytes: res.ContentLength ?? 0 });
  } catch {
    return NextResponse.json({ sizeBytes: 0 });
  }
}
