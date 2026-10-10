import Link from "next/link";
import type { ReactNode } from "react";
import { addWaterAction } from "./actions";
import { Sparkline } from "./charts";
import { DayStrip, type StripDay } from "./day-strip";
import { RefreshButton } from "./refresh-button";
import { AppShell, Login } from "./shared-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, isValidLocalDate, rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { gramsFromPercentGoals, WATER_GOAL_OZ } from "@/lib/goals";
import {
  getLatestHealthSyncRun,
  listHealthDays,
  listHealthWorkouts,
  type HealthDay,
  type HealthSyncRun
} from "@/lib/health/queries";
import {
  dayStrain,
  recoveryScore,
  sleepPerformance,
  workoutStrain,
  type RecoveryBand,
  type RecoveryScore
} from "@/lib/health/scores";
import {
  getUserMacroGoals,
  getWaterOunces,
  isDatabaseConfigured,
  listEntriesForDateRange,
  summarizeEntries,
  type MacroEntry
} from "@/lib/supabase";

// Covers the manual Refresh action, which runs a ~10 second sync.
export const maxDuration = 60;

type PageProps = {
  searchParams?: Promise<{ error?: string; date?: string }>;
};

// Days shown in the scrolling strip at the top.
const STRIP_DAYS = 28;
const TIME_ZONE = process.env.APP_TIME_ZONE || "America/New_York";

// Recovery uses the status palette (always with a text label, never color
// alone); the *_TEXT steps are dark enough for text on white.
const BAND_COLORS: Record<RecoveryBand, string> = { green: "#0ca30c", yellow: "#fab219", red: "#d03b3b" };
const BAND_TEXT: Record<RecoveryBand, string> = { green: "#0a7f0a", yellow: "#8a5d00", red: "#b42f2f" };
const BAND_LABELS: Record<RecoveryBand, string> = { green: "Green", yellow: "Yellow", red: "Red" };
const BAND_NOTES: Record<RecoveryBand, string> = {
  green: "Ready for a hard day.",
  yellow: "Train, but not all out.",
  red: "An easier day would help."
};
const SLEEP_COLOR = "#2a78d6";
const STRAIN_COLOR = "#eb6834";
const FUEL_COLOR = "#7a4fd1";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const weekdayLong = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const localDateTimeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function utcDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function daysBetween(from: string, to: string) {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

function dayTitle(date: string, today: string) {
  const ago = daysBetween(date, today);
  if (ago === 0) {
    return "Today";
  }
  if (ago === 1) {
    return "Yesterday";
  }
  return ago < 7 ? weekdayLong.format(utcDate(date)) : monthDay.format(utcDate(date));
}

function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
}

