// Fills the database with a fictional user, "Demo", for README screenshots
// and demos. Nothing here is real: meals, workouts, journal entries, habits
// and health metrics are generated from a fixed seed. See docs/demo.md.
//
//   npm run demo:seed -- --main               # into DATABASE_URL, as user Demo
//   DEMO_DATABASE_URL=... npm run demo:seed   # into a separate database
//
// It only deletes and writes rows whose user_name is Demo. Re-running
// replaces Demo's rows; days are relative to today.
import { readFileSync } from "fs";
import { Pool } from "pg";
import { addDays, todayLocalDate } from "../lib/dates";
import { reconcileWorkoutDuplicates } from "../lib/health/dedupe";

const USER = "demo";
const DAYS = 28;
const TIME_ZONE = process.env.APP_TIME_ZONE || "America/New_York";

// DEMO_DATABASE_URL picks a separate database; otherwise Demo goes into
// DATABASE_URL beside the real user, which needs --main to say so.
function checkTarget() {
  const url = process.env.DEMO_DATABASE_URL || (process.argv.includes("--main") ? process.env.DATABASE_URL : undefined);
  if (!url) throw new Error("Pass --main to seed Demo into DATABASE_URL, or set DEMO_DATABASE_URL.");
  if ((process.env.GOOGLE_HEALTH_USER || "").toLowerCase() === USER.toLowerCase()) {
    throw new Error(`${USER} is the real health user here. Refusing.`);
  }
  return url;
}

// Deterministic randomness, so every run makes the same demo.
let state = 20261012;
function random() {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
}
function between(min: number, max: number) {
  return min + random() * (max - min);
}
function int(min: number, max: number) {
  return Math.round(between(min, max));
}
function pick<T>(items: readonly T[]) {
  return items[Math.floor(random() * items.length)];
}

// UTC offset of the app's zone on a date, as Google Health writes it ("-14400s").
function offsetSeconds(date: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName")!.value;
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60) : 0;
}

// Local wall-clock time on a date, as a UTC ISO string plus its offset.
function at(date: string, hour: number, minute = 0) {
  const offset = offsetSeconds(date);
  const local = Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000;
  return { utc: new Date(local - offset * 1000).toISOString(), offset: `${offset}s` };
}

function civil(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day } };
}

type HealthRow = { type: string; key: string; month: string; payload: unknown };

function healthFor(date: string, index: number): HealthRow[] {
  const month = `${date.slice(0, 7)}-01`;
  const rows: HealthRow[] = [];
  const daily = (type: string, payload: object) =>
    rows.push({ type, key: date, month, payload: { civilStartTime: civil(date), ...payload } });
  const metric = (type: string, field: string, payload: object) =>
    rows.push({ type, key: `${type}-${date}`, month, payload: { [field]: { date: civil(date).date, ...payload } } });

  const steps = int(5500, 13500);
  daily("daily-steps", { steps: { countSum: steps } });
  daily("daily-distance", { distance: { millimetersSum: Math.round(steps * 762) } });
  daily("daily-active-energy", { activeEnergyBurned: { kcalSum: int(380, 950) } });
  daily("daily-total-calories", { totalCalories: { kcalSum: int(2300, 3100) } });
  daily("daily-active-zone-minutes", {
    activeZoneMinutes: { sumInFatBurnHeartZone: int(10, 45), sumInCardioHeartZone: int(0, 25), sumInPeakHeartZone: int(0, 6) }
  });
  daily("daily-active-minutes", {
    activeMinutes: {
      activeMinutesRollupByActivityLevel: [
        { activityLevel: "LIGHT", activeMinutesSum: int(140, 260) },
        { activityLevel: "MODERATE", activeMinutesSum: int(10, 40) },
        { activityLevel: "VIGOROUS", activeMinutesSum: int(0, 35) }
      ]
    }
  });
  // A slow trend: recovery dips mid-month, then improves.
  const trend = Math.sin(index / 4);
  metric("daily-resting-heart-rate", "dailyRestingHeartRate", { beatsPerMinute: Math.round(56 - trend * 2 + between(-1, 1)) });
  metric("daily-heart-rate-variability", "dailyHeartRateVariability", {
    averageHeartRateVariabilityMilliseconds: Math.round((48 + trend * 6 + between(-4, 4)) * 10) / 10
  });

  const asleep = int(380, 495);
  const bedHour = 22 + between(0.3, 1.6);
  const start = at(addDays(date, -1), Math.floor(bedHour), Math.round((bedHour % 1) * 60));
  const end = at(date, 0, Math.round(bedHour * 60 - 24 * 60 + asleep + 30));
  rows.push({
    type: "sleep",
    key: `sleep-${date}`,
    month,
    payload: {
      sleep: {
        interval: { startTime: start.utc, startUtcOffset: start.offset, endTime: end.utc, endUtcOffset: end.offset },
        metadata: { mainSleep: true },
        summary: {
          minutesAsleep: asleep,
          minutesAwake: 30,
          stagesSummary: [
            { type: "DEEP", minutes: Math.round(asleep * 0.17) },
            { type: "REM", minutes: Math.round(asleep * 0.22) },
            { type: "LIGHT", minutes: Math.round(asleep * 0.61) }
          ]
        }
      }
    }
  });
  return rows;
}

