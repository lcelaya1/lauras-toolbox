import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

export interface RecordingMeta {
  id: string;
  name: string;
  date: string;
  transcript: string;
  audioUrl: string;
  mimeType: string;
  durationMs?: number;
}

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

const BUCKET = () => process.env.R2_BUCKET_NAME!;
const PUBLIC_URL = () => process.env.R2_PUBLIC_URL!.replace(/\/$/, "");
const INDEX_KEY = "recordings.json";

async function readIndex(): Promise<RecordingMeta[]> {
  try {
    const res = await r2Client().send(
      new GetObjectCommand({ Bucket: BUCKET(), Key: INDEX_KEY }),
    );
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch {
    return [];
  }
}

async function writeIndex(recs: RecordingMeta[]): Promise<void> {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: INDEX_KEY,
      Body: JSON.stringify(recs),
      ContentType: "application/json",
    }),
  );
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  return readIndex();
}

export async function addRecording(
  rec: RecordingMeta,
  audioBlob: Blob,
): Promise<RecordingMeta> {
  const ext = (rec.mimeType.split("/")[1] ?? "webm").split(";")[0];
  const key = `audio/${rec.id}.${ext}`;

  await r2Client().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: Buffer.from(await audioBlob.arrayBuffer()),
      ContentType: rec.mimeType,
    }),
  );

  const withUrl: RecordingMeta = {
    ...rec,
    audioUrl: `${PUBLIC_URL()}/${key}`,
  };

  const index = await readIndex();
  await writeIndex([withUrl, ...index]);
  return withUrl;
}

export async function updateRecordingTranscript(id: string, transcript: string): Promise<void> {
  const index = await readIndex();
  await writeIndex(index.map((r) => r.id === id ? { ...r, transcript } : r));
}

export async function removeRecording(id: string): Promise<void> {
  const index = await readIndex();
  const rec = index.find((r) => r.id === id);

  if (rec) {
    const ext = (rec.mimeType.split("/")[1] ?? "webm").split(";")[0];
    try {
      await r2Client().send(
        new DeleteObjectCommand({ Bucket: BUCKET(), Key: `audio/${id}.${ext}` }),
      );
    } catch { /* ignore if already gone */ }
  }

  await writeIndex(index.filter((r) => r.id !== id));
}
