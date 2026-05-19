import { NextRequest, NextResponse } from "next/server";
import { listMeetings, syncMeetings, createMeeting } from "@/lib/meetings-store";

export const maxDuration = 60;

export async function GET() {
  const data = await listMeetings();
  return NextResponse.json(data);
}

interface GranolaNote {
  id: string;
  title?: string;
  summary_text?: string;
  summary_markdown?: string;
  created_at?: string;
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  // Manual meeting creation
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await req.json();
    if (body.manual) {
      const meeting = await createMeeting({
        title: body.title,
        createdAt: body.createdAt,
        summaryMarkdown: body.summaryMarkdown ?? "",
      });
      return NextResponse.json(meeting, { status: 201 });
    }
  }

  const apiKey = process.env.GRANOLA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GRANOLA_API_KEY not configured" }, { status: 500 });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Step 1: collect all note IDs from the list endpoint (paginated)
  let page = 1;
  const noteIds: string[] = [];

  while (true) {
    const res = await fetch(`https://public-api.granola.ai/v1/notes?page=${page}&per_page=100`, { headers });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Granola API error ${res.status}: ${body}` }, { status: res.status });
    }
    const data = await res.json();
    const notes: { id: string }[] = Array.isArray(data) ? data : (data.notes ?? data.data ?? []);
    noteIds.push(...notes.map((n) => n.id));
    if (notes.length < 100) break;
    page++;
  }

  // Step 2: fetch each note individually for full content
  const fullNotes: GranolaNote[] = await Promise.all(
    noteIds.map(async (id) => {
      const res = await fetch(`https://public-api.granola.ai/v1/notes/${id}`, { headers });
      if (!res.ok) return { id };
      return res.json();
    }),
  );

  const incoming = fullNotes.map((note) => ({
    granolaId: note.id,
    title: (note.title as string) ?? "Sin título",
    summary: (note.summary_text as string) ?? "",
    summaryMarkdown: (note.summary_markdown as string) ?? "",
    transcriptJson: note.transcript ? JSON.stringify(note.transcript) : "",
    sessionNotes: "",
    createdAt: (note.created_at as string) ?? new Date().toISOString(),
    rawJson: JSON.stringify(note),
  }));

  const result = await syncMeetings(incoming);
  return NextResponse.json(result);
}
