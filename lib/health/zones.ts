// Fitbit's heart-rate zones: light, moderate, vigorous and peak. Fitbit sets
// the bands from heart-rate reserve (resting HR to max HR; on the owner's data
// moderate starts near 40%, vigorous near 60%, peak near 85%), so they move a
// few bpm with resting HR. A custom max HR in the Fitbit app moves them all.
// Each workout carries its minutes per zone.
import { getPool } from "../supabase";
import type { HealthWorkout } from "./queries";

export const ZONES = [
  { key: "light", label: "Light" },
  { key: "moderate", label: "Moderate" },
  { key: "vigorous", label: "Vigorous" },
  { key: "peak", label: "Peak" }
] as const;

export type ZoneKey = (typeof ZONES)[number]["key"];

// Workout minutes per zone to reach each calendar week (Monday to Sunday), every workout counted
// (peak during a lift counts). Hard on purpose (Nov 1, 2026: the owner wants to
// push cardio for a lower resting HR): moderate and vigorous are the tops of
// WHO's 150-300 moderate and 75-150 vigorous minutes a week. Until Nov 10,
// 2026 they were the top of those ranges (300, 150) and peak 25 (the top of
// what HIIT studies use); the owner found them too high (he averaged 124, 38
// and 2 a week), so moderate and vigorous are WHO's low ends, 150 and 75, and
// peak 10, about one interval session. Light has no goal.
export const ZONE_GOALS: Record<ZoneKey, number | null> = { light: null, moderate: 150, vigorous: 75, peak: 10 };
export type ZoneBounds = Record<ZoneKey, { min: number; max: number }>;
export type ZoneMinutes = Record<ZoneKey, number>;

const minutesOf: Record<ZoneKey, (workout: HealthWorkout) => number | null> = {
  light: (workout) => workout.hrLightMinutes,
  moderate: (workout) => workout.hrModerateMinutes,
  vigorous: (workout) => workout.hrVigorousMinutes,
  peak: (workout) => workout.hrPeakMinutes
};

// Where a zone stands against its goal partway through the week. The pace
// counts only the week's finished days, so Monday morning starts on pace and
// today's workouts can only help: `daysDone` is days of the week already over.
export type ZonePace = { status: "done" | "on_pace" | "behind"; behind: number };

export function zonePace(minutes: number, goal: number, daysDone: number): ZonePace {
  if (minutes >= goal) return { status: "done", behind: 0 };
  const expected = Math.round((goal * daysDone) / 7);
  return minutes >= expected ? { status: "on_pace", behind: 0 } : { status: "behind", behind: expected - minutes };
}

// Minutes in each zone across the workouts.
export function zoneMinutes(workouts: readonly HealthWorkout[]): ZoneMinutes {
  const total = (key: ZoneKey) => workouts.reduce((sum, workout) => sum + (minutesOf[key](workout) ?? 0), 0);
  return { light: total("light"), moderate: total("moderate"), vigorous: total("vigorous"), peak: total("peak") };
}

// "moderate 114-139, vigorous 140-171, peak 172+" (light is everything below).
export function describeZoneBounds(bounds: ZoneBounds) {
  return `light under ${bounds.moderate.min}, moderate ${bounds.moderate.min}-${bounds.moderate.max}, vigorous ${bounds.vigorous.min}-${bounds.vigorous.max}, peak ${bounds.peak.min}+ bpm`;
}

// The zone bands on the latest day on or before `date` that has them.
export async function getZoneBounds(userName: string, date: string): Promise<ZoneBounds | null> {
  const db = getPool();
  if (!db) return null;
  const { rows } = await db.query(
    `
    select payload->'dailyHeartRateZones'->'heartRateZones' as zones
    from public.health_records r
    cross join lateral (
      select make_date(
        (r.payload->'dailyHeartRateZones'->'date'->>'year')::int,
        (r.payload->'dailyHeartRateZones'->'date'->>'month')::int,
        (r.payload->'dailyHeartRateZones'->'date'->>'day')::int
      ) as day
    ) d
    where r.user_name = $1 and r.data_type = 'daily-heart-rate-zones' and d.day <= $2::date
    order by d.day desc
    limit 1
    `,
    [userName, date]
  );
  const zones = rows[0]?.zones as { heartRateZoneType: string; minBeatsPerMinute: string; maxBeatsPerMinute: string }[] | undefined;
  if (!zones) return null;
  const bounds: Partial<ZoneBounds> = {};
  for (const zone of zones) {
    const key = zone.heartRateZoneType.toLowerCase() as ZoneKey;
    if (ZONES.some((item) => item.key === key)) {
      bounds[key] = { min: Number(zone.minBeatsPerMinute), max: Number(zone.maxBeatsPerMinute) };
    }
  }
  return ZONES.every((item) => bounds[item.key]) ? (bounds as ZoneBounds) : null;
}
