import { isCronAuthorized } from "@/lib/cron";
import { localDateTime } from "@/lib/dates";
import { sendDueReminders } from "@/lib/reminders";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// One daily Vercel Cron job per UTC hour (Hobby allows each job once a day),
// so this runs every hour; each run sends whatever reminders are due in the
// local hour. ?force=1 sends every enabled reminder now, for testing.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getPool();
  if (!db) return Response.json({ error: "DATABASE_URL is required" }, { status: 500 });

  const now = localDateTime();
  const force = new URL(request.url).searchParams.get("force") === "1";
  const { rows } = await db.query<{ user_name: string }>(`select distinct user_name from public.push_subscriptions`);
  const results = [];
  for (const { user_name } of rows) {
    results.push(await sendDueReminders(db, user_name, now, force));
  }
  return Response.json({ localTime: now, results });
}
