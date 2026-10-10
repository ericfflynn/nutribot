import { getSessionUser } from "@/lib/auth";
import { BrainError } from "@/lib/claude-brain";
import { parseWorkout } from "@/lib/workout-parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TEXT = 8000;

// Parses a workout blob into movements, sets and muscle volume. Read-only:
// nothing is saved yet.
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT) {
    return Response.json({ error: `Send { text } with 1-${MAX_TEXT} characters.` }, { status: 400 });
  }

  try {
    const result = await parseWorkout(text);
    return Response.json(result);
  } catch (error) {
    // Don't echo raw errors; they can include request details.
    const message = error instanceof BrainError ? error.message : "Workout parse failed";
    console.error("workout parse failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: message }, { status: 500 });
  }
}
