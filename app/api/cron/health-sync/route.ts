import { isCronAuthorized } from "@/lib/cron";
import { HEALTH_DATA_TYPES } from "@/lib/health/google";
import { runHealthSync } from "@/lib/health/sync";
import { getPool } from "@/lib/supabase";
import { localDateTime } from "@/lib/dates";
import { sendIllnessAlert } from "@/lib/body-state/alert";
import { refreshRecentBodyStates } from "@/lib/body-state/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RECENT_DAYS = 3;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userName = process.env.GOOGLE_HEALTH_USER;
  const db = getPool();
  if (!userName || !db) {
    return Response.json({ error: "GOOGLE_HEALTH_USER and DATABASE_URL are required" }, { status: 500 });
  }

  try {
    // ?mode=recent refetches the last few days; the default replaces whole months.
    const recent = new URL(request.url).searchParams.get("mode") === "recent";
    const result = await runHealthSync(db, {
      trigger: "cron",
      userName,
      types: HEALTH_DATA_TYPES,
      recentDays: recent ? RECENT_DAYS : undefined
    });
    // Fresh watch data may show the body fighting something.
    let illness: unknown = null;
    try {
      illness = await sendIllnessAlert(db, userName, localDateTime());
    } catch {
      illness = { status: "failed" };
    }
    // Store the last 3 days' and today's body state with the fresh data.
    let bodyStates: unknown = null;
    try {
      bodyStates = await refreshRecentBodyStates(db, userName);
    } catch {
      bodyStates = { status: "failed" };
    }
    return Response.json({ ...result, illness, bodyStates }, { status: result.failedTypes.length ? 500 : 200 });
  } catch {
    // The run row holds the sanitized error; don't echo exception details here.
    return Response.json({ error: "Health sync failed" }, { status: 500 });
  }
}
