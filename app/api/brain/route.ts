import { getSessionUser } from "@/lib/auth";
import { runBrain } from "@/lib/brain";
import { BrainError } from "@/lib/claude-brain";
import { appendExchange, historyFrom, listMessages, openDraftsFrom } from "@/lib/chat";
import { isValidLocalDate, todayLocalDate } from "@/lib/dates";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TEXT = 8000;
const THREAD_LIMIT = 40;

// The thread for the chat sheet.
export async function GET() {
  const user = await getSessionUser();
  const db = getPool();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!db) return Response.json({ error: "DATABASE_URL is required" }, { status: 500 });

  return Response.json({ messages: await listMessages(db, user.name, THREAD_LIMIT) });
}

// One chat turn: { message, date } in; { message_id, reply, drafts, meta } out.
export async function POST(request: Request) {
  const user = await getSessionUser();
  const db = getPool();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!db) return Response.json({ error: "DATABASE_URL is required" }, { status: 500 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const date = typeof body?.date === "string" && isValidLocalDate(body.date) ? body.date : todayLocalDate();
  if (!message || message.length > MAX_TEXT) {
    return Response.json({ error: `Send a message of 1-${MAX_TEXT} characters.` }, { status: 400 });
  }

  try {
    const thread = await listMessages(db, user.name, THREAD_LIMIT);
    const reply = await runBrain(message, {
      db,
      userName: user.name,
      viewDate: date,
      history: historyFrom(thread),
      openDrafts: openDraftsFrom(thread),
      syncIfMissing: true
    });
    const messageId = await appendExchange(db, user.name, message, reply);
    return Response.json({ message_id: messageId, ...reply });
  } catch (error) {
    // Don't echo raw errors; they can include request details.
    console.error("brain failed", error instanceof Error ? error.name : "unknown");
    const text = error instanceof BrainError ? error.message : "The assistant couldn't answer. Try again.";
    return Response.json({ error: text }, { status: 500 });
  }
}
