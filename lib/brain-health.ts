// The chat brain's read tool for Fitbit data (via Google Health): one line per
// day with sleep, vitals, activity, the app's Sleep / Recovery / Strain scores
// (lib/health/scores.ts) and that day's watch workouts, plus range averages.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addDays } from "./dates";
import { listHealthDays, listHealthWorkouts, type HealthDay, type HealthWorkout } from "./health/queries";
import { dayStrain, recoveryScore, sleepPerformance, workoutStrain, type RecoveryScore } from "./health/scores";
import { fahrenheitDelta } from "./health/units";

export const HEALTH_TOOLS = ["get_health"];

export const HEALTH_PROMPT = `## Health data
- get_health reads their watch data for any range: sleep (duration, stages, bed and wake times), HRV, resting heart rate, SpO2, breathing rate, VO2 max, skin temperature vs baseline, steps, active calories, heart-zone minutes, the app's Sleep, Recovery and Strain scores, and each day's watch workouts. Data starts in late June 2026.
- Use it whenever they ask about sleep, recovery, strain, heart rate, trends or how a day went, and to connect what they ate or did to how they recovered. Pull the range you need; for trends, compare against the averages it returns.
- Sleep is dated by the morning they woke up. Today's activity and strain are partial until the day ends.`;

const MAX_DAYS = 366;

function hm(minutes: number) {
  return `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
}

function round(value: number, places = 0) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function describeWorkout(w: HealthWorkout) {
  const strain = workoutStrain(w);
  return [
    `${w.name} ${w.startedAt.slice(11)}`,
    w.activeMinutes != null ? `${w.activeMinutes} min` : null,
    w.distanceMiles ? `${round(w.distanceMiles, 1)} mi` : null,
    w.avgHr != null ? `avg HR ${w.avgHr}` : null,
    w.calories != null ? `${w.calories} kcal` : null,
    strain != null ? `strain ${strain}` : null
  ]
    .filter(Boolean)
    .join(", ");
}

function describeDay(day: HealthDay, recovery: RecoveryScore | undefined, workouts: HealthWorkout[]) {
  const parts: (string | null)[] = [];
  if (day.sleepMinutes != null) {
    const detail = [
      `${sleepPerformance(day.sleepMinutes)}% of need`,
      day.bedtime && day.wakeTime ? `bed ${day.bedtime.slice(11)}, wake ${day.wakeTime.slice(11)}` : null,
      day.deepMinutes != null ? `deep ${day.deepMinutes}m` : null,
      day.remMinutes != null ? `REM ${day.remMinutes}m` : null,
      day.lightMinutes != null ? `light ${day.lightMinutes}m` : null,
      day.awakeMinutes != null ? `awake ${day.awakeMinutes}m` : null
    ].filter(Boolean);
    parts.push(`sleep ${hm(day.sleepMinutes)} (${detail.join(", ")})`);
  }
  const strain = dayStrain(day, workouts);
  parts.push(
    recovery ? `recovery ${recovery.score}% ${recovery.band}` : null,
    day.hrvMs != null ? `HRV ${round(day.hrvMs)} ms` : null,
    day.restingHr != null ? `RHR ${day.restingHr}` : null,
    strain != null ? `strain ${strain}` : null,
    day.steps != null ? `${day.steps} steps` : null,
    day.activeKcal != null ? `${round(day.activeKcal)} active kcal` : null,
    day.zoneMinutesFatBurn != null || day.zoneMinutesCardio != null || day.zoneMinutesPeak != null
      ? `zone min fat burn ${day.zoneMinutesFatBurn ?? 0}/cardio ${day.zoneMinutesCardio ?? 0}/peak ${day.zoneMinutesPeak ?? 0}`
      : null,
    day.spo2Pct != null ? `SpO2 ${round(day.spo2Pct, 1)}%` : null,
    day.breathsPerMin != null ? `breathing ${round(day.breathsPerMin, 1)}/min` : null,
    day.vo2Max != null ? `VO2 max ${day.vo2Max}` : null,
    day.sleepTempVsBaselineC != null
      ? `skin temp ${fahrenheitDelta(day.sleepTempVsBaselineC)} vs baseline`
      : null,
    workouts.length ? `workouts: ${workouts.map(describeWorkout).join("; ")}` : null
  );
  return `${day.day}: ${parts.filter(Boolean).join(" · ") || "no data"}`;
}

function average(values: (number | null | undefined)[]) {
  const present = values.filter((value): value is number => value != null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

export function healthTools({ userName, today }: { userName: string; today: string }) {
  return [
    tool(
      "get_health",
      `Watch data for a date range (at most ${MAX_DAYS} days), oldest first: one line per day with sleep, vitals, activity, Sleep / Recovery / Strain scores and workouts, then averages over the range.`,
      {
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD."),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD.")
      },
      async (args) => {
        const end = args.end_date > today ? today : args.end_date;
        if (args.start_date > end || addDays(args.start_date, MAX_DAYS) < end) {
          return {
            content: [{ type: "text" as const, text: `Use a range of at most ${MAX_DAYS} days, start before end.` }],
            isError: true
          };
        }
        // Recovery needs the 30 days before each scored day as its baseline.
        const [allDays, workouts] = await Promise.all([
          listHealthDays(userName, addDays(args.start_date, -31), end),
          listHealthWorkouts(userName, args.start_date, end)
        ]);
        const recoveryByDay = new Map<string, RecoveryScore>();
        allDays.forEach((day, index) => {
          if (day.hrvMs == null || day.restingHr == null) return;
          const score = recoveryScore(allDays.slice(0, index + 1));
          if (score) recoveryByDay.set(day.day, score);
        });
        const workoutsByDay = new Map<string, HealthWorkout[]>();
        for (const w of [...workouts].reverse()) {
          workoutsByDay.set(w.day, [...(workoutsByDay.get(w.day) ?? []), w]);
        }
        const days = allDays.filter((day) => day.day >= args.start_date);
        if (!days.length) {
          return { content: [{ type: "text" as const, text: "No watch data in that range." }] };
        }

        const lines = days.map((day) => describeDay(day, recoveryByDay.get(day.day), workoutsByDay.get(day.day) ?? []));
        // Today is partial, so it stays out of the averages.
        const full = days.filter((day) => day.day < today);
        const avg = {
          sleep: average(full.map((day) => day.sleepMinutes)),
          recovery: average(full.map((day) => recoveryByDay.get(day.day)?.score)),
          hrv: average(full.map((day) => day.hrvMs)),
          rhr: average(full.map((day) => day.restingHr)),
          strain: average(full.map((day) => dayStrain(day, workoutsByDay.get(day.day)))),
          steps: average(full.map((day) => day.steps))
        };
        const summary = [
          avg.sleep != null ? `sleep ${hm(avg.sleep)}` : null,
          avg.recovery != null ? `recovery ${round(avg.recovery)}%` : null,
          avg.hrv != null ? `HRV ${round(avg.hrv)} ms` : null,
          avg.rhr != null ? `RHR ${round(avg.rhr, 1)}` : null,
          avg.strain != null ? `strain ${round(avg.strain, 1)}` : null,
          avg.steps != null ? `${round(avg.steps)} steps` : null,
          `${workouts.length} workouts`
        ].filter(Boolean);
        lines.push(`Averages over ${full.length} full days: ${summary.join(" · ")}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      },
      { annotations: { readOnlyHint: true } }
    )
  ];
}
