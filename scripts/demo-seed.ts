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
import { addDays, localDateTime, todayLocalDate } from "../lib/dates";
import { refreshBodyStates } from "../lib/body-state/store";
import { reconcileWorkoutDuplicates } from "../lib/health/dedupe";

const USER = "demo";
// Six weeks: the illness check needs a month of baseline before the cold.
const DAYS = 42;
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

// What happened to Demo, by days ago, so the body state has a story to tell:
// a cold two weeks back that the watch saw coming a day early, weekend drinks
// that show up in the next morning's resting HR and HRV, and a few late
// coffees.
const COLD = { signs: 17, sick: [16, 15], mild: 14, better: 13 } as const;
const coldShift = (ago: number) =>
  ago === COLD.signs
    ? { rhr: 4, hrv: -9, temp: 0.6, breaths: 1.1 }
    : ago === COLD.sick[0] || ago === COLD.sick[1]
      ? { rhr: 6, hrv: -13, temp: 0.9, breaths: 1.6 }
      : ago === COLD.mild
        ? { rhr: 3, hrv: -6, temp: 0.4, breaths: 0.6 }
        : { rhr: 0, hrv: 0, temp: 0, breaths: 0 };

function healthFor(date: string, index: number, ago: number, drinksBefore: number): HealthRow[] {
  const month = `${date.slice(0, 7)}-01`;
  const rows: HealthRow[] = [];
  const daily = (type: string, payload: object) =>
    rows.push({ type, key: date, month, payload: { civilStartTime: civil(date), ...payload } });
  const metric = (type: string, field: string, payload: object) =>
    rows.push({ type, key: `${type}-${date}`, month, payload: { [field]: { date: civil(date).date, ...payload } } });

  // Sundays and sick days are quiet: few steps, almost no zone minutes.
  const quiet = new Date(`${date}T12:00:00Z`).getUTCDay() === 0 || coldShift(ago).rhr >= 6;
  const steps = quiet ? int(2500, 4500) : int(5500, 13500);
  daily("daily-steps", { steps: { countSum: steps } });
  daily("daily-distance", { distance: { millimetersSum: Math.round(steps * 762) } });
  daily("daily-active-energy", { activeEnergyBurned: { kcalSum: int(380, 950) } });
  daily("daily-total-calories", { totalCalories: { kcalSum: int(2300, 3100) } });
  daily("daily-active-zone-minutes", {
    activeZoneMinutes: quiet
      ? { sumInFatBurnHeartZone: int(0, 6), sumInCardioHeartZone: 0, sumInPeakHeartZone: 0 }
      : { sumInFatBurnHeartZone: int(10, 45), sumInCardioHeartZone: int(0, 25), sumInPeakHeartZone: int(0, 6) }
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
  // A slow trend, the cold, and the night after drinks.
  const trend = Math.sin(index / 5);
  const cold = coldShift(ago);
  const drinks = drinksBefore >= 3 ? { rhr: 3, hrv: -9 } : drinksBefore >= 2 ? { rhr: 2, hrv: -5 } : { rhr: 0, hrv: 0 };
  metric("daily-resting-heart-rate", "dailyRestingHeartRate", {
    beatsPerMinute: Math.round(56 - trend * 1.5 + cold.rhr + drinks.rhr + between(-0.8, 0.8))
  });
  metric("daily-heart-rate-variability", "dailyHeartRateVariability", {
    averageHeartRateVariabilityMilliseconds: Math.round((49 + trend * 4 + cold.hrv + drinks.hrv + between(-3, 3)) * 10) / 10
  });
  metric("daily-respiratory-rate", "dailyRespiratoryRate", { breathsPerMinute: Math.round((14.6 + cold.breaths + between(-0.3, 0.3)) * 10) / 10 });
  metric("daily-oxygen-saturation", "dailyOxygenSaturation", { averagePercentage: Math.round(between(95.5, 97.5) * 10) / 10 });
  const temp = cold.temp + between(-0.2, 0.2) + (drinksBefore >= 2 ? 0.2 : 0);
  metric("daily-sleep-temperature-derivations", "dailySleepTemperatureDerivations", {
    nightlyTemperatureCelsius: Math.round((34.2 + temp) * 100) / 100,
    baselineTemperatureCelsius: 34.2
  });
  if (index % 7 === 0) metric("daily-vo2-max", "dailyVo2Max", { vo2Max: Math.round((46 + index * 0.03) * 10) / 10 });

  // Sick nights run long; drinking nights run late and short.
  const asleep = cold.rhr >= 6 ? int(500, 560) : drinksBefore >= 2 ? int(330, 390) : int(390, 495);
  const bedHour = drinksBefore >= 2 ? 23 + between(0.4, 1.2) : 22 + between(0.3, 1.4);
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

// Per-muscle intensity where it differs from the session's RPE. Pilates
// sits between pull and legs so no three hard days run together.
const PLAN: { muscles: string[]; name: string; type: string; rpe: number; intensity: Record<string, string> }[] = [
  { name: "Push day", type: "strength", muscles: ["Chest", "Front Delts", "Side Delts", "Triceps"], rpe: 8, intensity: { "Side Delts": "medium" } },
  { name: "Pull day", type: "strength", muscles: ["Lats", "Upper Back", "Traps", "Rear Delts", "Biceps", "Forearms"], rpe: 8, intensity: { Forearms: "medium", Traps: "medium" } },
  { name: "Pilates", type: "pilates", muscles: ["Core", "Mobility"], rpe: 5, intensity: { Mobility: "light" } },
  { name: "Leg day", type: "strength", muscles: ["Quads", "Hamstrings", "Glutes", "Calves", "Core"], rpe: 7, intensity: { Calves: "medium", Core: "medium" } },
  { name: "Yoga flow", type: "yoga", muscles: ["Mobility"], rpe: 3, intensity: {} }
];

// Items: name, calories, protein, carbs, fat, caffeine mg, added sugar g.
const MEALS = [
  { meal: "breakfast", hour: "07:45", text: "Greek yogurt with berries and granola, and a coffee", items: [["Greek yogurt", 150, 15, 6, 4, 0, 0], ["Berries", 60, 1, 14, 0, 0, 0], ["Granola", 190, 4, 30, 6, 0, 9], ["Coffee", 5, 0, 0, 0, 95, 0]] },
  { meal: "breakfast", hour: "08:00", text: "Two eggs, toast, an orange and a coffee", items: [["Eggs", 150, 12, 1, 10, 0, 0], ["Sourdough toast", 160, 6, 30, 1, 0, 0], ["Orange", 60, 1, 15, 0, 0, 0], ["Coffee with milk", 30, 2, 2, 1, 95, 0]] },
  { meal: "breakfast", hour: "07:30", text: "Oatmeal with banana and honey, and a latte", items: [["Oatmeal", 300, 10, 54, 5, 0, 0], ["Banana", 105, 1, 27, 0, 0, 0], ["Honey", 60, 0, 17, 0, 0, 17], ["Latte", 190, 10, 15, 7, 130, 0]] },
  { meal: "lunch", hour: "12:30", text: "Chicken rice bowl", items: [["Grilled chicken", 330, 60, 0, 8, 0, 0], ["Rice", 300, 6, 65, 1, 0, 0], ["Vegetables", 60, 2, 10, 1, 0, 0]] },
  { meal: "lunch", hour: "12:45", text: "Turkey sandwich and an apple", items: [["Turkey sandwich", 520, 42, 48, 16, 0, 3], ["Apple", 95, 0, 25, 0, 0, 0]] },
  { meal: "lunch", hour: "13:00", text: "Burrito bowl", items: [["Burrito bowl", 780, 52, 78, 26, 0, 2]] },
  { meal: "snack", hour: "15:30", text: "Protein shake", items: [["Protein shake", 180, 30, 8, 3, 0, 2]] },
  { meal: "snack", hour: "15:45", text: "Cold brew and a granola bar", items: [["Cold brew", 10, 0, 0, 0, 200, 0], ["Granola bar", 190, 4, 29, 7, 0, 11]] },
  { meal: "dinner", hour: "19:00", text: "Salmon, potatoes and salad", items: [["Salmon", 450, 45, 0, 28, 0, 0], ["Roasted potatoes", 220, 4, 36, 7, 0, 0], ["Side salad", 90, 2, 6, 7, 0, 1]] },
  { meal: "dinner", hour: "19:15", text: "Pasta with meat sauce", items: [["Pasta", 420, 15, 80, 3, 0, 0], ["Meat sauce", 380, 32, 14, 20, 0, 6]] },
  { meal: "dessert", hour: "21:00", text: "Cottage cheese with berries", items: [["Cottage cheese", 180, 24, 8, 5, 0, 0], ["Berries", 60, 1, 14, 0, 0, 0]] },
  { meal: "dessert", hour: "21:15", text: "Dark chocolate and almonds", items: [["Dark chocolate", 170, 2, 13, 12, 25, 9], ["Almonds", 160, 6, 6, 14, 0, 0]] },
  { meal: "dinner", hour: "19:30", text: "Steak tacos", items: [["Steak tacos", 760, 56, 54, 32, 0, 1]] }
] as const;

// Sick days: soup and tea instead.
const SICK_MEALS = [
  { meal: "breakfast", hour: "09:30", text: "Toast and tea", items: [["Toast with butter", 220, 6, 30, 9, 0, 0], ["Black tea with honey", 65, 0, 17, 0, 45, 17]] },
  { meal: "lunch", hour: "13:00", text: "Chicken noodle soup", items: [["Chicken noodle soup", 320, 22, 36, 8, 0, 0]] },
  { meal: "dinner", hour: "18:30", text: "Rice and broth", items: [["Rice", 240, 5, 52, 1, 0, 0], ["Bone broth", 50, 10, 0, 1, 0, 0]] }
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

// The cold, by days ago.
const COLD_JOURNAL: Record<number, { body: string; mood: number; stress: number | null; tags: string[] }> = {
  [COLD.signs]: { body: "Felt a bit flat tonight, scratchy throat. Early bed.", mood: 3, stress: 2, tags: ["tired"] },
  [COLD.sick[0]]: { body: "Woke up with a fever and aches. Stayed in bed most of the day.", mood: 2, stress: null, tags: ["sick", "rest day"] },
  [COLD.sick[1]]: { body: "Still sick, cough now. Soup and a lot of sleep.", mood: 2, stress: null, tags: ["sick", "rest day"] },
  [COLD.mild]: { body: "Much better, just congested. Short walk outside.", mood: 3, stress: 1, tags: ["sick"] },
  [COLD.better]: { body: "Back to normal. Easing back in tomorrow.", mood: 4, stress: 2, tags: ["work"] }
};
const COLD_DAYS: Record<number, [number, string[], string]> = {
  [COLD.sick[0]]: [2, ["fever", "body aches", "sore throat"], "In bed most of the day"],
  [COLD.sick[1]]: [2, ["cough", "fatigue", "congestion"], "Cough started"],
  [COLD.mild]: [1, ["congestion"], "Just stuffy"],
  [COLD.better]: [0, [], "Back to normal"]
};

// Drinks: most Fridays and Saturdays, now and then midweek.
function drinksOn(weekday: number) {
  if (weekday === 5 || weekday === 6) return random() < 0.75 ? int(2, 4) : int(0, 1);
  return random() < 0.15 ? 1 : 0;
}

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
        "body_states",
        "body_log",
        "illness_days",
        "workout_ignores",
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
        `insert into public.user_macro_goals (user_name, calories, protein_pct, carbs_pct, fat_pct, water_oz) values ($1, 2300, 25, 45, 30, 100)`,
        [USER]
      );

      const habitIds: Record<string, string> = {};
      const habits = [
        ["Reading", "Any book, not the news", "minutes", null, "build", null, 20, null, false, null],
        ["Alcohol", "Beer, wine or a cocktail", "count", "drinks", "limit", null, 1, null, false, null],
        ["Late screens", "Phone or TV in bed", "minutes", null, "limit", null, 0, "22:30", true, null],
        ["Meditation", null, "minutes", null, "build", null, 10, null, false, [1, 2, 3, 4, 5]]
      ] as const;
      for (const [name, description, measure, unit, direction, scale, goal, cutoff, weeknights, days] of habits) {
        const { rows } = await client.query<{ id: string }>(
          `
          insert into public.habits (user_name, name, description, measure, unit, direction, scale_guide, goal, cutoff, cutoff_weeknights, days, band_orange, band_red)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::time, $10, $11::smallint[], $12, $13)
          returning id::text
          `,
          // Alcohol carries its own bands: orange over 2 drinks, red over 3.
          [USER, name, description, measure, unit, direction, scale, goal, cutoff, weeknights, days, name === "Alcohol" ? 2 : null, name === "Alcohol" ? 3 : null]
        );
        habitIds[name] = rows[0].id;
      }

      const health: HealthRow[] = [];
      let legDay: string | null = null;
      let nextPlan = 0;
      const drinks = dates.map((date) => drinksOn(new Date(`${date}T12:00:00Z`).getUTCDay()));
      for (const [index, date] of dates.entries()) {
        const ago = DAYS - 1 - index;
        health.push(...healthFor(date, index, ago, index > 0 ? drinks[index - 1] : 0));
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        const sickDay = COLD_DAYS[ago];
        const inBed = sickDay != null && sickDay[0] >= 1;
        if (sickDay) {
          await client.query(
            `insert into public.illness_days (user_name, entry_date, severity, symptoms, note) values ($1, $2::date, $3, $4, $5)`,
            [USER, date, ...sickDay]
          );
        }

        // Workouts: lifting most weekdays, pilates or yoga twice a week, a
        // run on Saturday, Sunday off; nothing while sick.
        const plan = inBed || weekday === 0 || weekday === 6 ? null : PLAN[nextPlan++ % PLAN.length];
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
            if (plan.name === "Leg day") legDay = date;
            await client.query(
              `
              insert into public.workout_sessions (user_name, entry_date, name, workout_type, muscle_groups, muscle_intensity, rpe, match_status, health_record_key, linked_by, raw_text)
              values ($1, $2::date, $3, $4, $5, $6::jsonb, $7, 'linked', $8, 'auto', $9)
              `,
              [USER, date, plan.name, plan.type, plan.muscles, JSON.stringify(plan.intensity), plan.rpe, key, plan.name.toLowerCase()]
            );
          }
        } else if (!inBed && weekday === 6) {
          const key = `demo-run-${date}`;
          health.push(exerciseRow(date, { key, type: "RUNNING", name: "Run", hour: 9, minutes: int(28, 45), hr: int(145, 158), miles: between(3, 5) }));
          // Fitbit sometimes records a run twice; the dedupe step folds it.
          if (weekday === 6) {
            health.push(exerciseRow(date, { key: `${key}-dup`, type: "RUNNING", name: "Run", hour: 9, minutes: 9, hr: 150 }));
          }
        }

        // Meals: breakfast, lunch, a snack most days, dinner.
        for (const kind of ["breakfast", "lunch", "snack", "dinner", "dessert"] as const) {
          if (kind === "snack" && random() < 0.25) continue;
          if (kind === "dessert" && random() < 0.35) continue;
          const menu = inBed ? SICK_MEALS : MEALS;
          const options = menu.filter((item) => item.meal === kind);
          if (!options.length) continue;
          const meal = pick(options);
          // Today only has what's been eaten so far.
          if (date === today && meal.hour > localDateTime().slice(11, 16)) continue;
          const items = meal.items.map(([name, calories, protein_g, carbs_g, fat_g, caffeine_mg, added_sugar_g]) => ({
            name,
            calories,
            protein_g,
            carbs_g,
            fat_g,
            caffeine_mg,
            added_sugar_g,
            assumption: ""
          }));
          const sum = (key: "calories" | "protein_g" | "carbs_g" | "fat_g" | "caffeine_mg" | "added_sugar_g") =>
            items.reduce((total, item) => total + item[key], 0);
          await client.query(
            `
            insert into public.macro_entries (user_name, entry_date, raw_text, calories, protein_g, carbs_g, fat_g, caffeine_mg, added_sugar_g, items, confidence, meal_type, eaten_at)
            values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 0.8, $11, $12::time)
            `,
            [
              USER,
              date,
              meal.text,
              sum("calories"),
              sum("protein_g"),
              sum("carbs_g"),
              sum("fat_g"),
              sum("caffeine_mg"),
              sum("added_sugar_g"),
              JSON.stringify(items),
              kind,
              meal.hour
            ]
          );
        }
        for (let glass = 0; glass < int(4, 7); glass += 1) {
          await client.query(`insert into public.water_entries (user_name, entry_date, amount_oz) values ($1, $2::date, 16)`, [USER, date]);
        }

        // Journal most evenings, habits logged with it.
        if (date !== today && (COLD_JOURNAL[ago] || random() < 0.8)) {
          const entry = COLD_JOURNAL[ago] ?? JOURNAL[index % JOURNAL.length];
          await client.query(
            `
            insert into public.journal_entries (user_name, entry_date, kind, body, mood, stress, tags, created_at)
            values ($1, $2::date, 'evening', $3, $4, $5, $6, $7::timestamptz)
            `,
            [USER, date, entry.body, entry.mood, entry.stress, entry.tags, at(date, 21, 15).utc]
          );
          const logs: [string, number, string | null, string | null][] = [
            ["Reading", random() < 0.7 ? int(10, 40) : 0, null, null],
            ["Alcohol", inBed ? 0 : drinks[index], null, null],
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

      // The last leg day left the hamstrings sore enough to mark on the body map, the day after.
      if (legDay) {
        await client.query(
          `insert into public.body_log (user_name, entry_date, body_part, kind, level) values ($1, $2::date, 'Hamstrings', 'sore', 3)`,
          [USER, addDays(legDay, 1) > today ? legDay : addDays(legDay, 1)]
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
    // Every day's body state, as the backfill builds them for the owner.
    const states = await refreshBodyStates(db, USER, dates[0], "rebuild", { to: today, pastTrigger: "rebuild" });
    console.log(
      `Seeded ${DAYS} days for ${USER}; folded ${folded.duplicates} duplicate workout recordings; saved ${states.saved} body states.`
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
