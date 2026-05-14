import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // forcePathStyle avoids virtual-hosted subdomain DNS issues
    // e.g. https://account.r2.../bucket/key  (not  https://bucket.account.r2.../key)
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    // Disable automatic CRC32 checksums — the SDK calculates them for an
    // empty body at sign time, so R2 rejects the real file on upload.
    requestChecksumCalculation: "WHEN_REQUIRED" as never,
    responseChecksumValidation: "WHEN_REQUIRED" as never,
  });
}

export async function POST(req: NextRequest) {
  const { mimeType } = await req.json();

  const id = crypto.randomUUID();
  const ext = (mimeType.split("/")[1] ?? "m4a").split(";")[0];
  const key = `audio/${id}.${ext}`;

  const client = r2Client();
  const bucket = process.env.R2_BUCKET_NAME!;

  // Generate presigned PUT URL (valid for 1 hour).
  // ContentType is deliberately omitted from the command so the client
  // doesn't need to reproduce it exactly in X-Amz-SignedHeaders.
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 },
  );

  return NextResponse.json({ id, uploadUrl, ext });
}
