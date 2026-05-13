import { put, del, list, head } from "@vercel/blob";

export interface RecordingMeta {
  id: string;
  name: string;
  date: string;       // ISO
  transcript: string;
  audioUrl: string;
  mimeType: string;
  durationMs?: number;
}

const INDEX_PATH = "toolbox/recordings-index.json";

async function readIndex(): Promise<RecordingMeta[]> {
  try {
    const blobs = await list({ prefix: INDEX_PATH });
    if (blobs.blobs.length === 0) return [];
    const res = await fetch(blobs.blobs[0].url, { cache: "no-store" });
    return await res.json();
  } catch {
    return [];
  }
}

async function writeIndex(recs: RecordingMeta[]): Promise<void> {
  await put(INDEX_PATH, JSON.stringify(recs), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
  });
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  return readIndex();
}

export async function addRecording(rec: RecordingMeta, audioBlob: Blob): Promise<RecordingMeta> {
  const ext = rec.mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  const { url } = await put(`toolbox/audio/${rec.id}.${ext}`, audioBlob, {
    access: "public",
    contentType: rec.mimeType,
    allowOverwrite: true,
  });

  const withUrl: RecordingMeta = { ...rec, audioUrl: url };
  const index = await readIndex();
  await writeIndex([withUrl, ...index]);
  return withUrl;
}

export async function removeRecording(id: string): Promise<void> {
  const index = await readIndex();
  const rec = index.find((r) => r.id === id);
  if (rec?.audioUrl) {
    try { await del(rec.audioUrl); } catch { /* ignore if already gone */ }
  }
  await writeIndex(index.filter((r) => r.id !== id));
}
