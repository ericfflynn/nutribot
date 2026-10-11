// Tracked habits (habits) and their logs (habit_logs). Habits are rows, so new
// ones are added through chat. A log's amount is an intensity 1-3, a count or
// minutes; 0 means "didn't today", said explicitly. A day with no logs is
// unknown, never zero. Plan: docs/journal-habits-plan.md.
import type { Pool } from "pg";

type Queryable = Pick<Pool, "query">;

export const HABIT_MEASURES = ["intensity", "count", "minutes"] as const;
export type HabitMeasure = (typeof HABIT_MEASURES)[number];
export const HABIT_DIRECTIONS = ["limit", "build"] as const;
export type HabitDirection = (typeof HABIT_DIRECTIONS)[number];

export const INTENSITY_LABELS = ["None", "Light", "Moderate", "Heavy"] as const;

export type HabitInput = {
  name: string;
  measure: HabitMeasure;
  unit: string | null; // for counts: "drinks"
  direction: HabitDirection;
  scaleGuide: string | null; // what 1, 2 and 3 mean, for intensity habits
  cutoff: string | null; // local "HH:MM" after which use counts as late
  active: boolean;
};

export type Habit = HabitInput & { id: string };

export type HabitLogInput = {
  habitId: string;
  amount: number;
  details: string | null;
  startedAt: string | null; // local "HH:MM"
  endedAt: string | null;
};

export type HabitLog = HabitLogInput & { id: string; date: string; createdAt: string };

export type HabitDay = {
  habit: Habit;
  status: "unknown" | "none" | "used";
  // Highest intensity, or total count or minutes.
  level: number;
  uses: number;
  latestEnd: string | null;
  // Minutes past the cutoff, when the logs have start and end times.
  lateMinutes: number | null;
};

const HABIT_COLUMNS = `
  id::text,
  name,
  measure,
  unit,
  direction,
  scale_guide as "scaleGuide",
  to_char(cutoff, 'HH24:MI') as cutoff,
  active
`;

export async function listHabits(db: Queryable, userName: string, includeArchived = false): Promise<Habit[]> {
  const { rows } = await db.query<Habit>(
    `
    select ${HABIT_COLUMNS}
    from public.habits
    where user_name = $1 and (active or $2)
    order by created_at
    `,
    [userName, includeArchived]
  );
  return rows;
}

// Adds a habit, or replaces one when id is given.
export async function saveHabit(db: Queryable, userName: string, input: HabitInput, id?: string | null) {
  const values = [
    userName,
    input.name,
    input.measure,
    input.unit,
    input.direction,
    input.scaleGuide,
    input.cutoff,
    input.active
  ];
  const { rows } = id
    ? await db.query<{ id: string }>(
        `
        update public.habits
        set name = $2, measure = $3, unit = $4, direction = $5, scale_guide = $6, cutoff = $7::time, active = $8
        where user_name = $1 and id = $9::uuid
        returning id::text
        `,
        [...values, id]
      )
    : await db.query<{ id: string }>(
        `
        insert into public.habits (user_name, name, measure, unit, direction, scale_guide, cutoff, active)
        values ($1, $2, $3, $4, $5, $6, $7::time, $8)
        returning id::text
        `,
        values
      );
  if (!rows[0]) throw new Error("That habit no longer exists.");
  return rows[0].id;
}

// Saves a day's logs. A use replaces that day's "none" for the habit; a "none"
// is skipped when the day already has a use or a "none".
export async function saveHabitLogs(db: Queryable, userName: string, date: string, logs: HabitLogInput[]) {
  const ids: string[] = [];
  for (const log of logs) {
    if (log.amount > 0) {
      await db.query(
        `delete from public.habit_logs where user_name = $1 and habit_id = $2::uuid and entry_date = $3::date and amount = 0`,
        [userName, log.habitId, date]
      );
    } else {
      const { rows } = await db.query(
        `select 1 from public.habit_logs where user_name = $1 and habit_id = $2::uuid and entry_date = $3::date limit 1`,
        [userName, log.habitId, date]
      );
      if (rows.length) continue;
    }
    const { rows } = await db.query<{ id: string }>(
      `
      insert into public.habit_logs (user_name, habit_id, entry_date, amount, details, started_at, ended_at)
      select $1, h.id, $3::date, $4, $5, $6::time, $7::time
      from public.habits h
      where h.id = $2::uuid and h.user_name = $1
      returning id::text
      `,
      [userName, log.habitId, date, log.amount, log.details, log.startedAt, log.endedAt]
    );
    if (!rows[0]) throw new Error("That habit no longer exists.");
    ids.push(rows[0].id);
  }
  return ids;
}

