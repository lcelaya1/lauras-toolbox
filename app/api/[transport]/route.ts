import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { listMeetings, updateTasks } from "@/lib/meetings-store";
import { listRecordings } from "@/lib/blob-store";

export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    // ── Meetings ─────────────────────────────────────────────────────────

    server.registerTool(
      "list_meetings",
      {
        title: "List Meetings",
        description: "List all stored meetings with title, date and a short preview of the notes.",
        inputSchema: {},
      },
      async () => {
        const { meetings } = await listMeetings();
        const rows = meetings.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.createdAt,
          preview: (m.summaryMarkdown || m.summary)
            .slice(0, 150)
            .replace(/\n/g, " ")
            .trim(),
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
      },
    );

    server.registerTool(
      "get_meeting",
      {
        title: "Get Meeting",
        description: "Get full details for a specific meeting: notes, attendees and session notes.",
        inputSchema: { id: z.string().describe("Meeting ID from list_meetings") },
      },
      async ({ id }) => {
        const { meetings } = await listMeetings();
        const m = meetings.find((m) => m.id === id);
        if (!m) return { content: [{ type: "text" as const, text: `Meeting ${id} not found.` }], isError: true };

        let attendees: string[] = [];
        try {
          const raw = JSON.parse(m.rawJson);
          const people = raw.attendees ?? raw.participants ?? [];
          attendees = Array.isArray(people)
            ? people
                .map((p: { name?: string; email?: string } | string) =>
                  typeof p === "string" ? p : (p.name ?? p.email ?? ""),
                )
                .filter(Boolean)
            : [];
        } catch { /* no attendee data */ }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: m.id,
              title: m.title,
              date: m.createdAt,
              attendees,
              notes: m.summaryMarkdown || m.summary,
              sessionNotes: m.sessionNotes || null,
            }, null, 2),
          }],
        };
      },
    );

    server.registerTool(
      "search_meetings",
      {
        title: "Search Meetings",
        description: "Search meetings by keyword across titles and notes. Returns matching meetings with a preview.",
        inputSchema: { query: z.string().describe("Keyword or phrase to search for") },
      },
      async ({ query }) => {
        const { meetings } = await listMeetings();
        const q = query.toLowerCase();
        const results = meetings
          .filter(
            (m) =>
              m.title.toLowerCase().includes(q) ||
              m.summaryMarkdown.toLowerCase().includes(q) ||
              m.summary.toLowerCase().includes(q),
          )
          .map((m) => ({
            id: m.id,
            title: m.title,
            date: m.createdAt,
            preview: (m.summaryMarkdown || m.summary).slice(0, 200).replace(/\n/g, " ").trim(),
          }));

        return {
          content: [{
            type: "text" as const,
            text: results.length > 0
              ? JSON.stringify(results, null, 2)
              : `No meetings found matching "${query}".`,
          }],
        };
      },
    );

    server.registerTool(
      "save_tasks",
      {
        title: "Save Tasks",
        description: `Save a list of tasks extracted from a meeting back into the app. Each task must be assigned one of Laura's project categories:
- FG → Future Game
- COPSUP → COP / SUP
- VEN → Ventures
- 4o → 4o
- WF → Workshop Fundamentals
- OPS → Operations (use for general or cross-cutting tasks)
- PFGs → PFGs
Tasks will appear grouped by category in the meeting detail view.`,
        inputSchema: {
          meetingId: z.string().describe("Meeting ID from list_meetings or get_meeting"),
          tasks: z.array(z.object({
            text: z.string().describe("Task description"),
            category: z.enum(["FG", "COPSUP", "VEN", "4o", "WF", "OPS", "PFGs"])
              .describe("Project category for this task. Default to OPS if unclear."),
          })).describe("List of tasks assigned to Laura, each with a category"),
        },
      },
      async ({ meetingId, tasks }) => {
        const { meetings } = await listMeetings();
        const meeting = meetings.find((m) => m.id === meetingId);
        if (!meeting) {
          return { content: [{ type: "text" as const, text: `Meeting ${meetingId} not found.` }], isError: true };
        }
        const taskObjects = tasks.map(({ text, category }) => ({ text, done: false, category }));
        await updateTasks(meetingId, taskObjects);
        return {
          content: [{
            type: "text" as const,
            text: `✓ Saved ${tasks.length} task${tasks.length !== 1 ? "s" : ""} to "${meeting.title}".`,
          }],
        };
      },
    );

    // ── Recordings ────────────────────────────────────────────────────────

    server.registerTool(
      "list_recordings",
      {
        title: "List Recordings",
        description: "List all audio recordings with name, date, duration and whether a transcript exists.",
        inputSchema: {},
      },
      async () => {
        const recordings = await listRecordings();
        const rows = recordings.map((r) => ({
          id: r.id,
          name: r.name,
          date: r.date,
          durationMs: r.durationMs ?? null,
          hasTranscript: !!r.transcript,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
      },
    );

    server.registerTool(
      "get_recording",
      {
        title: "Get Recording",
        description: "Get full details for a specific recording including its full transcript.",
        inputSchema: { id: z.string().describe("Recording ID from list_recordings") },
      },
      async ({ id }) => {
        const recordings = await listRecordings();
        const rec = recordings.find((r) => r.id === id);
        if (!rec) return { content: [{ type: "text" as const, text: `Recording ${id} not found.` }], isError: true };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: rec.id,
              name: rec.name,
              date: rec.date,
              durationMs: rec.durationMs ?? null,
              transcript: rec.transcript || "No transcript available.",
            }, null, 2),
          }],
        };
      },
    );
  },
  {
    serverInfo: { name: "lauras-toolbox", version: "1.0.0" },
  },
  {
    basePath: "/api",
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST };
