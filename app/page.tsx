import Link from "next/link";
import type { ReactNode } from "react";
import { addWaterAction, deleteCheckinAction, undoWaterAction } from "./actions";
import { BodyCard, type DayScore } from "./body-ui";
import { DayStrip, type StripDay } from "./day-strip";
import { TodayCheckin } from "./today-checkin";
import { RefreshButton } from "./refresh-button";
import { EntryCard } from "./entry-card";
import { AppShell, GoalsForm, Login } from "./shared-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, isValidLocalDate, localDateTime, rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { getBodyState } from "@/lib/body-state/load";
import { listBodyStates } from "@/lib/body-state/store";
import { morningBrief, type Reply } from "@/lib/body-state/brief";
import type { Status } from "@/lib/body-state/types";
import { gramsFromPercentGoals, restingKcalPerMinute, withWorkoutCalories, workoutCalories } from "@/lib/goals";
import { listJournalEntries, recordedRatings, type JournalEntry } from "@/lib/journal";
import {
  getLatestHealthSyncRun,
  listHealthDays,
  listHealthWorkouts,
  type HealthDay,
  type HealthWorkout,
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
  getUserGoals,
  getWaterOunces,
  getPool,
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
const CHECKIN_COLOR = "#8e8e93";

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

// Whoop's strain bands, in words.
function strainWord(strain: number) {
  return strain < 10 ? "light" : strain < 14 ? "moderate" : strain < 18 ? "strenuous" : "all out";
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

// Water at the bottom of the Body card: the day's ounces and quick adds.
function WaterQuick({ ounces, goalOz, date }: { ounces: number; goalOz: number; date: string }) {
  return (
    <div className="water-quick">
      <span>
        <strong>Water</strong> {integer.format(ounces)} of {goalOz} oz
      </span>
      {ounces > 0 ? (
        <form action={undoWaterAction}>
          <input type="hidden" name="entryDate" value={date} />
          <button type="submit" className="text-button" aria-label="Undo the last water">
            Undo
          </button>
        </form>
      ) : null}
      <form className="water-quick-buttons" action={addWaterAction}>
        <input type="hidden" name="entryDate" value={date} />
        {[8, 16, 24].map((amount) => (
          <button key={amount} type="submit" name="oz" value={amount} aria-label={`Add ${amount} ounces of water`}>
            +{amount}
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

// Meal slot from the local minute the meal was eaten; untimed meals were logged on a later day.
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

// Grams per macro, each with the color of its bar in the Nutrition card.
function MacroChips({ totals }: { totals: { protein_g: number; carbs_g: number; fat_g: number } }) {
  return (
    <span className="macro-chips">
      <span className="macro-chip protein">{integer.format(totals.protein_g)}g protein</span>
      <span className="macro-chip carbs">{integer.format(totals.carbs_g)}g carbs</span>
      <span className="macro-chip fat">{integer.format(totals.fat_g)}g fat</span>
    </span>
  );
}

function MealDetails({ entry, date, time }: { entry: MacroEntry; date: string; time: string }) {
  return (
    <ul className="meal-details">
      <li>
        <div className="meal-details-entry">
          <span>{entry.raw_text}</span>
          <span>{integer.format(entry.calories)} kcal</span>
        </div>
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
        <EntryCard entry={entry} selectedDate={date} time={time} compact />
      </li>
    </ul>
  );
}

// Tapping a journal row: the full text and a Delete button.
function CheckinDetails({ id, date, text }: { id: string; date: string; text: string | null }) {
  return (
    <div className="checkin-details">
      {text ? <p>{text}</p> : null}
      <form action={deleteCheckinAction}>
        <input type="hidden" name="kind" value="journal" />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="entryDate" value={date} />
        <button type="submit" className="text-button danger">
          Delete
        </button>
      </form>
    </div>
  );
}

function journalEvent(entry: JournalEntry, date: string): TimelineEvent {
  const loggedAt = localWallClock(entry.createdAt);
  const sameDay = loggedAt != null && loggedAt.slice(0, 10) === date;
  // Mood first, then stress, each with its label: "Mood 4 · Good".
  const ratings = recordedRatings(entry.ratings)
    .filter((rating) => rating.name === "mood" || rating.name === "stress")
    .map((rating) => `${rating.name[0].toUpperCase()}${rating.name.slice(1)} ${rating.value} · ${rating.label}`);
  return {
    key: `journal-${entry.id}`,
    time: sameDay ? formatClock(loggedAt) : "",
    sort: sameDay ? minuteOfDay(loggedAt) : 24 * 60,
    color: CHECKIN_COLOR,
    title: `${entry.kind === "other" ? "Journal" : `${entry.kind[0].toUpperCase()}${entry.kind.slice(1)} journal`}`,
    detail: ratings.join(" · ") || entry.tags.join(", "),
    details: <CheckinDetails id={entry.id} date={date} text={entry.body} />
  };
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

  if (!getPool()) {
    return (
      <AppShell user={user} date={date} active="home" title={dayTitle(date, today)}>
        <p className="footnote">Add DATABASE_URL to see your data.</p>
      </AppShell>
    );
  }

  // The strip ends today unless the chosen day is further back than it reaches.
  const stripEnd = daysBetween(date, today) < STRIP_DAYS ? today : addDays(date, 7);
  const stripDates = rollingDateWindow(stripEnd, STRIP_DAYS);
  const priorDates = rollingDateWindow(addDays(date, -7), 7);
  // Each scored day needs a 30-day recovery baseline before it.
  const healthStart = addDays(stripDates[0] < priorDates[0] ? stripDates[0] : priorDates[0], -31);

  const db = getPool()!;
  const [entries, goals, healthDays, rangeWorkouts, waterOunces, lastRun, journal, body, stored] = await Promise.all([
    listEntriesForDateRange(user.name, priorDates[0], date),
    getUserGoals(user.name),
    listHealthDays(user.name, healthStart, stripEnd),
    // Every day the strip and trends score; day strain builds on its workouts.
    listHealthWorkouts(user.name, priorDates[0] < stripDates[0] ? priorDates[0] : stripDates[0], stripEnd),
    getWaterOunces(user.name, date),
    getLatestHealthSyncRun(user.name),
    listJournalEntries(db, user.name, date, date),
    // The chosen day's body state, built fresh; other days come from storage.
    getBodyState(db, user.name, date),
    listBodyStates(db, user.name, stripDates[0], stripEnd)
  ]);
  const statusByDay = new Map<string, Status>(stored.map((day) => [day.date, day.state.physical.status]));
  statusByDay.set(date, body.physical.status);

  const healthByDay = new Map(healthDays.map((day) => [day.day, day]));
  const workoutsByDay = new Map<string, HealthWorkout[]>();
  for (const workout of rangeWorkouts) workoutsByDay.set(workout.day, [...(workoutsByDay.get(workout.day) ?? []), workout]);
  const workouts = workoutsByDay.get(date) ?? [];
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
  const strainOn = (day: string) => dayStrain(healthByDay.get(day), workoutsByDay.get(day));


  // Strip
  const stripDays: StripDay[] = stripDates.map((day) => {
    return {
      date: day,
      href: day === today ? "/" : `/?date=${day}`,
      weekday: weekdayShort.format(utcDate(day)),
      dayOfMonth: Number(day.slice(8)),
      label: fullDate.format(utcDate(day)),
      selected: day === date,
      status: statusByDay.get(day) ?? "unknown"
    };
  });

  // Day scores
  const health = healthByDay.get(date);
  const sleepMinutes = health?.sleepMinutes ?? null;
  const sleepPercent = sleepPerformance(sleepMinutes);
  const recovery = recoveryByDay.get(date) ?? null;
  const strain = strainOn(date);
  const scores: DayScore[] = [
    {
      label: "Sleep",
      color: "var(--sleep-ink)",
      value: sleepMinutes != null ? formatDuration(sleepMinutes) : "–",
      note: sleepPercent != null ? `${sleepPercent}% of need` : "No data"
    },
    {
      label: "Recovery",
      color: recovery ? BAND_TEXT[recovery.band] : "var(--muted)",
      value: recovery ? `${recovery.score}` : "–",
      note: recovery ? BAND_LABELS[recovery.band].toLowerCase() : "No data"
    },
    {
      label: "Strain",
      color: "var(--strain-ink)",
      value: strain == null ? "–" : strain.toFixed(1),
      note: strain == null ? "No data" : `${isToday ? "so far" : "day"} · ${strainWord(strain)}`
    }
  ];

  // The check-in at the top: the morning brief until 5 pm, then the evening.
  const evening = isToday && Number(localDateTime().slice(11, 13)) >= 17;
  const brief = morningBrief(body);
  const answered = journal.find((entry) => entry.kind === (evening ? "evening" : "morning"));
  const answeredAt = answered ? localWallClock(answered.createdAt) : null;
  const checkin = evening
    ? {
        kicker: "Evening check-in",
        text: "How did today go?",
        call: null,
        replies: [
          { label: "Good day", message: "Evening check-in: good day." },
          { label: "Okay", message: "Evening check-in: okay day." },
          { label: "Rough day", message: "Evening check-in: rough day." }
        ] as Reply[]
      }
    : { kicker: "Morning check-in", text: brief.text, call: brief.call, replies: brief.replies };
  const checkinStatus = answered ? `Checked in${answeredAt ? ` ${formatClock(answeredAt)}` : ""}` : "Not answered";

  // Nutrition
  const dayEntries = entries.filter((entry) => entry.entry_date === date);
  const eaten = summarizeEntries(dayEntries);
  // The target grows by what the day's workouts burned beyond resting.
  const workoutKcal = workoutCalories(workouts, restingKcalPerMinute(healthDays, date));
  const dayGoals = withWorkoutCalories(goals, workoutKcal);
  const gramGoals = gramsFromPercentGoals(dayGoals);
  const caloriesLeft = Math.round(dayGoals.calories - eaten.calories);
  const callout = nutritionCallout(dayEntries, caloriesLeft, Math.round(gramGoals.protein_g - eaten.protein_g), isToday);
  const macros = [
    { key: "protein", label: "Protein", value: eaten.protein_g, goal: gramGoals.protein_g },
    { key: "carbs", label: "Carbs", value: eaten.carbs_g, goal: gramGoals.carbs_g },
    { key: "fat", label: "Fat", value: eaten.fat_g, goal: gramGoals.fat_g }
  ];

  scores.push({
    label: "Fuel",
    color: "var(--fuel-ink)",
    value: dayEntries.length ? integer.format(eaten.calories) : "–",
    note: `of ${integer.format(dayGoals.calories)}`
  });
  // Fuel's dot: over target or well short on protein by evening is a watch.
  const fuelStatus: Status = !dayEntries.length
    ? "unknown"
    : caloriesLeft < 0 || (!isToday && gramGoals.protein_g - eaten.protein_g > 20)
      ? "watch"
      : "ok";

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
  // One row per meal entry; tapping it shows its items and the edit card.
  for (const entry of [...dayEntries].reverse()) {
    // eaten_at when set; otherwise created_at (when it was logged), but only if logged that same day.
    const loggedAt = localWallClock(entry.created_at);
    const at = entry.eaten_at ? `${date}T${entry.eaten_at}` : loggedAt != null && loggedAt.slice(0, 10) === date ? loggedAt : null;
    const minute = at ? minuteOfDay(at) : null;
    // Chat-logged meals carry their type; older ones are guessed from the time.
    const label = entry.meal_type ? entry.meal_type[0].toUpperCase() + entry.meal_type.slice(1) : mealSlot(minute);
    timed.push({
      key: `meal-${entry.id}`,
      time: at ? formatClock(at) : "",
      sort: minute ?? 24 * 60,
      color: FUEL_COLOR,
      title: label,
      detail: entry.items.map((item) => item.name).join(", "),
      extra: <MacroChips totals={entry} />,
      value: integer.format(entry.calories),
      unit: "kcal",
      details: <MealDetails entry={entry} date={date} time={at ? at.slice(11, 16) : ""} />
    });
  }
  for (const entry of journal) {
    timed.push(journalEvent(entry, date));
  }
  for (const workout of workouts.filter((item) => !item.ignored)) {
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

  return (
    <AppShell user={user} date={date} active="home" title={dayTitle(date, today)} headerAction={headerAction}>
      <DayStrip days={stripDays} earlierHref={`/?date=${addDays(stripDates[0], -1)}`} />

      {params?.error ? (
        <p className="page-error" role="alert">
          {params.error}
        </p>
      ) : null}

      {isToday ? (
        <TodayCheckin kicker={checkin.kicker} status={checkinStatus} text={checkin.text} call={checkin.call} replies={answered ? [] : checkin.replies} />
      ) : null}

      <BodyCard
        state={body}
        scores={scores}
        fuel={{
          status: fuelStatus,
          value: dayEntries.length
            ? caloriesLeft >= 0
              ? `${integer.format(caloriesLeft)} kcal left · ${integer.format(eaten.protein_g)} / ${gramGoals.protein_g} g protein`
              : `${integer.format(-caloriesLeft)} kcal over`
            : "Nothing logged",
          open: isToday && dayEntries.length > 0,
          details: (
            <>
              <div className="macro-bars">
                {macros.map((macro) => (
                  <div key={macro.key}>
                    <div className="macro-bar-label">
                      <span>{macro.label}</span>
                      <span>
                        <strong>{integer.format(macro.value)}</strong> / {macro.goal}g
                      </span>
                    </div>
                    <div className={`macro-bar ${macro.key}`} role="presentation">
                      <div
                        className={`macro-fill ${macro.key}`}
                        style={{ width: `${macro.goal > 0 ? Math.min(100, (macro.value / macro.goal) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <span className="footnote">
                {workoutKcal ? `${integer.format(goals.calories)} + ${integer.format(workoutKcal)} from workouts. ` : ""}
                {isToday && body.physical.illness.phase === "sick" ? "While sick: fluids and easy protein matter most." : callout.text}
              </span>
            </>
          )
        }}
        water={<WaterQuick ounces={waterOunces} goalOz={goals.waterOz} date={date} />}
      />

      <Timeline title={isToday ? "Today so far" : "The day"} events={events} />

      <div className="sync-bar">
        <SyncNote run={lastRun} />
        <RefreshButton />
      </div>

      <GoalsForm goals={goals} redirectDate={date} />

    </AppShell>
  );
}
