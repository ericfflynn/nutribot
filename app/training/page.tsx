import { AppShell, Login } from "../shared-ui";
import { BodyMap, type MuscleView } from "../body-map";
import { LabelButton, MergeControls, RestoreButton, WorkoutEditor } from "../training-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, currentWeekToDate, todayLocalDate } from "@/lib/dates";
import { ZONES, getZoneBounds, zoneGoalsOf, zoneMinutes, type ZoneMinutes } from "@/lib/health/zones";
import { WorkoutZones, ZoneLadder } from "../zone-ladder";
import { SwipeGallery } from "../swipe-gallery";
import { listHealthWorkouts, type HealthWorkout } from "@/lib/health/queries";
import { getPool, getUserGoals } from "@/lib/supabase";
import { listSoreness } from "@/lib/body-log";
import { getBodyState } from "@/lib/body-state/load";
import { isPossibleDuplicate, type WorkoutRecord } from "@/lib/health/dedupe-rules";
import {
  ACTIVITY_LABELS,
  INTENSITY_RULES,
  bucketOf,
  fatigueLevel,
  intensityOf,
  muscleWeekOf,
  splitOf,
  loadOf,
  TRACKED_MUSCLES,
  canLabel,
  splitKinds,
  WORKOUT_TYPE_LABELS,
  musclesOf,
  listFitbitWorkouts,
  listWorkoutSessions,
  type FitbitWorkout,
  type WorkoutSession,
  type WorkoutType,
  weekStartOf,
  workoutTypeOf
} from "@/lib/workouts";

export const dynamic = "force-dynamic";

// Missing this week lists muscles under this many points.
const MISSING_UNDER = 3;
// The timeline shows this many days back from today, whatever the week, and
// pages back by as many.
const LOOKBACK_DAYS = 7;
// The timeline goes back at most this many days.
const HISTORY_DAYS = 56;
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });


const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });


function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

function formatClock(localDateTime: string) {
  return clockFormat.format(new Date(`${localDateTime}:00Z`));
}


// A logged session's chips: each muscle with the points it added ("Quads +3"),
// a group logged whole as one chip per muscle in it, cardio and mobility plain.
function pointChips(session: WorkoutSession): string[] {
  const points = new Map<string, number>();
  const plain: string[] = [];
  for (const name of session.muscleGroups) {
    const muscles = musclesOf(name);
    if (!muscles.length) {
      plain.push(name);
      continue;
    }
    const value = INTENSITY_RULES[intensityOf(session, name)].points;
    for (const muscle of muscles) points.set(muscle, Math.max(points.get(muscle) ?? 0, value));
  }
  return [...[...points].map(([muscle, value]) => `${muscle} +${value}`), ...plain];
}

