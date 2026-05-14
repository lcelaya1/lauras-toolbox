import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
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
  });
}

async function ensureCors(client: S3Client, bucket: string): Promise<string | null> {
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      }),
    );
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
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

  const corsError = await ensureCors(client, bucket);

  // Generate presigned PUT URL (valid for 1 hour)
  // We deliberately omit ContentType from the command so the browser
  // doesn't need to reproduce it exactly in X-Amz-SignedHeaders.
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 },
  );

  return NextResponse.json({ id, uploadUrl, ext, corsError });
}
