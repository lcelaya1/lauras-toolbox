import { NextRequest, NextResponse } from "next/server";
import { listMeetings, updateTasks } from "@/lib/meetings-store";

// GET /api/tasks/complete?taskId=xxx&meetingId=xxx&token=yyy
// Called by the Shortcuts automation when a reminder is marked done in Apple Reminders.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId   = searchParams.get("taskId");
  const meetingId = searchParams.get("meetingId");
  const token    = searchParams.get("token");

  if (!taskId || !meetingId || !token) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const secret = process.env.TASKS_SECRET;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetings } = await listMeetings();
  const meeting = meetings.find((m) => m.id === meetingId);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const updated = meeting.tasks.map((t) =>
    t.id === taskId ? { ...t, done: true } : t,
  );

  await updateTasks(meetingId, updated);

  // Return a friendly HTML page so Safari auto-closes cleanly on iOS
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Tarea completada</title>
    <style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb;}
    .box{text-align:center;padding:2rem;}.check{font-size:3rem;}.msg{color:#374151;font-size:1.1rem;margin-top:.5rem;}</style>
    </head><body><div class="box"><div class="check">✅</div>
    <p class="msg">Tarea marcada como completada</p>
    <p style="color:#9ca3af;font-size:.85rem">Puedes cerrar esta pestaña</p>
    </div></body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