type RecentItem = {
  key: string;
  date: string;
  sort: string;
  title: string;
  detail: string;
  zones: ZoneMinutes | null;
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

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ ignored?: string; days?: string }> }) {
  const { ignored: ignoredParam, days: daysParam } = await searchParams;
  // How many days the timeline shows: 7, and 7 more per "Earlier".
  const lookbackDays =
    Math.min(HISTORY_DAYS, Math.max(LOOKBACK_DAYS, Math.ceil((Number(daysParam) || LOOKBACK_DAYS) / LOOKBACK_DAYS) * LOOKBACK_DAYS));
  const showIgnored = ignoredParam === "1";
  const user = await getSessionUser();
  if (!user) {
    return <Login />;
  }

  const today = todayLocalDate();
  const start = addDays(today, -(HISTORY_DAYS - 1));
  const db = getPool();
  if (!db) {
    return (
      <AppShell user={user} date={today} active="training" title="Training">
        <p className="footnote">Add DATABASE_URL to see your training.</p>
      </AppShell>
    );
  }

  const [sessions, fitbit, healthWorkouts, soreness, body, zoneBounds, goals] = await Promise.all([
    listWorkoutSessions(db, user.name, start, today),
    listFitbitWorkouts(db, user.name, start, today),
    listHealthWorkouts(user.name, start, today),
    listSoreness(db, user.name, addDays(today, -14), today),
    getBodyState(db, user.name, today),
    getZoneBounds(user.name, today),
    getUserGoals(user.name, db)
  ]);
  // Heart-rate zones: this calendar week's watch workouts so far, and the
  // average week over the 4 full weeks before, ignored recordings left out.
  const zoneWeek = currentWeekToDate(today);
  const ignoredWatch = new Set(fitbit.filter((workout) => workout.ignored).map((workout) => workout.id));
  const watchIn = (from: string, to: string) =>
    healthWorkouts.filter((workout) => workout.day >= from && workout.day <= to && !ignoredWatch.has(workout.id));
  const zoneThisWeek = zoneMinutes(watchIn(zoneWeek.startDate, today));
  const pastWeeks = [1, 2, 3, 4].map((ago) => zoneMinutes(watchIn(addDays(zoneWeek.startDate, -7 * ago), addDays(zoneWeek.startDate, -7 * ago + 6))));
  const zoneAverage = Object.fromEntries(
    ZONES.map((zone) => [zone.key, Math.round(pastWeeks.reduce((sum, week) => sum + week[zone.key], 0) / pastWeeks.length)])
  ) as ZoneMinutes;
  const healthById = new Map<string, HealthWorkout>(healthWorkouts.map((workout) => [workout.id, workout]));
  const fitbitById = new Map<string, FitbitWorkout>(fitbit.map((workout) => [workout.id, workout]));

  // The body map reads the body state (soreness, points, days to fresh, why
  // it's out, days since hit), so it agrees with Today and the chat. The owner's
  // own report for today (its id, to undo it) is the one thing the state doesn't keep.
  const stateOf = new Map(body.physical.training.muscles.map((item) => [item.muscle, item]));
  const muscleViews: MuscleView[] = TRACKED_MUSCLES.map((muscle) => {
    const view = muscleWeekOf(sessions, soreness, muscle, today);
    const state = stateOf.get(muscle);
    const load = state ? { points: state.points7, soreness: state.soreness, readyIn: state.readyIn } : view;
    return {
      muscle,
      bucket: bucketOf(load),
      points: load.points,
      readyIn: load.readyIn,
      fatigue: fatigueLevel(load.soreness),
      level: load.soreness,
      out: state?.out ?? null,
      recentHits: state?.recentHits ?? [],
      today: view.todayReport ? { id: view.todayReport.id, level: view.todayReport.level } : null
    };
  });

  // Recent workouts: every Fitbit workout except unlabeled walks, plus sessions
  // that aren't linked to one (pending or untracked).
  const recent: RecentItem[] = [];
  // Ignored watch workouts stay out of everything below; "Show" lists them.
  const ignoredWorkouts = fitbit.filter((workout) => workout.ignored);
  for (const workout of fitbit) {
    if (workout.ignored) continue;
    const session = workout.sessionId ? (sessions.find((item) => item.id === workout.sessionId) ?? null) : null;
    if (!session && workout.type === "WALKING") continue;
    const health = healthById.get(workout.id);
    // Other watch workouts that overlap this one without being folded into it.
    const overlaps = fitbit
      .filter((other) => other.id !== workout.id && !other.ignored)
      .filter((other) => isPossibleDuplicate(asRecord(workout), asRecord(other)))
      .map((other) => ({ id: other.id, label: `${other.name.toLowerCase()} at ${formatClock(other.startedAt)}` }));
    recent.push({
      key: workout.id,
      date: workout.day,
      sort: workout.startedAt,
      title: session?.name ?? workout.name,
      detail: [
        formatClock(workout.startedAt),
        session ? WORKOUT_TYPE_LABELS[session.workoutType] : null,
        workout.activeMinutes != null ? `${workout.activeMinutes} min` : null,
        workout.avgHr != null ? `${workout.avgHr} bpm avg` : null,
        session?.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      zones: health ? zoneMinutes([health]) : null,
      chips: session ? pointChips(session) : [],
      minutes: workout.activeMinutes,
      workoutType: session?.workoutType ?? workoutTypeOf(workout.type),
      session,
      fitbitId: workout.id,
      mergedCount: workout.mergedIds.length,
      overlaps,
      labelPrompt: session || !canLabel(workout.type)
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
      title: session.name,
      detail: [
        WORKOUT_TYPE_LABELS[session.workoutType],
        session.durationMin != null ? `${session.durationMin} min` : null,
        session.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      zones: null,
      chips: pointChips(session),
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
  // The timeline (Nov 22, 2026: one list in place of Last 7 days and the
  // calendar-week Workouts list): a rolling look back for planning, one row
  // per day, newest first, each workout's title and the points it added.
  // Tapping a workout opens its card (watch match, zones, edit). "Earlier"
  // adds 7 days, back to the first logged session.
  const lookback = Array.from({ length: lookbackDays }, (_, index) => addDays(today, -index)).map((date) => ({
    date,
    label: date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : formatDay(date),
    items: recent.filter((item) => item.date === date)
  }));
  const firstDate = sessions.map((session) => session.date).sort()[0] ?? today;
  const oldestShown = addDays(today, -(lookbackDays - 1));
  const earlierHref = lookbackDays < HISTORY_DAYS && oldestShown > firstDate ? `/training?days=${lookbackDays + LOOKBACK_DAYS}#day-${addDays(oldestShown, -1)}` : null;
  const lookbackTitle = lookbackDays === LOOKBACK_DAYS ? "Last 7 days" : `Last ${lookbackDays} days`;

  // Missing this week: muscles under 3 points this calendar week (3 is a hit,
  // 4 the goal; the owner, Nov 22, 2026), fewest first, with the points to 3.
  const missing = TRACKED_MUSCLES.map((muscle) => ({ muscle, points: loadOf(sessions, muscle, today).points }))
    .filter((item) => item.points < MISSING_UNDER)
    .sort((a, b) => a.points - b.points || TRACKED_MUSCLES.indexOf(a.muscle) - TRACKED_MUSCLES.indexOf(b.muscle));

  // This week's split: a tile per kind with a target, at the top of the tab
  // whatever else is there (Nov 22, 2026: Next up is gone from Training).
  const split = splitOf(splitKinds(sessions, fitbit, weekStartOf(today), today))
    .filter((entry) => entry.target != null)
    .map((entry) => ({ kind: entry.kind, label: ACTIVITY_LABELS[entry.kind], count: entry.count, target: entry.target! }));

  return (
    <AppShell
      user={user}
      date={today}
      active="training"
      title="Training"
    >

      <section className="card training-split" aria-label="This week since Monday">
        {split.map((entry) => (
          <div key={entry.kind}>
            <strong className={entry.count < entry.target ? "short" : undefined}>
              {entry.count}/{entry.target}
            </strong>
            <span>{entry.label}</span>
          </div>
        ))}
      </section>

      <SwipeGallery labels={["Zones", "Body"]}>
        <ZoneLadder week={zoneThisWeek} average={zoneAverage} bounds={zoneBounds} daysDone={zoneWeek.elapsedDays - 1} goals={zoneGoalsOf(goals)} />
        <section className="card training-week-card" aria-label="Body map">
          <BodyMap muscles={muscleViews} />
        </section>
      </SwipeGallery>

      <section className="card training-missing-block" aria-label="Missing this week">
        <div className="card-heading">
          <h2 className="card-title">Missing this week</h2>
          <span className="card-aside">{missing.length ? "points to go" : null}</span>
        </div>
        {missing.length ? (
          <>
            <div className="missing-pills">
              {missing.map((item) => (
                <span key={item.muscle} className={item.points === 0 ? "untouched" : undefined}>
                  {item.muscle} <strong>{MISSING_UNDER - item.points}</strong>
                </span>
              ))}
            </div>
            <p className="footnote">Under 3 points so far; red is not worked yet. Light 1, medium 2, hard 3; 4 is the goal.</p>
          </>
        ) : (
          <p className="footnote">Every muscle has 3 points or more this week.</p>
        )}
      </section>

      <section className="card training-lookback" aria-label={lookbackTitle} id="workouts">
        <div className="card-heading">
          <h2 className="card-title">{lookbackTitle}</h2>
          <span className="card-aside">Tap a workout to edit</span>
        </div>
        <ol>
          {lookback.map((day) => (
            <li key={day.date} id={`day-${day.date}`}>
              <span className="training-lookback-day">{day.label}</span>
              <div>
                {day.items.length ? (
                  day.items.map((item) => (
                    <details key={item.key} className="training-lookback-item">
                      <summary>
                        <strong>
                          {item.title}
                          {item.labelPrompt ? <em className="training-lookback-tag">Label</em> : null}
                        </strong>
                        {item.chips.length ? <span>{item.chips.join(" · ")}</span> : null}
                        {item.status ? <span>{item.status}</span> : null}
                      </summary>
                      <div className="training-lookback-body">
                        {item.detail ? <span className="training-workout-detail">{item.detail}</span> : null}
                        {item.zones ? <WorkoutZones minutes={item.zones} /> : null}
                        {item.labelPrompt && item.fitbitId ? (
                          <div className="training-workout-foot">
                            <LabelButton prompt={item.labelPrompt} workoutId={item.fitbitId} date={item.date} defaultType={item.workoutType} />
                          </div>
                        ) : null}
                        {item.fitbitId ? <MergeControls id={item.fitbitId} mergedCount={item.mergedCount} overlaps={item.overlaps} /> : null}
                        {item.session ? (
                          <WorkoutEditor
                            id={item.session.id}
                            name={item.session.name}
                            workoutType={item.session.workoutType}
                            muscleGroups={item.session.muscleGroups}
                            muscleIntensity={item.session.muscleIntensity}
                            rpe={item.session.rpe}
                          />
                        ) : null}
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="rest">{day.date === today ? "Nothing yet" : "Rest"}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {earlierHref ? (
          <a className="training-lookback-more" href={earlierHref}>
            Earlier
          </a>
        ) : null}
      </section>

      {ignoredWorkouts.length ? (
        <section className="group" aria-label="Ignored watch workouts">
          <p className="footnote training-ignored-toggle">
            {ignoredWorkouts.length} ignored watch workout{ignoredWorkouts.length === 1 ? "" : "s"} ·{" "}
            <a href={showIgnored ? "/training" : "/training?ignored=1#ignored"}>{showIgnored ? "Hide" : "Show"}</a>
          </p>
          {showIgnored ? (
            <ul className="card training-unlabeled" id="ignored">
              {ignoredWorkouts.map((workout) => (
                <li key={workout.id}>
                  <span>
                    <strong>{workout.name}</strong>
                    <small>
                      {formatDay(workout.day)} · {formatClock(workout.startedAt)}
                      {workout.activeMinutes != null ? ` · ${workout.activeMinutes} min` : ""}
                    </small>
                  </span>
                  <RestoreButton workoutId={workout.id} date={workout.day} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
