// Read-side queries for the health dashboard, over the health_daily and
// health_workouts views. Missing measurements come back as null, never zero.
import { getPool } from "../supabase";

export type HealthDay = {
  day: string;
  steps: number | null;
  distanceMiles: number | null;
  activeKcal: number | null;
  totalKcal: number | null;
  zoneMinutesFatBurn: number | null;
  zoneMinutesCardio: number | null;
  zoneMinutesPeak: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  sleepMinutes: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes: number | null;
  bedtime: string | null;
  wakeTime: string | null;
};

export type HealthWorkout = {
  id: string;
  day: string;
  startedAt: string;
  name: string;
  activeMinutes: number | null;
  calories: number | null;
  avgHr: number | null;
  distanceMiles: number | null;
  hrLightMinutes: number | null;
  hrModerateMinutes: number | null;
  hrVigorousMinutes: number | null;
  hrPeakMinutes: number | null;
};

export type HealthSyncRun = {
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  failedTypes: string[];
};

function requirePool() {
  const db = getPool();
  if (!db) {
    throw new Error("DATABASE_URL is required for health data.");
  }
  return db;
}

export async function listHealthDays(userName: string, startDate: string, endDate: string): Promise<HealthDay[]> {
  const { rows } = await requirePool().query(
    `
    select
      day::text as "day",
      steps::int as "steps",
      distance_miles::float8 as "distanceMiles",
      active_kcal::float8 as "activeKcal",
      total_kcal::float8 as "totalKcal",
      zone_minutes_fat_burn::int as "zoneMinutesFatBurn",
      zone_minutes_cardio::int as "zoneMinutesCardio",
      zone_minutes_peak::int as "zoneMinutesPeak",
      resting_hr::int as "restingHr",
      hrv_ms::float8 as "hrvMs",
      sleep_minutes::int as "sleepMinutes",
      deep_minutes::int as "deepMinutes",
      rem_minutes::int as "remMinutes",
      light_minutes::int as "lightMinutes",
      to_char(bedtime, 'YYYY-MM-DD"T"HH24:MI') as "bedtime",
      to_char(wake_time, 'YYYY-MM-DD"T"HH24:MI') as "wakeTime"
    from public.health_daily
    where user_name = $1 and day >= $2::date and day <= $3::date
    order by day
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

export async function listHealthWorkouts(userName: string, startDate: string, endDate: string): Promise<HealthWorkout[]> {
  const { rows } = await requirePool().query(
    `
    select
      id as "id",
      day::text as "day",
      to_char(started_at, 'YYYY-MM-DD"T"HH24:MI') as "startedAt",
      coalesce(name, type) as "name",
      active_minutes::int as "activeMinutes",
      calories::int as "calories",
      avg_hr::int as "avgHr",
      distance_miles::float8 as "distanceMiles",
      hr_light_minutes::int as "hrLightMinutes",
      hr_moderate_minutes::int as "hrModerateMinutes",
      hr_vigorous_minutes::int as "hrVigorousMinutes",
      hr_peak_minutes::int as "hrPeakMinutes"
    from public.health_workouts
    where user_name = $1 and day >= $2::date and day <= $3::date
    order by started_at desc
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

export async function getLatestHealthSyncRun(userName: string): Promise<HealthSyncRun | null> {
  const { rows } = await requirePool().query(
    `
    select status as "status", started_at::text as "startedAt", failed_types as "failedTypes"
    from public.health_sync_runs
    where user_name = $1
    order by id desc
    limit 1
    `,
    [userName]
  );
  return rows[0] ?? null;
}
