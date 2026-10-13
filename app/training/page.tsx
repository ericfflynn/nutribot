import { AppShell, Login } from "../shared-ui";
import { CoverageGrid, LabelButton, MergeControls, WorkoutEditor, type CoverageRow } from "../training-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { listHealthWorkouts, type HealthWorkout } from "@/lib/health/queries";
import { workoutStrain } from "@/lib/health/scores";
import { getPool } from "@/lib/supabase";
import { isPossibleDuplicate, type WorkoutRecord } from "@/lib/health/dedupe-rules";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_LABELS,
  MUSCLES,
  MUSCLE_GROUPS,
  STRENGTH_FITBIT_TYPES,
  STRENGTH_GROUPS,
  activityCategoryOf,
  lastByGroup,
  recommendNext,
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABELS,
  describeMuscles,
  groupsOf,
  lastTrainedByName,
  listFitbitWorkouts,
  listUnlabeledWorkouts,
  listWorkoutSessions,
  type FitbitWorkout,
  type MuscleGroup,
  type WorkoutSession,
  type WorkoutType,
  workoutTypeOf
} from "@/lib/workouts";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;
// Unlabeled strength workouts worth asking about.
const UNLABELED_DAYS = 7;
// A muscle group not trained for this many days shows as missing.
const MISSING_AFTER_DAYS = 7;

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" });
const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

