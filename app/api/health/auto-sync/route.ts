import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { syncRecentHealth } from "@/lib/health/recent-sync";
import { ensureDailyCall } from "@/lib/body-state/call";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// The light sync takes about 10 seconds, up to 20; the morning call, made
// after the response when it's missing, up to a minute or two more.
export const maxDuration = 300;

// Opening the app (or coming back to it): the light sync, unless one started
// in the last 15 minutes. A route, not a server action: server actions run one
// at a time per page, so a sync there held up water taps and saves behind it.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ synced: false }, { status: 401 });
  const synced = await syncRecentHealth(user.name, "15 minutes", false);
  if (synced) {
    revalidatePath("/");
    revalidatePath("/training");
  }
  // Today's call, if the 7 am run didn't make it (no sleep yet, or a failure).
  const db = getPool();
  if (db && user.name === process.env.GOOGLE_HEALTH_USER) {
    after(async () => {
      try {
        await ensureDailyCall(db, user.name);
      } catch {
        console.error("daily call failed");
      }
    });
  }
  return Response.json({ synced });
}
