// Tracked habits (habits) and their logs (habit_logs). Habits are rows, so new
// ones are added through chat. A log's amount is an intensity 1-3, a count or
// minutes; 0 means "didn't today", said explicitly. A day with no logs is
// unknown, never zero. Plan: docs/journal-habits-plan.md.
import type { Pool } from "pg";
import { isWeeknight, weekdayOf } from "./dates";

type Queryable = Pick<Pool, "query">;

export const HABIT_MEASURES = ["intensity", "count", "minutes"] as const;
export type HabitMeasure = (typeof HABIT_MEASURES)[number];
export const HABIT_DIRECTIONS = ["limit", "build"] as const;
export type HabitDirection = (typeof HABIT_DIRECTIONS)[number];

export const INTENSITY_LABELS = ["None", "Light", "Moderate", "Heavy"] as const;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type HabitInput = {
  name: string;
  description: string | null; // what counts, in the owner's words
  measure: HabitMeasure;
  unit: string | null; // for counts: "drinks"
  direction: HabitDirection;
  scaleGuide: string | null; // what 1, 2 and 3 mean, for intensity habits
  // The day's target: for limit habits the most that's OK (0 = none), for
  // build habits the least. Null means no amount target.
  goal: number | null;
  cutoff: string | null; // local "HH:MM" after which any use is a miss
  cutoffWeeknights: boolean; // the cutoff applies Sunday-Thursday only
  // Frequency: the weekdays (0 Sunday-6 Saturday) the habit is tracked.
  // Null means every day. Unlogged days off are "off", not missed.
  days: number[] | null;
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
  date: string;
  status: "unknown" | "none" | "used";
  // Highest intensity, or total count or minutes.
  level: number;
  uses: number;
  latestEnd: string | null;
  // Minutes past the cutoff, when the logs have start and end times and the
  // cutoff applies that day.
  lateMinutes: number | null;
};

// How a day went against the habit's goal: met, a miss of 1 (a little) to 3
// (a lot), unknown when nothing was logged, or "used" when the habit has no
// goal to judge by, or "off" for an unlogged day the habit isn't tracked.
export type HabitOutcome = "unknown" | "off" | "met" | "miss-1" | "miss-2" | "miss-3" | "used";

const HABIT_COLUMNS = `
  id::text,
  name,
  description,
  measure,
  unit,
  direction,
  scale_guide as "scaleGuide",
  goal::float8,
  to_char(cutoff, 'HH24:MI') as cutoff,
  cutoff_weeknights as "cutoffWeeknights",
  days::int[] as days,
  active
`;

export async function listHabits(db: Queryable, userName: string, includeArchived = false): Promise<Habit[]> {
  const { rows } = await db.query<Habit>(
    `
    select ${HABIT_COLUMNS}
    from public.habits
    where user_name = $1 and (active or $2)
    order by created_at, name
    `,
    [userName, includeArchived]
  );
  return rows;
}

// Every day, or a sorted list of distinct weekdays.
export function normalizeDays(days: readonly number[] | null | undefined) {
  if (!days) return null;
  const unique = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return unique.length === 0 || unique.length === 7 ? null : unique;
}

export class HabitError extends Error {}

