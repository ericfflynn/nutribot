// The early illness push (docs/illness.md): when the body state shows likely
// early signs nothing answers, one notification, then quiet for 10 days. The
// morning check-in push (docs/body-state.md, step 5) will take this over.
import type { Pool } from "pg";
import { pushToDevices } from "../reminders";
import { getBodyState } from "./load";

// The early-warning push: once, the first time the watch signal reaches
// likely and nothing is logged as sick, then not again for ALERT_QUIET_DAYS.
// Runs after each health sync (app/api/cron/health-sync), during waking hours.
// reminder_sends holds the send under kind 'illness'.
const ALERT_QUIET_DAYS = 10;
const ALERT_HOURS = { from: 7, to: 21 };

export async function sendIllnessAlert(db: Pool, userName: string, localNow: string) {
  const date = localNow.slice(0, 10);
  const hour = Number(localNow.slice(11, 13));
  if (hour < ALERT_HOURS.from || hour > ALERT_HOURS.to) return { status: "quiet hours" };
  // From the body state, so a journal entry tagged sick, a "fine" answer or a
  // fitting explanation (drinks, a late night) all keep it quiet.
  const illness = (await getBodyState(db, userName, date)).physical.illness;
  if (illness.phase !== "early_signs" || illness.signal.level !== "likely") return { status: "no signal" };
  const { rows } = await db.query(
    `
    insert into public.reminder_sends (user_name, local_date, kind)
    select $1, $2::date, 'illness'
    where not exists (
      select 1 from public.reminder_sends
      where user_name = $1 and kind = 'illness' and local_date > $2::date - $3::int
    )
    on conflict do nothing
    returning 1
    `,
    [userName, date, ALERT_QUIET_DAYS]
  );
  if (!rows.length) return { status: "already sent" };
  const delivered = await pushToDevices(db, userName, {
    title: "You may be getting sick",
    body: `${illness.signal.reasons.join(" · ")}. How do you feel?`,
    url: `/chat?${new URLSearchParams({ prompt: "I'm feeling sick: " }).toString()}`
  });
  if (!delivered) {
    // Let the next sync try again.
    await db.query(`delete from public.reminder_sends where user_name = $1 and local_date = $2::date and kind = 'illness'`, [userName, date]);
  }
  return { status: delivered ? "sent" : "not delivered", devices: delivered };
}
