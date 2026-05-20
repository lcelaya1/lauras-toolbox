import { NextRequest, NextResponse } from "next/server";

// GET /api/tasks/reminder-link?taskId=X&meetingId=Y&name=TASK_NAME
// Returns the full shortcuts:// URL with the secret embedded server-side.
// This keeps TASKS_SECRET out of the client bundle.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId   = searchParams.get("taskId");
  const meetingId = searchParams.get("meetingId");
  const name     = searchParams.get("name") ?? "";

  if (!taskId || !meetingId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const secret = process.env.TASKS_SECRET ?? "";

  const completeUrl = `${appUrl}/api/tasks/complete?taskId=${taskId}&meetingId=${meetingId}&token=${secret}`;

  const payload = JSON.stringify({ name, notes: completeUrl });

  return NextResponse.json({ payload });
}
