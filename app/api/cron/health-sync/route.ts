import { timingSafeEqual } from "crypto";
import { HEALTH_DATA_TYPES } from "@/lib/health/google";
import { runHealthSync } from "@/lib/health/sync";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RECENT_DAYS = 3;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return (
    Boolean(secret) &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
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
    return Response.json(result, { status: result.failedTypes.length ? 500 : 200 });
  } catch {
    // The run row holds the sanitized error; don't echo exception details here.
    return Response.json({ error: "Health sync failed" }, { status: 500 });
  }
}