// Values from the views are local wall-clock strings ("YYYY-MM-DDTHH:MM"); format them as-is.
function formatLocal(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}:00Z`));
}

function formatClock(value: string) {
  return formatLocal(value, { hour: "numeric", minute: "2-digit" });
}

function minuteOfDay(value: string) {
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}

// A timestamptz from Postgres ("2026-10-09 16:10:33.1+00") as a local
// wall-clock string in APP_TIME_ZONE, matching the health views.
function localWallClock(timestamp: string) {
  const date = new Date(timestamp.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = Object.fromEntries(localDateTimeParts.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function average(values: (number | null | undefined)[]) {
  const present = values.filter((value): value is number => value != null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

type Delta = { text: string; tone: "good" | "bad" | "neutral" };

// A day's value against the average of the 7 days before it, as "▲ 12 ms".
// Gray within the noise threshold, or when higher is neither good nor bad.
function deltaFrom(
  current: number | null,
  prior: (number | null)[],
  higherIsGood: boolean | null,
  threshold: number,
  format: (value: number) => string
): Delta | null {
  const baseline = average(prior);
  if (current == null || baseline == null) {
    return null;
  }
  const difference = current - baseline;
  const up = difference >= 0;
  return {
    text: `${up ? "▲" : "▼"} ${format(Math.abs(difference))}`,
    tone: higherIsGood == null || Math.abs(difference) < threshold ? "neutral" : up === higherIsGood ? "good" : "bad"
  };
}

function DeltaText({ delta }: { delta: Delta | null }) {
  return delta ? <span className={`delta ${delta.tone}`}>{delta.text}</span> : null;
}

type Ring = {
  label: string;
  percent: number | null;
  color: string;
  textColor: string;
  value: string;
  caption: string;
  // Smaller line under the value.
  note?: string;
};

// Concentric rings, outermost first, with a legend beside them.
function ScoreRings({ rings }: { rings: Ring[] }) {
  const radii = [64, 48, 32];
  return (
    <section className="card score-rings" aria-label="Day scores">
      <svg viewBox="0 0 150 150" aria-hidden="true">
        {rings.map((ring, index) => {
          const radius = radii[index];
          const circumference = 2 * Math.PI * radius;
          const filled = ring.percent == null ? 0 : Math.max(0, Math.min(100, ring.percent)) / 100;
          return (
            <g key={ring.label}>
              <circle cx="75" cy="75" r={radius} fill="none" stroke={ring.color} strokeOpacity={0.15} strokeWidth="13" />
              {filled > 0 ? (
                <circle
                  cx="75"
                  cy="75"
                  r={radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={`${circumference * filled} ${circumference}`}
                  transform="rotate(-90 75 75)"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <dl>
        {rings.map((ring) => (
          <div key={ring.label}>
            <dt style={{ color: ring.textColor }}>{ring.label}</dt>
            <dd>
              {ring.value} <span>{ring.caption}</span>
            </dd>
            {ring.note ? <dd className="ring-note">{ring.note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

const BOTTLE_PATH = "M30 6 H50 V20 C50 28 72 30 72 46 V124 Q72 136 60 136 H20 Q8 136 8 124 V46 C8 30 30 28 30 20 Z";

function wavePath(y: number, amplitude: number) {
  let path = `M0 ${y.toFixed(1)}`;
  for (let x = 0; x < 120; x += 20) {
    path += ` q10 ${-amplitude} 20 0`;
  }
  return `${path} V140 H0 Z`;
}

function WaterRow({ ounces, date }: { ounces: number; date: string }) {
  const level = Math.min(1, ounces / WATER_GOAL_OZ);
  const surface = 134 - 104 * level;
  const left = WATER_GOAL_OZ - ounces;
  return (
    <div className="water-row">
      <svg className="water-bottle" viewBox="0 0 80 140" role="img" aria-label={`Water: ${integer.format(ounces)} of ${WATER_GOAL_OZ} oz`}>
        <defs>
          <clipPath id="bottle-inside">
            <path d={BOTTLE_PATH} />
          </clipPath>
        </defs>
        <path d={BOTTLE_PATH} fill="var(--water-soft)" />
        {level > 0 ? (
          <g clipPath="url(#bottle-inside)">
            <path className="wave-back" d={wavePath(surface - 2, 3)} fill="var(--water)" fillOpacity="0.35" />
            <path className="wave" d={wavePath(surface, 4)} fill="var(--water)" />
          </g>
        ) : null}
        <path d={BOTTLE_PATH} fill="none" stroke="var(--water-ink)" strokeWidth="6" />
      </svg>
      <div className="water-figure">
        <span>
          <strong>{integer.format(ounces)}</strong> / {WATER_GOAL_OZ} oz
        </span>
        <small>{left > 0 ? `${integer.format(left)} oz to go` : "Goal reached"}</small>
      </div>
      <form className="water-buttons" action={addWaterAction}>
        <input type="hidden" name="entryDate" value={date} />
        {[8, 16, 24].map((ounces) => (
          <button key={ounces} type="submit" name="oz" value={ounces} aria-label={`Add ${ounces} ounces of water`}>
            +{ounces}
          </button>
        ))}
      </form>
    </div>
  );
}

type TimelineEvent = {
  key: string;
  time: string;
  sort: number;
  color: string;
  title: string;
  detail: string;
  extra?: ReactNode;
  value?: string;
  unit?: string;
  valueColor?: string;
  // Shown when the row is tapped open.
  details?: ReactNode;
};

// Meal slot from the local minute the meal was logged; untimed meals were logged on a later day.
function mealSlot(minute: number | null) {
  if (minute == null) {
    return "Logged later";
  }
  if (minute < 10 * 60 + 30) {
    return "Breakfast";
  }
  if (minute < 15 * 60) {
    return "Lunch";
  }
  if (minute >= 17 * 60 && minute < 21 * 60 + 30) {
    return "Dinner";
  }
  return "Snack";
}

// Grams per macro, each with the dot color of its bar in the Nutrition card.
function MacroChips({ totals }: { totals: { protein_g: number; carbs_g: number; fat_g: number } }) {
  return (
    <span className="macro-chips">
      <span className="macro-chip protein">{integer.format(totals.protein_g)}g protein</span>
      <span className="macro-chip carbs">{integer.format(totals.carbs_g)}g carbs</span>
      <span className="macro-chip fat">{integer.format(totals.fat_g)}g fat</span>
    </span>
  );
}

function MealDetails({ entries }: { entries: MacroEntry[] }) {
  return (
    <ul className="meal-details">
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="meal-details-entry">
            <span>{entry.raw_text}</span>
            <span>{integer.format(entry.calories)} kcal</span>
          </div>
          {entries.length > 1 ? <MacroChips totals={entry} /> : null}
          {entry.items.length > 1 ? (
            <ul>
              {entry.items.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <span>{item.name}</span>
                  <span>
                    {integer.format(item.calories)} kcal · {integer.format(item.protein_g)}g protein
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Timeline({ title, events }: { title: string; events: TimelineEvent[] }) {
  return (
    <section className="card timeline-card" aria-label={title}>
      <h2 className="card-title">{title}</h2>
      {events.length ? (
        <ol className="timeline">
          {events.map((event) => {
            const summary = (
              <>
                <div className="timeline-main">
                  <div>
                    <strong>
                      {event.title}
                      {event.details ? (
                        <svg className="timeline-chevron" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      ) : null}
                    </strong>
                    {event.detail ? <span>{event.detail}</span> : null}
                  </div>
                  {event.value ? (
                    <div className="timeline-value">
                      <strong style={event.valueColor ? { color: event.valueColor } : undefined}>{event.value}</strong>
                      <span>{event.unit}</span>
                    </div>
                  ) : null}
                </div>
                {event.extra}
              </>
            );
            return (
              <li key={event.key}>
                <span className="timeline-time">{event.time}</span>
                <span className="timeline-rail" aria-hidden="true">
                  <span style={{ background: event.color }} />
                </span>
                {event.details ? (
                  <details className="timeline-details">
                    <summary className="timeline-body">{summary}</summary>
                    {event.details}
                  </details>
                ) : (
                  <div className="timeline-body">{summary}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="footnote">Nothing recorded for this day.</p>
      )}
    </section>
  );
}

type Tile = { label: string; textColor: string; color: string; value: string; values: (number | null)[]; delta: Delta | null };

function TrendTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="group" aria-label="Last 7 days">
      <div className="group-heading">
        <h2 className="group-title">Last 7 days</h2>
        <span className="group-aside">vs the 7 days before</span>
      </div>
      <div className="trend-grid">
        {tiles.map((tile) => (
          <div className="card trend-tile" key={tile.label}>
            <span className="trend-label" style={{ color: tile.textColor }}>
              {tile.label}
            </span>
            <strong>{tile.value}</strong>
            <Sparkline values={tile.values} color={tile.color} label={`${tile.label}, last 7 days`} />
            {tile.delta ? <DeltaText delta={tile.delta} /> : <span className="delta neutral">&nbsp;</span>}
          </div>
        ))}
      </div>
    </section>
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
    timeZone: TIME_ZONE
  }).format(new Date(run.startedAt));
  if (run.status === "failed") {
    return <p className="footnote warning">⚠ Fitbit sync failed {when}. Showing the last good data.</p>;
  }
  return <p className="footnote">Fitbit synced {when}</p>;
}

function nutritionCallout(
  entries: MacroEntry[],
  caloriesLeft: number,
  proteinGap: number,
  isToday: boolean
): { text: string; tone: "good" | "bad" | "neutral" } {
  if (!entries.length) {
    return { text: isToday ? "Nothing logged yet." : "No meals logged.", tone: "neutral" };
  }
  if (caloriesLeft < 0) {
    const protein = proteinGap > 10 ? `, ${integer.format(proteinGap)}g short on protein` : "";
    return { text: `${integer.format(-caloriesLeft)} kcal over${protein}`, tone: "bad" };
  }
  if (proteinGap > 10) {
    return isToday
      ? { text: `${integer.format(proteinGap)}g protein to go`, tone: "neutral" }
      : { text: `${integer.format(proteinGap)}g short on protein`, tone: "bad" };
  }
  return { text: "Protein goal hit", tone: "good" };
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    return <Login error={params?.error} />;
  }

  const today = todayLocalDate();
  const date = params?.date && isValidLocalDate(params.date) && params.date < today ? params.date : today;
  const isToday = date === today;
  const headerAction = isToday ? null : (
    <Link className="pill-button" href="/">
      Today
    </Link>
  );

  if (!isDatabaseConfigured()) {
    return (
      <AppShell user={user} date={date} active="home" title={dayTitle(date, today)}>
        <p className="footnote">Add DATABASE_URL to see your data.</p>
      </AppShell>
    );
  }

  // The strip ends today unless the chosen day is further back than it reaches.
  const stripEnd = daysBetween(date, today) < STRIP_DAYS ? today : addDays(date, 7);
  const stripDates = rollingDateWindow(stripEnd, STRIP_DAYS);
  const trendDates = rollingDateWindow(date, 7);
  const priorDates = rollingDateWindow(addDays(date, -7), 7);
  // Each scored day needs a 30-day recovery baseline before it.
  const healthStart = addDays(stripDates[0] < priorDates[0] ? stripDates[0] : priorDates[0], -31);

  const [entries, goals, healthDays, workouts, waterOunces, lastRun] = await Promise.all([
    listEntriesForDateRange(user.name, priorDates[0], date),
    getUserMacroGoals(user.name),
    listHealthDays(user.name, healthStart, stripEnd),
    listHealthWorkouts(user.name, date, date),
    getWaterOunces(user.name, date),
    getLatestHealthSyncRun(user.name)
  ]);

  const healthByDay = new Map(healthDays.map((day) => [day.day, day]));
  const recoveryByDay = new Map<string, RecoveryScore>();
  healthDays.forEach((day, index) => {
    if (day.hrvMs != null && day.restingHr != null) {
      const score = recoveryScore(healthDays.slice(0, index + 1));
      if (score) {
        recoveryByDay.set(day.day, score);
      }
    }
  });
  const pick = (day: string, field: (health: HealthDay) => number | null) => {
    const health = healthByDay.get(day);
    return health ? field(health) : null;
  };
  const sleepMinutesOn = (day: string) => pick(day, (health) => health.sleepMinutes);
  const strainOn = (day: string) => dayStrain(healthByDay.get(day));

  const caloriesByDay = new Map<string, number>();
  for (const entry of entries) {
    caloriesByDay.set(entry.entry_date, (caloriesByDay.get(entry.entry_date) ?? 0) + Number(entry.calories));
  }
  // Days with nothing logged are gaps, not zeros.
  const caloriesOn = (day: string) => caloriesByDay.get(day) ?? null;

  // Strip
  const stripDays: StripDay[] = stripDates.map((day) => {
    const sleep = sleepPerformance(sleepMinutesOn(day));
    const recovery = recoveryByDay.get(day);
    const strain = strainOn(day);
    return {
      date: day,
      href: day === today ? "/" : `/?date=${day}`,
      weekday: weekdayShort.format(utcDate(day)),
      dayOfMonth: Number(day.slice(8)),
      label: fullDate.format(utcDate(day)),
      selected: day === date,
      sleep: sleep == null ? null : sleep / 100,
      recovery: recovery ? recovery.score / 100 : null,
      recoveryColor: recovery ? BAND_COLORS[recovery.band] : "#8e8e93",
      strain: strain == null ? null : strain / 21
    };
  });

  // Rings
  const health = healthByDay.get(date);
  const sleepMinutes = health?.sleepMinutes ?? null;
  const sleepPercent = sleepPerformance(sleepMinutes);
  const recovery = recoveryByDay.get(date) ?? null;
  const strain = strainOn(date);
  const rings: Ring[] = [
    {
      label: "Sleep",
      percent: sleepPercent,
      color: SLEEP_COLOR,
      textColor: "var(--sleep-ink)",
      value: sleepMinutes != null ? formatDuration(sleepMinutes) : "–",
      caption: sleepMinutes != null ? "" : "No data",
      note: sleepPercent != null ? `${sleepPercent}% of need` : undefined
    },
    {
      label: "Recovery",
      percent: recovery?.score ?? null,
      color: recovery ? BAND_COLORS[recovery.band] : "#8e8e93",
      textColor: recovery ? BAND_TEXT[recovery.band] : "var(--muted)",
      value: recovery ? `${recovery.score}%` : "–",
      // The ring color and the timeline carry the band; the legend shows what drives the score.
      caption: recovery ? "" : "No data",
      note:
        [
          health?.hrvMs != null ? `HRV ${Math.round(health.hrvMs)} ms` : null,
          health?.restingHr != null ? `RHR ${health.restingHr} bpm` : null
        ]
          .filter(Boolean)
          .join(" · ") || undefined
    },
    {
      label: "Strain",
      percent: strain == null ? null : (strain / 21) * 100,
      color: STRAIN_COLOR,
      textColor: "var(--strain-ink)",
      value: strain == null ? "–" : strain.toFixed(1),
      caption: strain == null ? "No data" : "",
      note: health?.steps != null ? `${integer.format(health.steps)} steps` : undefined
    }
  ];

  // Nutrition
  const dayEntries = entries.filter((entry) => entry.entry_date === date);
  const eaten = summarizeEntries(dayEntries);
  const gramGoals = gramsFromPercentGoals(goals);
  const caloriesLeft = Math.round(goals.calories - eaten.calories);
  const callout = nutritionCallout(dayEntries, caloriesLeft, Math.round(gramGoals.protein_g - eaten.protein_g), isToday);
  const macros = [
    { key: "protein", label: "Protein", value: eaten.protein_g, goal: gramGoals.protein_g },
    { key: "carbs", label: "Carbs", value: eaten.carbs_g, goal: gramGoals.carbs_g },
    { key: "fat", label: "Fat", value: eaten.fat_g, goal: gramGoals.fat_g }
  ];

  // Timeline: last night's sleep, recovery on waking, then meals and workouts in clock order.
  const sleepDelta = (field: (day: HealthDay) => number | null, higherIsGood: boolean, unit: string, threshold: number) =>
    deltaFrom(
      pick(date, field),
      priorDates.map((day) => pick(day, field)),
      higherIsGood,
      threshold,
      (value) => `${integer.format(value)}${unit}`
    );
  const events: TimelineEvent[] = [];
  if (sleepMinutes != null) {
    const hrvDelta = sleepDelta((day) => day.hrvMs, true, " ms", 3);
    const rhrDelta = sleepDelta((day) => day.restingHr, false, " bpm", 1);
    events.push({
      key: "sleep",
      time: health?.bedtime ? formatClock(health.bedtime) : "",
      sort: -2,
      color: SLEEP_COLOR,
      title: `Slept ${formatDuration(sleepMinutes)}`,
      detail: [
        health?.bedtime && health.wakeTime ? `${formatClock(health.bedtime)} – ${formatClock(health.wakeTime)}` : null,
        sleepPercent != null ? `${sleepPercent}% of need` : null
      ]
        .filter(Boolean)
        .join(" · "),
      extra:
        health?.hrvMs != null || health?.restingHr != null ? (
          <span className="timeline-vitals">
            {health?.hrvMs != null ? (
              <>
                HRV {Math.round(health.hrvMs)} ms <DeltaText delta={hrvDelta} />
              </>
            ) : null}
            {health?.hrvMs != null && health?.restingHr != null ? " · " : null}
            {health?.restingHr != null ? (
              <>
                RHR {health.restingHr} bpm <DeltaText delta={rhrDelta} />
              </>
            ) : null}
          </span>
        ) : undefined
    });
  }
  if (recovery) {
    events.push({
      key: "recovery",
      time: health?.wakeTime ? formatClock(health.wakeTime) : "",
      sort: -1,
      color: BAND_COLORS[recovery.band],
      title: `Recovery ${recovery.score}% · ${BAND_LABELS[recovery.band]}`,
      detail: BAND_NOTES[recovery.band]
    });
  }
  const timed: TimelineEvent[] = [];
  // Meals collapse into one row per meal slot; tapping it shows each entry and its items.
  const mealGroups = new Map<string, { label: string; time: string; sort: number; entries: MacroEntry[] }>();
  for (const entry of [...dayEntries].reverse()) {
    // created_at is when the meal was logged; only treat it as a time when it was logged that same day.
    const loggedAt = localWallClock(entry.created_at);
    const sameDay = loggedAt != null && loggedAt.slice(0, 10) === date;
    const minute = sameDay ? minuteOfDay(loggedAt) : null;
    const label = mealSlot(minute);
    const group = mealGroups.get(label);
    if (group) {
      group.entries.push(entry);
    } else {
      mealGroups.set(label, {
        label,
        time: sameDay ? formatClock(loggedAt) : "",
        sort: minute ?? 24 * 60,
        entries: [entry]
      });
    }
  }
  for (const group of mealGroups.values()) {
    const total = summarizeEntries(group.entries);
    timed.push({
      key: `meal-${group.label}`,
      time: group.time,
      sort: group.sort,
      color: FUEL_COLOR,
      title: group.label,
      detail: "",
      extra: <MacroChips totals={total} />,
      value: integer.format(total.calories),
      unit: "kcal",
      details: <MealDetails entries={group.entries} />
    });
  }
  for (const workout of workouts) {
    const workoutLoad = workoutStrain(workout);
    timed.push({
      key: `workout-${workout.id}`,
      time: formatClock(workout.startedAt),
      sort: minuteOfDay(workout.startedAt),
      color: STRAIN_COLOR,
      title: workout.name,
      detail: [
        workout.activeMinutes != null ? `${workout.activeMinutes} min` : null,
        workout.distanceMiles != null && workout.distanceMiles > 0 ? `${workout.distanceMiles.toFixed(1)} mi` : null,
        workout.avgHr != null ? `${workout.avgHr} bpm` : null
      ]
        .filter(Boolean)
        .join(" · "),
      value: workoutLoad == null ? undefined : workoutLoad.toFixed(1),
      unit: "strain",
      valueColor: "var(--strain-ink)"
    });
  }
  events.push(...timed.sort((a, b) => a.sort - b.sort));
  // Steps live under Strain in the rings, so the closing row only needs the rest.
  const activity = [
    health?.activeKcal != null ? `${integer.format(health.activeKcal)} active kcal` : null,
    health?.distanceMiles != null ? `${health.distanceMiles.toFixed(1)} mi` : null
  ].filter(Boolean);
  if (activity.length) {
    events.push({ key: "activity", time: "",sort: 24 * 60 + 1, color: "#c7c7cc", title: activity.join(" · "), detail: "" });
  }

  // Trends. Today's strain and calories are partial, so they get no comparison.
  const tiles: Tile[] = [
    {
      label: "Sleep",
      textColor: "var(--sleep-ink)",
      color: SLEEP_COLOR,
      value: sleepMinutes != null ? formatDuration(sleepMinutes) : "–",
      values: trendDates.map(sleepMinutesOn),
      delta: deltaFrom(sleepMinutes, priorDates.map(sleepMinutesOn), true, 15, (value) => `${integer.format(value)}m`)
    },
    {
      label: "Recovery",
      textColor: recovery ? BAND_TEXT[recovery.band] : "var(--muted)",
      color: recovery ? BAND_COLORS[recovery.band] : "#8e8e93",
      value: recovery ? `${recovery.score}%` : "–",
      values: trendDates.map((day) => recoveryByDay.get(day)?.score ?? null),
      delta: deltaFrom(
        recovery?.score ?? null,
        priorDates.map((day) => recoveryByDay.get(day)?.score ?? null),
        true,
        5,
        (value) => `${integer.format(value)} pts`
      )
    },
    {
      label: "Strain",
      textColor: "var(--strain-ink)",
      color: STRAIN_COLOR,
      value: strain == null ? "–" : strain.toFixed(1),
      values: trendDates.map(strainOn),
      delta: isToday ? null : deltaFrom(strain, priorDates.map(strainOn), null, 1, (value) => value.toFixed(1))
    },
    {
      label: "Calories",
      textColor: "var(--fuel-ink)",
      color: FUEL_COLOR,
      value: caloriesOn(date) != null ? integer.format(caloriesOn(date) as number) : "–",
      values: trendDates.map(caloriesOn),
      delta: isToday
        ? null
        : deltaFrom(caloriesOn(date), priorDates.map(caloriesOn), null, 100, (value) => `${integer.format(value)} kcal`)
    }
  ];

  return (
    <AppShell user={user} date={date} active="home" title={dayTitle(date, today)} headerAction={headerAction}>
      <DayStrip days={stripDays} earlierHref={`/?date=${addDays(stripDates[0], -1)}`} />

      <ScoreRings rings={rings} />

      <section className="card nutrition-card" aria-label="Nutrition">
        <div className="card-heading">
          <h2 className="card-title">Nutrition</h2>
          <span className={caloriesLeft < 0 ? "delta bad" : "card-aside"}>
            {caloriesLeft >= 0 ? `${integer.format(caloriesLeft)} left` : `${integer.format(-caloriesLeft)} over`}
          </span>
        </div>
        <div className="kcal-figure">
          <strong>{integer.format(eaten.calories)}</strong>
          <span>of {integer.format(goals.calories)} kcal</span>
        </div>
        <div className="macro-bars">
          {macros.map((macro) => (
            <div key={macro.key}>
              <div className="macro-bar-label">
                <span>{macro.label}</span>
                <span>
                  <strong>{integer.format(macro.value)}</strong> / {macro.goal}g
                </span>
              </div>
              <div className="macro-bar" role="presentation">
                <div
                  className={`macro-fill ${macro.key}`}
                  style={{ width: `${macro.goal > 0 ? Math.min(100, (macro.value / macro.goal) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className={`nutrition-callout ${callout.tone}`}>{callout.text}</p>
        {waterOunces != null ? <WaterRow ounces={waterOunces} date={date} /> : null}
      </section>

      <Timeline title={isToday ? "Today so far" : "The day"} events={events} />

      <TrendTiles tiles={tiles} />

      <div className="sync-bar">
        <SyncNote run={lastRun} />
        <RefreshButton />
      </div>

      <Link className="fab" href={`/profile?date=${date}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Log a meal
      </Link>
    </AppShell>
  );
}
