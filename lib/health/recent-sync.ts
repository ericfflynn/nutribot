import { after } from "next/server";
import { refreshRecentBodyStates } from "@/lib/body-state/store";
import { HEALTH_DATA_TYPES } from "@/lib/health/google";
import { runHealthSync } from "@/lib/health/sync";
import { getPool } from "@/lib/supabase";

// The light sync, for the Fitbit owner only, unless a run started within
// `skipWithin` (a Postgres interval; with runningOnly, only a run still going
// counts). Returns whether it ran.
export async function syncRecentHealth(userName: string, skipWithin: string, runningOnly: boolean) {
  const db = getPool();
  if (!db || userName !== process.env.GOOGLE_HEALTH_USER) return false;
  const { rows } = await db.query(
    `
    select 1 from public.health_sync_runs
    where user_name = $1 and started_at > now() - $2::interval
      and (status = 'running' or (not $3 and status = 'succeeded'))
    limit 1
    `,
    [userName, skipWithin, runningOnly]
  );
  if (rows.length) return false;
  try {
    await runHealthSync(db, { trigger: "manual", userName, types: HEALTH_DATA_TYPES, recentDays: 3 });
  } catch {
    // The failure is recorded in health_sync_runs and shown on Today.
  }
  after(async () => {
    try {
      await refreshRecentBodyStates(db, userName);
    } catch {
      console.error("body state refresh failed");
    }
  });
  return true;
}