export async function listHabitLogs(db: Queryable, userName: string, startDate: string, endDate: string): Promise<HabitLog[]> {
  const { rows } = await db.query<HabitLog>(
    `
    select
      id::text,
      habit_id::text as "habitId",
      entry_date::text as date,
      amount::float8,
      details,
      to_char(started_at, 'HH24:MI') as "startedAt",
      to_char(ended_at, 'HH24:MI') as "endedAt",
      created_at::text as "createdAt"
    from public.habit_logs
    where user_name = $1 and entry_date between $2::date and $3::date
    order by entry_date desc, created_at
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

export async function deleteHabitLog(db: Queryable, userName: string, id: string) {
  const { rowCount } = await db.query(`delete from public.habit_logs where id = $1::uuid and user_name = $2`, [id, userName]);
  return Boolean(rowCount);
}

// Minutes since the evening's midnight; times before 4 am belong to the night before.
function eveningMinutes(time: string) {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return minutes < 4 * 60 ? minutes + 24 * 60 : minutes;
}

function lateMinutesOf(log: HabitLog, cutoff: string) {
  if (!log.startedAt || !log.endedAt) return null;
  const start = eveningMinutes(log.startedAt);
  let end = eveningMinutes(log.endedAt);
  if (end < start) end += 24 * 60;
  return Math.max(0, end - Math.max(start, eveningMinutes(cutoff)));
}

// One day's status for each habit, from that day's logs.
export function summarizeHabitDay(habits: Habit[], dayLogs: HabitLog[]): HabitDay[] {
  return habits.map((habit) => {
    const logs = dayLogs.filter((log) => log.habitId === habit.id);
    const used = logs.filter((log) => log.amount > 0);
    const level =
      habit.measure === "intensity"
        ? Math.max(0, ...used.map((log) => log.amount))
        : used.reduce((sum, log) => sum + log.amount, 0);
    const ends = used.map((log) => log.endedAt).filter((time): time is string => Boolean(time));
    const latestEnd = ends.length ? ends.reduce((a, b) => (eveningMinutes(b) > eveningMinutes(a) ? b : a)) : null;
    const late = habit.cutoff ? used.map((log) => lateMinutesOf(log, habit.cutoff!)) : [];
    return {
      habit,
      status: used.length ? "used" : logs.length ? "none" : "unknown",
      level,
      uses: used.length,
      latestEnd,
      lateMinutes: late.length && late.every((value) => value != null) ? late.reduce((a, b) => a! + b!, 0) : null
    };
  });
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
}

// "20:30" as "8:30 PM".
export function formatClockTime(time: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(`2000-01-01T${time}:00Z`)
  );
}

// A day's status: "Light ×2", "2h · until 11:40 PM · 1h 40m late", "None", "Not logged".
export function describeHabitDay(day: HabitDay) {
  if (day.status === "unknown") return "Not logged";
  if (day.status === "none") return "None";
  const amount = formatHabitAmount(day.habit, day.level);
  const parts = [day.habit.measure === "intensity" && day.uses > 1 ? `${amount} ×${day.uses}` : amount];
  if (day.habit.cutoff && day.latestEnd) parts.push(`until ${formatClockTime(day.latestEnd)}`);
  if (day.lateMinutes) parts.push(`${formatMinutes(day.lateMinutes)} late`);
  return parts.join(" · ");
}

// A scale guide ("1: one pouch. 2: ...") as one line per level: "Light: one pouch."
export function scaleGuideLines(guide: string) {
  return guide
    .split(/(?=\b[1-3][:.)]\s)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^([1-3])[:.)]\s*/, (_, level) => `${INTENSITY_LABELS[Number(level)]}: `));
}

// "Heavy", "3 drinks", "1h 20m"; "None" for a recorded zero.
export function formatHabitAmount(habit: Pick<Habit, "measure" | "unit">, amount: number) {
  if (amount <= 0) return "None";
  if (habit.measure === "intensity") return INTENSITY_LABELS[Math.min(3, Math.round(amount))];
  if (habit.measure === "minutes") return formatMinutes(Math.round(amount));
  return `${amount} ${habit.unit ?? ""}`.trim();
}
