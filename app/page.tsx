import Link from "next/link";
import { RefreshButton } from "./refresh-button";
import { AppShell, Login } from "./shared-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, todayLocalDate } from "@/lib/dates";
import { gramsFromPercentGoals } from "@/lib/goals";
import {
  getLatestHealthSyncRun,
  listHealthDays,
  listHealthWorkouts,
  type HealthDay,
  type HealthSyncRun,
  type HealthWorkout
} from "@/lib/health/queries";
import {
  dayStrain,
  recoveryScore,
  sleepPerformance,
  strainBand,
  workoutStrain,
  type RecoveryBand
} from "@/lib/health/scores";
import { getUserMacroGoals, isDatabaseConfigured, listEntriesForDate, summarizeEntries } from "@/lib/supabase";

// Covers the manual Refresh action, which runs a ~10 second sync.
export const maxDuration = 60;

type PageProps = {
  searchParams?: Promise<{ error?: string }>;
};

// Recovery uses the status palette (with a text label, never color alone);
// sleep and activity use validated categorical slots.
const BAND_COLORS: Record<RecoveryBand, string> = { green: "#0ca30c", yellow: "#fab219", red: "#d03b3b" };
const BAND_LABELS: Record<RecoveryBand, string> = { green: "Green", yellow: "Yellow", red: "Red" };
const SLEEP_COLOR = "#2a78d6";
const ACTIVITY_COLOR = "#eb6834";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
}

// Values from the views are local wall-clock strings ("YYYY-MM-DDTHH:MM"); format them as-is.
function formatLocal(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}:00Z`));
}

function average(values: (number | null | undefined)[]) {
  const present = values.filter((value): value is number => value != null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function latestIndex(days: HealthDay[], pick: (day: HealthDay) => number | null) {
  return days.map((day) => pick(day) != null).lastIndexOf(true);
}

type Delta = { text: string; tone: "good" | "bad" | "neutral" };

// Latest value vs the average of the 7 days before it, as "▲ 12 ms".
// Gray when the change is within the noise threshold.
function weekDelta(
  days: HealthDay[],
  pick: (day: HealthDay) => number | null,
  higherIsGood: boolean,
  unit: string,
  threshold: number
): Delta | null {
  const index = latestIndex(days, pick);
  if (index < 0) {
    return null;
  }
  const baseline = average(days.slice(Math.max(0, index - 7), index).map(pick));
  if (baseline == null) {
    return null;
  }
  const difference = (pick(days[index]) as number) - baseline;
  const up = difference >= 0;
  return {
    text: `${up ? "▲" : "▼"} ${integer.format(Math.abs(difference))}${unit}`,
    tone: Math.abs(difference) < threshold ? "neutral" : up === higherIsGood ? "good" : "bad"
  };
}

// Ring meter: the track is a light step of the fill's own hue.
function Dial({
  label,
  percent,
  value,
  caption,
  color
}: {
  label: string;
  percent: number | null;
  value: string;
  caption: string;
  color: string;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const filled = percent == null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <div className="dial">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${label}: ${value}, ${caption}`}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth="8" />
        {filled > 0 ? (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
            transform="rotate(-90 50 50)"
          />
        ) : null}
        <text x="50" y="50" dy="0.35em" textAnchor="middle" className="dial-value">
          {value}
        </text>
      </svg>
      <strong>{label}</strong>
      <span>{caption}</span>
    </div>
  );
}

function Meter({ value, goal }: { value: number; goal: number }) {
  const percent = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  return (
    <div className="meter" role="presentation">
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

function SyncNote({ run }: { run: HealthSyncRun | null }) {
  if (!run) {
    return <p className="footnote">Fitbit hasn&apos;t synced yet.</p>;
  }
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: process.env.APP_TIME_ZONE || "America/New_York"
  }).format(new Date(run.startedAt));
  if (run.status === "failed") {
    return <p className="footnote warning">⚠ Fitbit sync failed {when}. Showing the last good data.</p>;
  }
  return <p className="footnote">Fitbit synced {when}</p>;
}

