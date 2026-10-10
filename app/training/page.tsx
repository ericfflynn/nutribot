import { AppShell, Login } from "../shared-ui";
import { LabelButton, WorkoutEditor } from "../training-ui";
import { getSessionUser } from "@/lib/auth";
import { rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { listHealthWorkouts, type HealthWorkout } from "@/lib/health/queries";
import { workoutStrain } from "@/lib/health/scores";
import { getPool } from "@/lib/supabase";
import {
  CARDIO_FITBIT_TYPES,
  MUSCLE_GROUPS,
  lastTrainedByMuscle,
  listFitbitWorkouts,
  listUnlabeledWorkouts,
  listWorkoutSessions,
  type FitbitWorkout,
  type MuscleGroup,
  type WorkoutSession
} from "@/lib/workouts";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;
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

function joinNames(names: string[]) {
  const lower = names.map((name, index) => (index === 0 ? name : name.toLowerCase()));
  if (lower.length <= 1) return lower.join("");
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

// What to train next, from the groups that are missing.
function suggestion(missing: MuscleGroup[]) {
  const has = (group: MuscleGroup) => missing.includes(group);
  if (has("Back") || has("Biceps")) return "Next session could be a pull day.";
  if (has("Chest") || has("Shoulders") || has("Triceps")) return "Next session could be a push day.";
  if (has("Legs")) return "Next session could be a leg day.";
  if (has("Abs")) return "Add some core work to the next session.";
  if (has("Cardio")) return "A run or a ride would cover cardio.";
  return "";
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
  chips: MuscleGroup[];
  session: WorkoutSession | null;
  // Set when the Fitbit workout has nothing logged for it.
  labelPrompt: string | null;
  status: string | null;
};

export default async function TrainingPage() {
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

  const [sessions, fitbit, healthWorkouts, unlabeled, lastTrained] = await Promise.all([
    listWorkoutSessions(db, user.name, start, today),
    listFitbitWorkouts(db, user.name, start, today),
    listHealthWorkouts(user.name, start, today),
    listUnlabeledWorkouts(db, user.name, start, today),
    lastTrainedByMuscle(db, user.name, today)
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
  const sessionCounts = new Map<MuscleGroup, number>();
  for (const session of sessions) {
    for (const group of session.muscleGroups) {
      mark(session.date, group, session.rpe);
      sessionCounts.set(group, (sessionCounts.get(group) ?? 0) + 1);
    }
  }
  for (const workout of fitbit) {
    if (!workout.sessionId && CARDIO_FITBIT_TYPES.includes(workout.type)) {
      mark(workout.day, "Cardio", null);
      sessionCounts.set("Cardio", (sessionCounts.get("Cardio") ?? 0) + 1);
    }
  }

  const rows = MUSCLE_GROUPS.map((group) => {
    const last = lastTrained.get(group);
    const since = last ? daysBetween(last, today) : null;
    return { group, since, missing: since == null || since >= MISSING_AFTER_DAYS };
  });
  const missing = rows.filter((row) => row.missing);
  const longestGap = Math.max(...missing.map((row) => row.since ?? Infinity));
  const recentGroups = rows.filter((row) => !row.missing).sort((a, b) => (a.since ?? 0) - (b.since ?? 0));

  const maxCount = Math.max(1, ...sessionCounts.values());

  // Recent workouts: every Fitbit workout except unlabeled walks, plus sessions
  // that aren't linked to one (pending or untracked).
  const recent: RecentItem[] = [];
  for (const workout of fitbit) {
    const session = workout.sessionId ? (sessions.find((item) => item.id === workout.sessionId) ?? null) : null;
    if (!session && workout.type === "WALKING") continue;
    const health = healthById.get(workout.id);
    const strain = health ? workoutStrain(health) : null;
    const isCardio = CARDIO_FITBIT_TYPES.includes(workout.type);
    recent.push({
      key: workout.id,
      date: workout.day,
      sort: workout.startedAt,
      when: `${formatDay(workout.day)} · ${formatClock(workout.startedAt)}`,
      title: session?.name ?? workout.name,
      detail: [
        workout.activeMinutes != null ? `${workout.activeMinutes} min` : null,
        workout.avgHr != null ? `${workout.avgHr} bpm avg` : null,
        session?.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      strain,
      chips: session?.muscleGroups ?? (isCardio ? ["Cardio"] : []),
      session,
      labelPrompt: session
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
        session.durationMin != null ? `${session.durationMin} min` : null,
        session.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      strain: null,
      chips: session.muscleGroups,
      session,
      labelPrompt: null,
      status: session.matchStatus === "pending" ? "Waiting for the watch" : "Not on the watch"
    });
  }
  recent.sort((a, b) => b.sort.localeCompare(a.sort));

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

      {missing.length ? (
        <section className="card training-missing" aria-label="Missing">
          <span className="training-missing-label">Missing</span>
          <strong>
            {joinNames(missing.map((row) => row.group))}:{" "}
            {Number.isFinite(longestGap) ? `${longestGap} days` : "not logged yet"}
          </strong>
          <span className="training-missing-note">
            {recentGroups.length
              ? `${joinNames(recentGroups.slice(0, 3).map((row) => row.group))} trained ${
                  recentGroups[0].since === 0 ? "today" : `${recentGroups[0].since} days ago`
                }. `
              : ""}
            {suggestion(missing.map((row) => row.group))}
          </span>
        </section>
      ) : null}

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
                  prompt={`My ${workout.name.toLowerCase()} on ${formatDay(workout.day)} at ${formatClock(workout.startedAt)} was `}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" aria-label="Coverage">
        <h2 className="card-title">Coverage</h2>
        <div className="coverage">
          <span />
          <div className="coverage-cells">
            {days.map((day) => (
              <span key={day} className="coverage-dow">
                {weekdayLetter.format(new Date(`${day}T00:00:00Z`))}
              </span>
            ))}
          </div>
          <span className="coverage-since-head">since</span>
          {rows.map((row) => (
            <div className="coverage-row" key={row.group}>
              <span className={row.missing ? "coverage-name missing" : "coverage-name"}>{row.group}</span>
              <div className="coverage-cells">
                {days.map((day) => {
                  const key = `${day}|${row.group}`;
                  const level = coverage.has(key) ? intensityClass(coverage.get(key)) : "";
                  return <span key={day} className={`coverage-cell ${level}`} />;
                })}
              </div>
              <span className={row.missing ? "coverage-since missing" : "coverage-since"}>
                {row.since == null ? "–" : `${row.since}d`}
              </span>
            </div>
          ))}
        </div>
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

      <section className="card" aria-label="Sessions per muscle group">
        <div className="card-heading">
          <h2 className="card-title">Sessions</h2>
          <span className="card-aside">{WINDOW_DAYS} days</span>
        </div>
        {sessionCounts.size ? (
          <div className="training-volume">
            {MUSCLE_GROUPS.filter((group) => sessionCounts.has(group))
              .sort((a, b) => (sessionCounts.get(b) ?? 0) - (sessionCounts.get(a) ?? 0))
              .map((group) => {
                const count = sessionCounts.get(group) ?? 0;
                return (
                  <div key={group} className="training-volume-row">
                    <span>{group}</span>
                    <div className="training-volume-track">
                      <div style={{ width: `${(count / maxCount) * 100}%` }} />
                    </div>
                    <strong>{count}</strong>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="footnote">Nothing logged in the last {WINDOW_DAYS} days. Tell the chat what you trained.</p>
        )}
      </section>

      <section className="group" aria-label="Recent workouts">
        <h2 className="card-title training-recent-title">Recent workouts</h2>
        {recent.length ? (
          recent.map((item) => (
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
                  {item.labelPrompt ? <LabelButton prompt={item.labelPrompt} /> : null}
                </div>
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
          <p className="footnote">No workouts in the last {WINDOW_DAYS} days.</p>
        )}
      </section>
    </AppShell>
  );
}
