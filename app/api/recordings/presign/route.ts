import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

// Allow direct browser PUT uploads to R2 (idempotent)
async function ensureCors(client: S3Client, bucket: string) {
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["PUT"],
              AllowedHeaders: ["Content-Type", "Content-Length"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch {
    // Non-fatal — may already be configured or not supported
  }
}

export async function POST(req: NextRequest) {
  const { mimeType } = await req.json();

  const id = crypto.randomUUID();
  const rawExt = (mimeType.split("/")[1] ?? "m4a").split(";")[0];
  const ext = rawExt === "x-m4a" ? "m4a" : rawExt;
  const key = `audio/${id}.${ext}`;

  const client = r2Client();
  const bucket = process.env.R2_BUCKET_NAME!;

  await ensureCors(client, bucket);

  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType }),
    { expiresIn: 3600 },
  );

  return NextResponse.json({ id, uploadUrl, ext });
}
