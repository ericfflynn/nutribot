import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { syncRecentHealth } from "@/lib/health/recent-sync";

export const dynamic = "force-dynamic";
// The light sync takes about 10 seconds, up to 20.
export const maxDuration = 60;

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
  return Response.json({ synced });
}