function formatClock(localDateTime: string) {
  return clockFormat.format(new Date(`${localDateTime}:00Z`));
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Coverage cell shade from the day's hardest session for that group.
function intensityClass(rpe: number | null | undefined) {
  if (rpe === undefined) return "";
  if (rpe == null) return "level-2";
  if (rpe >= 8) return "level-3";
  if (rpe >= 6) return "level-2";
  return "level-1";
}

type RecentItem = {
  key: string;
  date: string;
  sort: string;
  when: string;
  title: string;
  detail: string;
  strain: number | null;
  chips: string[];
  minutes: number | null;
  workoutType: WorkoutType;
  session: WorkoutSession | null;
  // Watch workout id, for merging and separating recordings.
  fitbitId: string | null;
  mergedCount: number;
  overlaps: { id: string; label: string }[];
  // Set when the Fitbit workout has nothing logged for it.
  labelPrompt: string | null;
  status: string | null;
};

// A watch workout in the shape the duplicate rules compare. Local times are
// fine here: both sides of a comparison are in the same zone.
function asRecord(workout: FitbitWorkout): WorkoutRecord {
  return {
    id: workout.id,
    type: workout.type,
    startedAt: Date.parse(`${workout.startedAt}:00Z`),
    endedAt: Date.parse(`${workout.endedAt}:00Z`),
    activeMinutes: workout.activeMinutes,
    calories: workout.calories,
    avgHr: workout.avgHr,
    distanceMiles: null,
    steps: null
  };
}

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type: typeParam } = await searchParams;
  const typeFilter = (WORKOUT_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as WorkoutType) : null;
  const user = await getSessionUser();
  if (!user) {
    return <Login />;
  }

  const today = todayLocalDate();
  const days = rollingDateWindow(today, WINDOW_DAYS);
  const start = days[0];
  const db = getPool();
  if (!db) {
    return (
      <AppShell user={user} date={today} active="training" title="Training">
        <p className="footnote">Add DATABASE_URL to see your training.</p>
      </AppShell>
    );
  }

  const [sessions, fitbit, healthWorkouts, unlabeled, lastByName] = await Promise.all([
    listWorkoutSessions(db, user.name, start, today),
    listFitbitWorkouts(db, user.name, start, today),
    listHealthWorkouts(user.name, start, today),
    listUnlabeledWorkouts(db, user.name, addDays(today, -(UNLABELED_DAYS - 1)), today),
    lastTrainedByName(db, user.name, today)
  ]);
  const healthById = new Map<string, HealthWorkout>(healthWorkouts.map((workout) => [workout.id, workout]));
  const fitbitById = new Map<string, FitbitWorkout>(fitbit.map((workout) => [workout.id, workout]));

  // Coverage: the hardest RPE per day per group (null when trained without an RPE).
  const coverage = new Map<string, number | null>();
  const mark = (date: string, group: MuscleGroup, rpe: number | null) => {
    const key = `${date}|${group}`;
    const current = coverage.get(key);
    coverage.set(key, current == null ? rpe : rpe == null ? current : Math.max(current, rpe));
  };
  // Specific muscles, keyed the same way, for the expanded rows.
  const muscleCoverage = new Map<string, number | null>();
  for (const session of sessions) {
    for (const group of groupsOf(session.muscleGroups)) mark(session.date, group, session.rpe);
    for (const name of session.muscleGroups) {
      if ((MUSCLE_GROUPS as readonly string[]).includes(name)) continue;
      const key = `${session.date}|${name}`;
      const current = muscleCoverage.get(key);
      muscleCoverage.set(key, current == null ? session.rpe : session.rpe == null ? current : Math.max(current, session.rpe));
    }
  }

  const lastTrained = lastByGroup(lastByName);
  const sinceOf = (date: string | undefined) => (date ? daysBetween(date, today) : null);
  const coverageRows: CoverageRow[] = STRENGTH_GROUPS.map((group) => {
    const since = sinceOf(lastTrained.get(group));
    return {
      name: group,
      since,
      missing: since == null || since >= MISSING_AFTER_DAYS,
      levels: days.map((day) => {
        const key = `${day}|${group}`;
        return coverage.has(key) ? intensityClass(coverage.get(key)) : "";
      }),
      muscles: (MUSCLES[group] as readonly string[]).map((muscle) => ({
        name: muscle,
        since: sinceOf(lastByName.get(muscle)),
        missing: false,
        levels: days.map((day) => {
          const key = `${day}|${muscle}`;
          return muscleCoverage.has(key) ? intensityClass(muscleCoverage.get(key)) : "";
        }),
        muscles: []
      }))
    };
  });
  const nextUp = recommendNext(lastByName, today);

  // Recent workouts: every Fitbit workout except unlabeled walks, plus sessions
  // that aren't linked to one (pending or untracked).
  const recent: RecentItem[] = [];
  for (const workout of fitbit) {
    const session = workout.sessionId ? (sessions.find((item) => item.id === workout.sessionId) ?? null) : null;
    if (!session && workout.type === "WALKING") continue;
    const health = healthById.get(workout.id);
    const strain = health ? workoutStrain(health) : null;
    // Other watch workouts that overlap this one without being folded into it.
    const overlaps = fitbit
      .filter((other) => other.id !== workout.id)
      .filter((other) => isPossibleDuplicate(asRecord(workout), asRecord(other)))
      .map((other) => ({ id: other.id, label: `${other.name.toLowerCase()} at ${formatClock(other.startedAt)}` }));
    recent.push({
      key: workout.id,
      date: workout.day,
      sort: workout.startedAt,
      when: `${formatDay(workout.day)} · ${formatClock(workout.startedAt)}`,
      title: session?.name ?? workout.name,
      detail: [
        session ? WORKOUT_TYPE_LABELS[session.workoutType] : null,
        workout.activeMinutes != null ? `${workout.activeMinutes} min` : null,
        workout.avgHr != null ? `${workout.avgHr} bpm avg` : null,
        session?.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      strain,
      chips: session ? describeMuscles(session.muscleGroups) : [],
      minutes: workout.activeMinutes,
      workoutType: session?.workoutType ?? workoutTypeOf(workout.type),
      session,
      fitbitId: workout.id,
      mergedCount: workout.mergedIds.length,
      overlaps,
      labelPrompt: session || !STRENGTH_FITBIT_TYPES.includes(workout.type)
        ? null
        : `My ${workout.name.toLowerCase()} on ${formatDay(workout.day)} at ${formatClock(workout.startedAt)} was `,
      status: null
    });
  }
  for (const session of sessions) {
    if (session.healthRecordKey && fitbitById.has(session.healthRecordKey)) continue;
    recent.push({
      key: session.id,
      date: session.date,
      sort: `${session.date}T23:59`,
      when: formatDay(session.date),
      title: session.name,
      detail: [
        WORKOUT_TYPE_LABELS[session.workoutType],
        session.durationMin != null ? `${session.durationMin} min` : null,
        session.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      strain: null,
      chips: describeMuscles(session.muscleGroups),
      minutes: session.durationMin,
      workoutType: session.workoutType,
      session,
      fitbitId: null,
      mergedCount: 0,
      overlaps: [],
      labelPrompt: null,
      status: session.matchStatus === "pending" ? "Waiting for the watch" : "Not on the watch"
    });
  }
  recent.sort((a, b) => b.sort.localeCompare(a.sort));
  // Workout types present in the window, for the filter and the type counts.
  const typeCounts = new Map<WorkoutType, number>();
  for (const item of recent) typeCounts.set(item.workoutType, (typeCounts.get(item.workoutType) ?? 0) + 1);
  const shown = typeFilter ? recent.filter((item) => item.workoutType === typeFilter) : recent;

  // The mix: strength, cardio, mobility and sport by day, from the same list
  // (auto-detected walks are already left out).
  const activityRows: CoverageRow[] = ACTIVITY_CATEGORIES.map((category) => {
    const items = recent.filter((item) => activityCategoryOf(item.workoutType) === category);
    const dates = new Set(items.map((item) => item.date));
    const last = items.map((item) => item.date).sort().at(-1);
    return {
      name: ACTIVITY_LABELS[category],
      since: sinceOf(last),
      missing: false,
      levels: days.map((day) => (dates.has(day) ? `activity-${category}` : "")),
      muscles: []
    };
  });
  const activityTotals = ACTIVITY_CATEGORIES.map((category) => {
    const items = recent.filter((item) => activityCategoryOf(item.workoutType) === category);
    const minutes = items.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
    return { category, count: items.length, minutes };
  }).filter((total) => total.count);

  return (
    <AppShell
      user={user}
      date={today}
      active="training"
      title="Training"
    >
      <p className="training-range">
        Last {WINDOW_DAYS} days · {shortDay.format(new Date(`${start}T00:00:00Z`))} –{" "}
        {shortDay.format(new Date(`${today}T00:00:00Z`))}
      </p>

      <section className="card training-missing" aria-label="Next up">
        <span className="training-missing-label">Next up</span>
        <strong>{nextUp.split ? `${nextUp.split}${nextUp.addCore ? " + core" : ""}` : "You're covered"}</strong>
        <span className="training-missing-note">
          {nextUp.split
            ? nextUp.neglected
                .map((item) => `${item.muscle} ${item.since == null ? "not logged yet" : `${item.since} days`}`)
                .join(" · ")
            : "Every strength group was hit in the last few days. A rest day, cardio or mobility fits."}
        </span>
      </section>

      <section className="card" aria-label="Activity">
        <div className="card-heading">
          <h2 className="card-title">Activity</h2>
          <span className="card-aside">
            {activityTotals.map((total) => `${ACTIVITY_LABELS[total.category]} ${total.count}`).join(" · ") || "Nothing yet"}
          </span>
        </div>
        <CoverageGrid
          days={days.map((day) => ({ date: day, letter: weekdayLetter.format(new Date(`${day}T00:00:00Z`)) }))}
          rows={activityRows}
        />
      </section>

      {unlabeled.length ? (
        <section className="card" aria-label="Unlabeled workouts">
          <div className="card-heading">
            <h2 className="card-title">Unlabeled</h2>
            <span className="card-aside">What did you train?</span>
          </div>
          <ul className="training-unlabeled">
            {unlabeled.map((workout) => (
              <li key={workout.id}>
                <span>
                  <strong>{workout.name}</strong>
                  <small>
                    {formatDay(workout.day)} · {formatClock(workout.startedAt)}
                    {workout.activeMinutes != null ? ` · ${workout.activeMinutes} min` : ""}
                  </small>
                </span>
                <LabelButton
                  workoutId={workout.id}
                  date={workout.day}
                  prompt={`My ${workout.name.toLowerCase()} on ${formatDay(workout.day)} at ${formatClock(workout.startedAt)} was `}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" aria-label="Coverage">
        <h2 className="card-title">Strength coverage</h2>
        <CoverageGrid
          days={days.map((day) => ({ date: day, letter: weekdayLetter.format(new Date(`${day}T00:00:00Z`)) }))}
          rows={coverageRows}
        />
        <div className="coverage-legend" aria-hidden="true">
          <span>
            <i className="coverage-cell level-1" /> Easy
          </span>
          <span>
            <i className="coverage-cell level-2" /> Moderate
          </span>
          <span>
            <i className="coverage-cell level-3" /> Hard
          </span>
        </div>
      </section>

      <section className="group" aria-label="Recent workouts">
        <h2 className="card-title training-recent-title">Recent workouts</h2>
        {typeCounts.size > 1 || typeFilter ? (
          <nav className="type-filter" aria-label="Filter by type">
            <a href="/training" aria-current={typeFilter ? undefined : "true"}>
              All {recent.length}
            </a>
            {WORKOUT_TYPES.filter((type) => typeCounts.has(type)).map((type) => (
              <a key={type} href={`/training?type=${type}`} aria-current={typeFilter === type ? "true" : undefined}>
                {WORKOUT_TYPE_LABELS[type]} {typeCounts.get(type)}
              </a>
            ))}
          </nav>
        ) : null}
        {shown.length ? (
          shown.map((item) => (
            <article key={item.key} className="card training-workout">
              <div className="training-workout-head">
                <div>
                  <span className="training-workout-when">{item.when}</span>
                  <strong>{item.title}</strong>
                  {item.detail ? <span className="training-workout-detail">{item.detail}</span> : null}
                  {item.status ? <span className="training-workout-detail">{item.status}</span> : null}
                </div>
                {item.strain != null ? (
                  <div className="training-workout-strain">
                    <strong>{item.strain.toFixed(1)}</strong>
                    <span>strain</span>
                  </div>
                ) : null}
              </div>
              {item.chips.length || item.labelPrompt || item.session ? (
                <div className="training-workout-foot">
                  <div className="training-chips">
                    {item.chips.map((chip) => (
                      <span key={chip}>{chip}</span>
                    ))}
                  </div>
                  {item.labelPrompt && item.fitbitId ? <LabelButton prompt={item.labelPrompt} workoutId={item.fitbitId} date={item.date} /> : null}
                </div>
              ) : null}
              {item.fitbitId ? (
                <MergeControls id={item.fitbitId} mergedCount={item.mergedCount} overlaps={item.overlaps} />
              ) : null}
              {item.session ? (
                <WorkoutEditor
                  id={item.session.id}
                  name={item.session.name}
                  muscleGroups={item.session.muscleGroups}
                  rpe={item.session.rpe}
                />
              ) : null}
            </article>
          ))
        ) : (
          <p className="footnote">
            No {typeFilter ? `${WORKOUT_TYPE_LABELS[typeFilter].toLowerCase()} ` : ""}workouts in the last {WINDOW_DAYS} days.
          </p>
        )}
      </section>
    </AppShell>
  );
}