type Workout = { key: string; type: string; name: string; hour: number; minutes: number; hr: number; miles?: number };

function exerciseRow(date: string, workout: Workout): HealthRow {
  const start = at(date, workout.hour, 10);
  const end = at(date, workout.hour, 10 + workout.minutes);
  const zone = (share: number) => `${Math.round(workout.minutes * share * 60)}s`;
  return {
    type: "exercise",
    key: workout.key,
    month: `${date.slice(0, 7)}-01`,
    payload: {
      exercise: {
        interval: { startTime: start.utc, startUtcOffset: start.offset, endTime: end.utc, endUtcOffset: end.offset },
        exerciseType: workout.type,
        displayName: workout.name,
        activeDuration: `${workout.minutes * 60}s`,
        metricsSummary: {
          caloriesKcal: Math.round(workout.minutes * (workout.hr - 60) * 0.12),
          averageHeartRateBeatsPerMinute: workout.hr,
          distanceMillimeters: workout.miles ? Math.round(workout.miles * 1609344) : undefined,
          steps: workout.miles ? Math.round(workout.miles * 2100) : undefined,
          activeZoneMinutes: Math.round(workout.minutes * 0.6),
          heartRateZoneDurations: { lightTime: zone(0.3), moderateTime: zone(0.4), vigorousTime: zone(0.25), peakTime: zone(0.05) }
        },
        exerciseMetadata: { hasGps: Boolean(workout.miles) }
      }
    }
  };
}

const PLAN: { muscles: string[]; name: string; type: string }[] = [
  { name: "Push day", type: "strength", muscles: ["Chest", "Front Delts", "Side Delts", "Triceps"] },
  { name: "Pull day", type: "strength", muscles: ["Lats", "Upper Back", "Rear Delts", "Biceps"] },
  { name: "Leg day", type: "strength", muscles: ["Quads", "Hamstrings", "Glutes"] },
  { name: "Pilates", type: "pilates", muscles: ["Core"] },
  { name: "Yoga flow", type: "yoga", muscles: ["Mobility"] }
];

const MEALS = [
  { meal: "breakfast", hour: "07:45", text: "Greek yogurt with berries and granola", items: [["Greek yogurt", 150, 15, 6, 4], ["Berries", 60, 1, 14, 0], ["Granola", 190, 4, 30, 6]] },
  { meal: "breakfast", hour: "08:00", text: "Two eggs, toast and an orange", items: [["Eggs", 150, 12, 1, 10], ["Sourdough toast", 160, 6, 30, 1], ["Orange", 60, 1, 15, 0]] },
  { meal: "lunch", hour: "12:30", text: "Chicken rice bowl", items: [["Grilled chicken", 250, 45, 0, 6], ["Rice", 240, 5, 52, 1], ["Vegetables", 60, 2, 10, 1]] },
  { meal: "lunch", hour: "12:45", text: "Turkey sandwich and an apple", items: [["Turkey sandwich", 430, 30, 45, 12], ["Apple", 95, 0, 25, 0]] },
  { meal: "snack", hour: "15:30", text: "Protein shake", items: [["Protein shake", 180, 30, 8, 3]] },
  { meal: "dinner", hour: "19:00", text: "Salmon, potatoes and salad", items: [["Salmon", 360, 34, 0, 22], ["Roasted potatoes", 220, 4, 36, 7], ["Side salad", 90, 2, 6, 7]] },
  { meal: "dinner", hour: "19:15", text: "Pasta with meat sauce", items: [["Pasta", 420, 15, 80, 3], ["Meat sauce", 280, 20, 12, 16]] }
] as const;

