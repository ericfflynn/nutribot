// Builds stored body states for a range of days (docs/body-state.md, Storage):
// the backfill from June, and the full rebuild after the rules change. A dry
// run by default: it builds every day and says how many would change.
//
//   npm run body:states                     # dry run, from the first watch day to today
//   npm run body:states -- --from 2026-10-01
//   npm run body:states -- --apply          # write new versions (trigger "rebuild")
import { addDays, todayLocalDate } from "../lib/dates";
import { getBodyState } from "../lib/body-state/load";
import { refreshBodyStates, stateHash } from "../lib/body-state/store";
import { getPool } from "../lib/supabase";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const db = getPool();
  const userName = process.env.GOOGLE_HEALTH_USER;
  if (!db || !userName) throw new Error("DATABASE_URL and GOOGLE_HEALTH_USER are required.");
  const today = todayLocalDate();
  const { rows: first } = await db.query<{ day: string }>(
    `select min(day)::text as day from public.health_daily where user_name = $1 and resting_hr is not null`,
    [userName]
  );
  const from = arg("from") ?? first[0]?.day ?? addDays(today, -30);
  const to = arg("to") ?? today;
  const apply = process.argv.includes("--apply");

  if (apply) {
    const started = Date.now();
    const result = await refreshBodyStates(db, userName, from, "rebuild", { to, pastTrigger: "rebuild" });
    console.log(`${from} to ${to}: built ${result.built} days, saved ${result.saved} new versions in ${Math.round((Date.now() - started) / 1000)} s.`);
  } else {
    // Before the table exists every day counts as new.
    const rows = await db
      .query<{ date: string; hash: string }>(
        `select state_date::text as date, state_hash as hash from public.body_state_current where user_name = $1`,
        [userName]
      )
      .then((result) => result.rows)
      .catch(() => []);
    const current = new Map(rows.map((row) => [row.date, row.hash]));
    let changed = 0;
    let days = 0;
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const state = await getBodyState(db, userName, date, "rebuild");
      days += 1;
      if (current.get(date) !== stateHash(state)) changed += 1;
    }
    console.log(`Dry run, ${from} to ${to}: ${days} days, ${changed} would get a new version. Run with --apply to write.`);
  }
  await db.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
