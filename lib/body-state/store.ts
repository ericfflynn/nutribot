// Storing body states over time (docs/body-state.md, Storage): one row per
// version per day in body_states, the state as JSONB. A day's newest version
// is its truth; older versions are what the app believed then. Saves that
// change nothing are skipped.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { addDays, todayLocalDate } from "../dates";
import { getBodyState } from "./load";
import { SCHEMA_VERSION, type BodyState } from "./types";

type Queryable = Pick<Pool, "query">;

export const TRIGGERS = ["morning", "checkin", "report", "late_data", "rebuild", "live"] as const;
export type Trigger = (typeof TRIGGERS)[number];

// How far back a late entry's rebuild reaches. Older dates still rebuild
// through a full rebuild (scripts/body-states.ts).
const MAX_REBUILD_DAYS = 60;

// The hash of what the state says, without meta (build time, trigger, sync).
export function stateHash(state: BodyState) {
  const { meta: _meta, ...rest } = state;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 32);
}

// Upgrades, one per schema step: UPGRADES[1] turns a v1 state into v2. Readers
// only ever see the current shape; rows in the database are never migrated.
const UPGRADES: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {};

export function upgradeState(raw: Record<string, unknown>, fromVersion: number): BodyState {
  let state = raw;
  for (let version = fromVersion; version < SCHEMA_VERSION; version += 1) {
    const step = UPGRADES[version];
    if (!step) throw new Error(`No upgrade from body state v${version}.`);
    state = step(state);
  }
  return state as unknown as BodyState;
}

// Saves a new version when the state differs from the day's current one.
export async function saveBodyState(db: Queryable, userName: string, state: BodyState, trigger: Trigger) {
  const hash = stateHash(state);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { rows } = await db.query<{ version: number }>(
        `
        with current as (
          select version, state_hash from public.body_states
          where user_name = $1 and state_date = $2::date
          order by version desc limit 1
        )
        insert into public.body_states (user_name, state_date, version, trigger, schema_version, state, state_hash)
        select $1, $2::date, coalesce((select version from current), 0) + 1, $3, $4, $5::jsonb, $6
        where coalesce((select state_hash from current), '') <> $6
        returning version
        `,
        [userName, state.meta.date, trigger, SCHEMA_VERSION, JSON.stringify({ ...state, meta: { ...state.meta, trigger } }), hash]
      );
      return { saved: rows.length > 0, version: rows[0]?.version ?? null };
    } catch (error) {
      // Two saves for the same day at once: the loser retries on the new version.
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Couldn't save the body state.");
}

// Rebuilds `from` through today (a late entry reaches forward: streaks,
// baselines and carried sick days). Today gets `trigger`; earlier days are
// late_data, or rebuild for a full rebuild.
export async function refreshBodyStates(
  db: Pool,
  userName: string,
  from: string,
  trigger: Trigger,
  options: { to?: string; pastTrigger?: Trigger } = {}
) {
  const today = todayLocalDate();
  const to = options.to ?? today;
  let date = from < addDays(today, -MAX_REBUILD_DAYS) && !options.to ? addDays(today, -MAX_REBUILD_DAYS) : from;
  if (date > to) date = to;
  let saved = 0;
  let built = 0;
  for (; date <= to; date = addDays(date, 1)) {
    const dayTrigger = date === today ? trigger : (options.pastTrigger ?? "late_data");
    const state = await getBodyState(db, userName, date, dayTrigger);
    built += 1;
    if ((await saveBodyState(db, userName, state, dayTrigger)).saved) saved += 1;
  }
  return { built, saved };
}

// After a health sync: the last 3 days and today. Today's first version of
// the day is the morning one.
export async function refreshRecentBodyStates(db: Pool, userName: string) {
  const today = todayLocalDate();
  const { rows } = await db.query(`select 1 from public.body_states where user_name = $1 and state_date = $2::date limit 1`, [
    userName,
    today
  ]);
  return refreshBodyStates(db, userName, addDays(today, -3), rows.length ? "late_data" : "morning");
}

export type StoredBodyState = {
  date: string;
  version: number;
  trigger: Trigger;
  builtAt: string;
  state: BodyState;
};

type Row = { date: string; version: number; trigger: Trigger; builtAt: string; schemaVersion: number; state: Record<string, unknown> };

const SELECT = `state_date::text as "date", version, trigger, built_at::text as "builtAt", schema_version as "schemaVersion", state`;

const decode = (row: Row): StoredBodyState => ({
  date: row.date,
  version: row.version,
  trigger: row.trigger,
  builtAt: row.builtAt,
  state: upgradeState(row.state, row.schemaVersion)
});

// Each day's current (newest) version in a range, oldest first.
export async function listBodyStates(db: Queryable, userName: string, start: string, end: string): Promise<StoredBodyState[]> {
  const { rows } = await db.query<Row>(
    `select ${SELECT} from public.body_state_current where user_name = $1 and state_date between $2::date and $3::date order by state_date`,
    [userName, start, end]
  );
  return rows.map(decode);
}

// Every version of one day, oldest first: what the app believed as the day went on.
export async function listBodyStateVersions(db: Queryable, userName: string, date: string): Promise<StoredBodyState[]> {
  const { rows } = await db.query<Row>(
    `select ${SELECT} from public.body_states where user_name = $1 and state_date = $2::date order by version`,
    [userName, date]
  );
  return rows.map(decode);
}