const JOURNAL = [
  { body: "Good focus at work this morning, shipped the thing I'd been stuck on. Evening walk with a friend.", mood: 4, stress: 2, tags: ["work", "productive", "friends"] },
  { body: "Long day of meetings. Felt drained by the end but dinner with family helped.", mood: 3, stress: 4, tags: ["work", "meeting", "family"] },
  { body: "Slept badly and dragged through the day. Skipped the gym.", mood: 2, stress: null, tags: ["poor sleep", "tired", "rest day"] },
  { body: "Great workout, legs are toast. Read for a while before bed.", mood: 5, stress: 1, tags: ["workout", "sore legs", "reading"] },
  { body: "Quiet Sunday. Meal prep, a walk, some reading.", mood: 4, stress: 1, tags: ["relaxing", "reading"] },
  { body: "Deadline pressure all afternoon. Mood was fine though.", mood: 4, stress: 4, tags: ["work", "deadline"] },
  { body: "Headache most of the day, took it easy.", mood: 2, stress: 2, tags: ["headache", "rest day"] }
];

async function main() {
  const url = checkTarget();
  const db = new Pool({ connectionString: url });
  try {
    // A separate demo database gets the schema; the main one already has it.
    if (process.env.DEMO_DATABASE_URL) await db.query(readFileSync("supabase/schema.sql", "utf8"));
    const today = todayLocalDate();
    const dates = Array.from({ length: DAYS }, (_, index) => addDays(today, index - DAYS + 1));

    const client = await db.connect();
    try {
      await client.query("begin");
      for (const table of [
        "reminders",
        "reminder_sends",
        "habit_logs",
        "habits",
        "journal_entries",
        "workout_sessions",
        "health_workout_merges",
        "chat_messages",
        "chat_conversations",
        "app_feedback",
        "health_records",
        "water_entries",
        "macro_entries",
        "user_macro_goals"
      ]) {
        await client.query(`delete from public.${table} where user_name = $1`, [USER]);
      }

      await client.query(
        `insert into public.user_macro_goals (user_name, calories, protein_pct, carbs_pct, fat_pct, water_oz) values ($1, 2400, 30, 40, 30, 100)`,
        [USER]
      );

      const habitIds: Record<string, string> = {};
      const habits = [
        ["Reading", "Any book, not the news", "minutes", null, "build", null, 20, null, false, null],
        ["Alcohol", null, "count", "drinks", "limit", null, 1, null, false, null],
        ["Late screens", "Phone or TV in bed", "minutes", null, "limit", null, 0, "22:30", true, null],
        ["Meditation", null, "minutes", null, "build", null, 10, null, false, [1, 2, 3, 4, 5]]
      ] as const;
      for (const [name, description, measure, unit, direction, scale, goal, cutoff, weeknights, days] of habits) {
        const { rows } = await client.query<{ id: string }>(
          `
          insert into public.habits (user_name, name, description, measure, unit, direction, scale_guide, goal, cutoff, cutoff_weeknights, days)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::time, $10, $11::smallint[])
          returning id::text
          `,
          [USER, name, description, measure, unit, direction, scale, goal, cutoff, weeknights, days]
        );
        habitIds[name] = rows[0].id;
      }

      const health: HealthRow[] = [];
      for (const [index, date] of dates.entries()) {
        health.push(...healthFor(date, index));
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

        // Workouts: lifting most weekdays, pilates or yoga twice a week, runs on weekends.
        const plan = weekday === 0 ? null : weekday === 6 ? null : PLAN[index % PLAN.length];
        if (plan) {
          const key = `demo-ex-${date}`;
          const isLift = plan.type === "strength";
          health.push(
            exerciseRow(date, {
              key,
              type: isLift ? "WEIGHTLIFTING" : plan.type === "pilates" ? "PILATES" : "YOGA",
              name: isLift ? "Weightlifting" : plan.type === "pilates" ? "Pilates" : "Yoga",
              hour: 18,
              minutes: int(40, 65),
              hr: isLift ? int(112, 128) : int(95, 108)
            })
          );
          if (date !== today) {
            await client.query(
              `
              insert into public.workout_sessions (user_name, entry_date, name, workout_type, muscle_groups, rpe, match_status, health_record_key, linked_by, raw_text)
              values ($1, $2::date, $3, $4, $5, $6, 'linked', $7, 'auto', $8)
              `,
              [USER, date, plan.name, plan.type, plan.muscles, int(6, 8), key, plan.name.toLowerCase()]
            );
          }
        } else {
          const key = `demo-run-${date}`;
          health.push(exerciseRow(date, { key, type: "RUNNING", name: "Run", hour: 9, minutes: int(28, 45), hr: int(145, 158), miles: between(3, 5) }));
          // Fitbit sometimes records a run twice; the dedupe step folds it.
          if (weekday === 6) {
            health.push(exerciseRow(date, { key: `${key}-dup`, type: "RUNNING", name: "Run", hour: 9, minutes: 9, hr: 150 }));
          }
        }

        // Meals: breakfast, lunch, a snack most days, dinner.
        for (const kind of ["breakfast", "lunch", "snack", "dinner"] as const) {
          if (kind === "snack" && random() < 0.4) continue;
          if (date === today && kind === "dinner") continue;
          const meal = pick(MEALS.filter((item) => item.meal === kind));
          const items = meal.items.map(([name, calories, protein_g, carbs_g, fat_g]) => ({ name, calories, protein_g, carbs_g, fat_g, assumption: "" }));
          const sum = (key: "calories" | "protein_g" | "carbs_g" | "fat_g") => items.reduce((total, item) => total + item[key], 0);
          await client.query(
            `
            insert into public.macro_entries (user_name, entry_date, raw_text, calories, protein_g, carbs_g, fat_g, items, confidence, meal_type, eaten_at)
            values ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb, 0.8, $9, $10::time)
            `,
            [USER, date, meal.text, sum("calories"), sum("protein_g"), sum("carbs_g"), sum("fat_g"), JSON.stringify(items), kind, meal.hour]
          );
        }
        for (let glass = 0; glass < int(4, 7); glass += 1) {
          await client.query(`insert into public.water_entries (user_name, entry_date, amount_oz) values ($1, $2::date, 16)`, [USER, date]);
        }

        // Journal most evenings, habits logged with it.
        if (date !== today && random() < 0.8) {
          const entry = JOURNAL[index % JOURNAL.length];
          await client.query(
            `
            insert into public.journal_entries (user_name, entry_date, kind, body, mood, stress, tags, created_at)
            values ($1, $2::date, 'evening', $3, $4, $5, $6, $7::timestamptz)
            `,
            [USER, date, entry.body, entry.mood, entry.stress, entry.tags, at(date, 21, 15).utc]
          );
          const logs: [string, number, string | null, string | null][] = [
            ["Reading", random() < 0.7 ? int(10, 40) : 0, null, null],
            ["Alcohol", weekday >= 5 ? int(0, 3) : random() < 0.2 ? 1 : 0, null, null],
            ["Late screens", random() < 0.5 ? int(15, 50) : 0, "22:15", "23:05"]
          ];
          if (weekday >= 1 && weekday <= 5) logs.push(["Meditation", random() < 0.6 ? int(5, 15) : 0, null, null]);
          for (const [name, amount, started, ended] of logs) {
            await client.query(
              `
              insert into public.habit_logs (user_name, habit_id, entry_date, amount, started_at, ended_at)
              values ($1, $2::uuid, $3::date, $4, $5::time, $6::time)
              `,
              [USER, habitIds[name], date, amount, amount > 0 ? started : null, amount > 0 ? ended : null]
            );
          }
        }
      }

      for (const row of health) {
        await client.query(
          `insert into public.health_records (user_name, data_type, partition_month, record_key, payload) values ($1, $2, $3, $4, $5::jsonb)`,
          [USER, row.type, row.month, row.key, JSON.stringify(row.payload)]
        );
      }

      await client.query(
        `
        insert into public.reminders (user_name, kind, habit_id, hour, days, message)
        values ($1, 'checkin', null, 20, null, null), ($1, 'habit', $2::uuid, 21, null, null)
        `,
        [USER, habitIds.Reading]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const folded = await reconcileWorkoutDuplicates(db, USER);
    console.log(`Seeded ${DAYS} days for ${USER}; folded ${folded.duplicates} duplicate workout recordings.`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