function WorkoutRow({ workout }: { workout: HealthWorkout }) {
  const strain = workoutStrain(workout);
  const details = [
    workout.activeMinutes != null ? `${workout.activeMinutes} min` : null,
    workout.calories != null ? `${integer.format(workout.calories)} kcal` : null,
    workout.avgHr != null ? `${workout.avgHr} bpm` : null
  ].filter(Boolean);
  return (
    <li className="list-row">
      <div>
        <strong>{workout.name}</strong>
        <span>
          {formatLocal(workout.startedAt, { weekday: "short", hour: "numeric", minute: "2-digit" })} ·{" "}
          {details.join(" · ")}
        </span>
      </div>
      <div className="list-value">
        <strong>{strain == null ? "–" : strain.toFixed(1)}</strong>
        {strain == null ? null : <span>{strainBand(strain)}</span>}
      </div>
    </li>
  );
}

function DeltaText({ delta }: { delta: Delta | null }) {
  return delta ? <span className={`delta ${delta.tone}`}>{delta.text}</span> : null;
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    return <Login error={params?.error} />;
  }

  const today = todayLocalDate();

  if (!isDatabaseConfigured()) {
    return (
      <AppShell user={user} date={today} active="home" title="Today">
        <p className="footnote">Add DATABASE_URL to see your data.</p>
      </AppShell>
    );
  }

  // 31 days: today plus a 30-day baseline for the recovery estimate.
  const [todayEntries, goals, healthDays, workouts, lastRun] = await Promise.all([
    listEntriesForDate(user.name, today),
    getUserMacroGoals(user.name),
    listHealthDays(user.name, addDays(today, -30), today),
    listHealthWorkouts(user.name, addDays(today, -6), today),
    getLatestHealthSyncRun(user.name)
  ]);

  const gramGoals = gramsFromPercentGoals(goals);
  const eatenToday = summarizeEntries(todayEntries);
  const caloriesLeft = Math.round(goals.calories - eatenToday.calories);

  const healthByDay = new Map(healthDays.map((day) => [day.day, day]));
  const todayHealth = healthByDay.get(today);
  const yesterdayHealth = healthByDay.get(addDays(today, -1));

  const recovery = recoveryScore(healthDays);
  const sleepIndex = latestIndex(healthDays, (day) => day.sleepMinutes);
  const lastSleep = sleepIndex < 0 ? null : healthDays[sleepIndex];
  const sleepPercent = sleepPerformance(lastSleep?.sleepMinutes ?? null);
  const hrvIndex = latestIndex(healthDays, (day) => day.hrvMs);
  const rhrIndex = latestIndex(healthDays, (day) => day.restingHr);
  const steps = todayHealth?.steps ?? null;
  const strain = dayStrain(todayHealth);
  const timeOnly: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

  return (
    <AppShell user={user} date={today} active="home" title="Today">
      <div className="sync-bar">
        <SyncNote run={lastRun} />
        <RefreshButton />
      </div>

      <section className="card dials" aria-label="Daily scores">
        <Dial
          label="Sleep"
          percent={sleepPercent}
          value={sleepPercent == null ? "–" : `${sleepPercent}%`}
          caption={lastSleep?.sleepMinutes != null ? formatDuration(lastSleep.sleepMinutes) : "No data"}
          color={SLEEP_COLOR}
        />
        <Dial
          label="Recovery"
          percent={recovery?.score ?? null}
          value={recovery ? `${recovery.score}%` : "–"}
          caption={recovery ? BAND_LABELS[recovery.band] : "Needs a week of data"}
          color={recovery ? BAND_COLORS[recovery.band] : "#8e8e93"}
        />
        <Dial
          label="Activity"
          percent={strain == null ? null : (strain / 21) * 100}
          value={strain == null ? "–" : strain.toFixed(1)}
          caption={strain == null ? "No data" : `${strainBand(strain)} strain`}
          color={ACTIVITY_COLOR}
        />
      </section>

      <section className="group">
        <h2 className="group-title">Nutrition</h2>
        <div className="card">
          <div className="card-figure">
            <div>
              <strong>{integer.format(eatenToday.calories)}</strong>
              <span>of {integer.format(goals.calories)} kcal</span>
            </div>
            <span className="card-aside">
              {caloriesLeft >= 0 ? `${integer.format(caloriesLeft)} left` : `${integer.format(-caloriesLeft)} over`}
            </span>
          </div>
          <Meter value={eatenToday.calories} goal={goals.calories} />
          <div className="macro-grid">
            {(
              [
                ["Protein", eatenToday.protein_g, gramGoals.protein_g],
                ["Carbs", eatenToday.carbs_g, gramGoals.carbs_g],
                ["Fat", eatenToday.fat_g, gramGoals.fat_g]
              ] as const
            ).map(([label, value, goal]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {integer.format(value)}
                  <small> / {goal}g</small>
                </strong>
                <Meter value={value} goal={goal} />
              </div>
            ))}
          </div>
          <Link className="ios-button" href="/profile">
            {todayEntries.length ? `Log a meal · ${todayEntries.length} today` : "Log a meal"}
          </Link>
        </div>
      </section>

      <section className="group">
        <h2 className="group-title">Recovery</h2>
        <ul className="card list">
          <li className="list-row">
            <div>
              <strong>Sleep</strong>
              <span>
                {lastSleep?.bedtime && lastSleep.wakeTime
                  ? `${formatLocal(lastSleep.bedtime, timeOnly)} – ${formatLocal(lastSleep.wakeTime, timeOnly)}`
                  : "No sleep recorded"}
              </span>
            </div>
            <div className="list-value">
              <strong>{lastSleep?.sleepMinutes != null ? formatDuration(lastSleep.sleepMinutes) : "–"}</strong>
              <DeltaText delta={weekDelta(healthDays, (day) => day.sleepMinutes, true, "m", 15)} />
            </div>
          </li>
          <li className="list-row">
            <div>
              <strong>HRV</strong>
            </div>
            <div className="list-value">
              <strong>{hrvIndex < 0 ? "–" : `${Math.round(healthDays[hrvIndex].hrvMs as number)} ms`}</strong>
              <DeltaText delta={weekDelta(healthDays, (day) => day.hrvMs, true, " ms", 3)} />
            </div>
          </li>
          <li className="list-row">
            <div>
              <strong>Resting heart rate</strong>
            </div>
            <div className="list-value">
              <strong>{rhrIndex < 0 ? "–" : `${healthDays[rhrIndex].restingHr} bpm`}</strong>
              <DeltaText delta={weekDelta(healthDays, (day) => day.restingHr, false, " bpm", 1)} />
            </div>
          </li>
        </ul>
      </section>

      <section className="group">
        <h2 className="group-title">Activity</h2>
        {workouts.length ? (
          <ul className="card list">
            {workouts.slice(0, 5).map((workout) => (
              <WorkoutRow key={workout.id} workout={workout} />
            ))}
          </ul>
        ) : (
          <p className="footnote">No workouts in the last 7 days.</p>
        )}
        <div className="card stat-row">
          <div>
            <span>Steps</span>
            <strong>{steps != null ? integer.format(steps) : "–"}</strong>
            <small>
              {yesterdayHealth?.steps != null ? `Yesterday ${integer.format(yesterdayHealth.steps)}` : "So far today"}
            </small>
          </div>
          <div>
            <span>Active</span>
            <strong>{todayHealth?.activeKcal != null ? integer.format(todayHealth.activeKcal) : "–"}</strong>
            <small>kcal</small>
          </div>
          <div>
            <span>Distance</span>
            <strong>{todayHealth?.distanceMiles != null ? todayHealth.distanceMiles.toFixed(1) : "–"}</strong>
            <small>mi</small>
          </div>
        </div>
      </section>

    </AppShell>
  );
}