// Adds a habit, or changes one when id is given. Logs belong to the habit's
// id, so a rename or a new goal keeps its history. The measure can't change
// once a habit has logs: old amounts would be read on the wrong scale.
export async function saveHabit(db: Queryable, userName: string, input: HabitInput, id?: string | null) {
  const values = [
    userName,
    input.name,
    input.measure,
    input.unit,
    input.direction,
    input.scaleGuide,
    input.goal,
    input.cutoff,
    input.cutoffWeeknights,
    input.active,
    input.description ?? null,
    normalizeDays(input.days)
  ];
  try {
    if (id) {
      const { rows: current } = await db.query<{ measure: string; logs: number }>(
        `
        select h.measure, (select count(*) from public.habit_logs l where l.habit_id = h.id)::int as logs
        from public.habits h where h.user_name = $1 and h.id = $2::uuid
        `,
        [userName, id]
      );
      if (!current[0]) throw new HabitError("That habit no longer exists.");
      if (current[0].measure !== input.measure && current[0].logs > 0) {
        throw new HabitError("A habit with logs can't change how it's measured. Start a new habit instead.");
      }
    }
    const { rows } = id
      ? await db.query<{ id: string }>(
          `
          update public.habits
          set name = $2, measure = $3, unit = $4, direction = $5, scale_guide = $6, goal = $7,
            cutoff = $8::time, cutoff_weeknights = $9, active = $10, description = $11, days = $12::smallint[]
          where user_name = $1 and id = $13::uuid
          returning id::text
          `,
          [...values, id]
        )
      : await db.query<{ id: string }>(
          `
          insert into public.habits (user_name, name, measure, unit, direction, scale_guide, goal, cutoff, cutoff_weeknights, active, description, days)
          values ($1, $2, $3, $4, $5, $6, $7, $8::time, $9, $10, $11, $12::smallint[])
          returning id::text
          `,
          values
        );
    if (!rows[0]) throw new HabitError("That habit no longer exists.");
    return rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new HabitError(`You already track a habit called ${input.name}.`);
    throw error;
  }
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

export type HabitLogEdit = {
  date: string;
  amount: number;
  details: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

// What an edit to one log means for the other logs on its (new) day, using
// the same rules as saveHabitLogs: a use replaces that day's "none", and a
// "none" can't sit next to another entry. Pure, so it's tested directly.
export function planHabitLogEdit(
  edit: Pick<HabitLogEdit, "amount">,
  logId: string,
  sameDayLogs: Pick<HabitLog, "id" | "amount">[]
): { removeIds: string[] } | { error: string } {
  const others = sameDayLogs.filter((log) => log.id !== logId);
  if (edit.amount > 0) return { removeIds: others.filter((log) => log.amount === 0).map((log) => log.id) };
  if (others.length) return { error: "That day already has an entry for this habit. Remove this one instead." };
  return { removeIds: [] };
}

// Changes one log in place (amount, note, times, or its day), so a fix
// never leaves a duplicate behind.
export async function updateHabitLog(db: Pool, userName: string, id: string, edit: HabitLogEdit) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows: current } = await client.query<{ habitId: string }>(
      `select habit_id::text as "habitId" from public.habit_logs where id = $1::uuid and user_name = $2 for update`,
      [id, userName]
    );
    if (!current[0]) throw new HabitError("That entry no longer exists.");
    const { rows: sameDay } = await client.query<{ id: string; amount: number }>(
      `
      select id::text, amount::float8 from public.habit_logs
      where user_name = $1 and habit_id = $2::uuid and entry_date = $3::date
      for update
      `,
      [userName, current[0].habitId, edit.date]
    );
    const plan = planHabitLogEdit(edit, id, sameDay);
    if ("error" in plan) throw new HabitError(plan.error);
    if (plan.removeIds.length) {
      await client.query(`delete from public.habit_logs where user_name = $1 and id = any($2::uuid[])`, [userName, plan.removeIds]);
    }
    await client.query(
      `
      update public.habit_logs
      set entry_date = $3::date, amount = $4, details = $5, started_at = $6::time, ended_at = $7::time
      where id = $1::uuid and user_name = $2
      `,
      [id, userName, edit.date, edit.amount, edit.details, edit.startedAt, edit.endedAt]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
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

// Whether the habit is tracked on that date (its frequency).
export function trackedOn(habit: Pick<Habit, "days">, date: string) {
  return !habit.days || habit.days.includes(weekdayOf(date));
}

export function cutoffApplies(habit: Pick<Habit, "cutoff" | "cutoffWeeknights">, date: string) {
  return Boolean(habit.cutoff) && (!habit.cutoffWeeknights || isWeeknight(date));
}

// One day's status for each habit, from that day's logs.
export function summarizeHabitDay(habits: Habit[], date: string, dayLogs: HabitLog[]): HabitDay[] {
  return habits.map((habit) => {
    const logs = dayLogs.filter((log) => log.habitId === habit.id);
    const used = logs.filter((log) => log.amount > 0);
    const level =
      habit.measure === "intensity"
        ? Math.max(0, ...used.map((log) => log.amount))
        : used.reduce((sum, log) => sum + log.amount, 0);
    const ends = used.map((log) => log.endedAt).filter((time): time is string => Boolean(time));
    const latestEnd = ends.length ? ends.reduce((a, b) => (eveningMinutes(b) > eveningMinutes(a) ? b : a)) : null;
    const late = cutoffApplies(habit, date) ? used.map((log) => lateMinutesOf(log, habit.cutoff!)) : [];
    return {
      habit,
      date,
      status: used.length ? "used" : logs.length ? "none" : "unknown",
      level,
      uses: used.length,
      latestEnd,
      lateMinutes: late.length && late.every((value) => value != null) ? late.reduce((a, b) => a! + b!, 0) : null
    };
  });
}

function missFrom(severity: number): HabitOutcome {
  return severity <= 0 ? "met" : severity === 1 ? "miss-1" : severity === 2 ? "miss-2" : "miss-3";
}

// Judges a day against the habit's goal and cutoff. Limit habits miss by how
// far over the goal they went (intensity steps, drinks, or minutes); late use
// misses by how late (under 30 minutes, under 90, more). Build habits miss by
// how short they fell; an explicit zero is the biggest miss.
export function habitOutcome(day: HabitDay): HabitOutcome {
  const { habit } = day;
  if (day.status === "unknown") return trackedOn(habit, day.date) ? "unknown" : "off";
  // A build habit done on a day off is a bonus; a "none" that day is fine.
  if (!trackedOn(habit, day.date) && habit.direction === "build") return day.level > 0 ? "met" : "off";
  const judged = habit.goal != null || cutoffApplies(habit, day.date);
  if (!judged) return habit.cutoff ? "met" : day.status === "none" ? "met" : "used";

  if (habit.direction === "build") {
    if (habit.goal == null || day.level >= habit.goal) return "met";
    if (day.level <= 0) return "miss-3";
    return day.level >= habit.goal / 2 ? "miss-1" : "miss-2";
  }

  let severity = 0;
  if (habit.goal != null && day.level > habit.goal) {
    const over = day.level - habit.goal;
    if (habit.measure === "minutes") {
      const ratio = habit.goal > 0 ? over / habit.goal : over / 60;
      severity = ratio <= 0.25 ? 1 : ratio <= 0.75 ? 2 : 3;
    } else {
      severity = Math.min(3, over);
    }
  }
  if (cutoffApplies(habit, day.date) && day.status === "used") {
    // Without times, lateness can't be judged; an end time alone past the
    // cutoff counts as a small miss.
    if (day.lateMinutes == null && !day.latestEnd && severity === 0) return "used";
    const late =
      day.lateMinutes ?? (day.latestEnd && eveningMinutes(day.latestEnd) > eveningMinutes(habit.cutoff!) ? 1 : 0);
    if (late > 0) severity = Math.max(severity, late < 30 ? 1 : late <= 90 ? 2 : 3);
  }
  return missFrom(severity);
}

// The goal in words: "None", "2 drinks or fewer", "20m or more", "Not after 8:00 PM on weeknights".
export function describeGoal(habit: HabitInput) {
  const parts: string[] = [];
  if (habit.goal != null) {
    if (habit.direction === "limit" && habit.goal === 0) parts.push("None");
    else parts.push(`${formatHabitAmount(habit, habit.goal)} or ${habit.direction === "limit" ? "less" : "more"}`);
  }
  if (habit.cutoff) {
    parts.push(`not after ${formatClockTime(habit.cutoff)}${habit.cutoffWeeknights ? " on weeknights" : ""}`);
  }
  const text = parts.join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : null;
}

// "Every day", "Weekdays", "Mon, Wed, Fri".
export function describeDays(days: readonly number[] | null) {
  if (!days) return "Every day";
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  return days.map((day) => WEEKDAY_LABELS[day]).join(", ");
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
  // "1 drink", not "1 drinks".
  const unit = amount === 1 && habit.unit?.endsWith("s") ? habit.unit.slice(0, -1) : habit.unit;
  return `${amount} ${unit ?? ""}`.trim();
}
