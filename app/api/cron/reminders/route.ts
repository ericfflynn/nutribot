import { isCronAuthorized } from "@/lib/cron";
import { localDateTime } from "@/lib/dates";
import { REMINDER_HOUR, sendDailyReminder } from "@/lib/reminders";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Two daily Vercel Cron jobs (00:00 and 01:00 UTC) cover 8 pm Eastern in
// summer and winter; only the one landing in the local 8 pm hour sends.
// ?force=1 sends now, for testing.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getPool();
  if (!db) return Response.json({ error: "DATABASE_URL is required" }, { status: 500 });

  const now = localDateTime();
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && Number(now.slice(11, 13)) !== REMINDER_HOUR) {
    return Response.json({ skipped: `local time is ${now.slice(11)}` });
  }

  const { rows } = await db.query<{ user_name: string }>(`select distinct user_name from public.push_subscriptions`);
  const results = [];
  for (const { user_name } of rows) {
    results.push(await sendDailyReminder(db, user_name, now.slice(0, 10)));
  }
  return Response.json({ date: now.slice(0, 10), results });
}
