import { AppShell, Login } from "../shared-ui";
import { BodyMap, type MuscleView } from "../body-map";
import { WeekPages, LabelButton, MergeControls, RestoreButton, WorkoutEditor, type CoverageRow, type WeekPage } from "../training-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { listHealthWorkouts, type HealthWorkout } from "@/lib/health/queries";
import { workoutStrain } from "@/lib/health/scores";
import { getPool } from "@/lib/supabase";
import { listSoreness } from "@/lib/body-log";
import { isPossibleDuplicate, type WorkoutRecord } from "@/lib/health/dedupe-rules";
import {
  ACTIVITY_LABELS,
  INTENSITIES,
  INTENSITY_RULES,
  WEEKLY_TARGET_POINTS,
  weekStatus,
  intensityOf,
  muscleWeekOf,
  splitShort,
  splitOf,
  loadOf,
  trackedOf,
  TRACKED_MUSCLES,
  MUSCLES,
  STRENGTH_GROUPS,
  activityCategoriesOf,
  canLabel,
  recommendNext,
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABELS,
  describeMuscles,
  groupDayIntensity,
  musclesOf,
  lastTrainedByName,
  listFitbitWorkouts,
  listUnlabeledWorkouts,
  listWorkoutSessions,
  type FitbitWorkout,
  type Intensity,
  type MuscleGroup,
  type MuscleStatus,
  type TrackedMuscle,
  type WorkoutSession,
  type WorkoutType,
  workoutTypeOf
} from "@/lib/workouts";

export const dynamic = "force-dynamic";
// Room for the health sync that opening the app may run (autoSyncHealthAction).
export const maxDuration = 60;

// Recent workouts lists this many days.
const WINDOW_DAYS = 14;
// The week grid pages back this many rolling weeks, as far as there's data.
const HISTORY_WEEKS = 8;
// Unlabeled strength workouts worth asking about.
const UNLABELED_DAYS = 7;

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The Monday a date's week starts on.
function weekStartOf(date: string) {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  if (!hours) return `${total} min`;
  return total % 60 ? `${hours} h ${total % 60} min` : `${hours} h`;
}
const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" });
const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

function formatClock(localDateTime: string) {
  return clockFormat.format(new Date(`${localDateTime}:00Z`));
}


// Coverage cell shade: level-1 light, level-2 medium, level-3 hard.
function intensityClass(intensity: Intensity | undefined) {
  return intensity ? `level-${INTENSITIES.indexOf(intensity) + 1}` : "";
}

const harder = (a: Intensity | undefined, b: Intensity) =>
  a && INTENSITY_RULES[a].points >= INTENSITY_RULES[b].points ? a : b;

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

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ type?: string; ignored?: string }> }) {
  const { type: typeParam, ignored: ignoredParam } = await searchParams;
  const showIgnored = ignoredParam === "1";
  const typeFilter = (WORKOUT_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as WorkoutType) : null;
  const user = await getSessionUser();
  if (!user) {
    return <Login />;
  }

  const today = todayLocalDate();
  const start = addDays(today, -(HISTORY_WEEKS * 7 - 1));
  const recentStart = addDays(today, -(WINDOW_DAYS - 1));
  const db = getPool();
  if (!db) {
    return (
      <AppShell user={user} date={today} active="training" title="Training">
        <p className="footnote">Add DATABASE_URL to see your training.</p>
      </AppShell>
    );
  }

  const [sessions, fitbit, healthWorkouts, unlabeled, lastByName, soreness] = await Promise.all([
    listWorkoutSessions(db, user.name, start, today),
    listFitbitWorkouts(db, user.name, start, today),
    listHealthWorkouts(user.name, start, today),
    listUnlabeledWorkouts(db, user.name, addDays(today, -(UNLABELED_DAYS - 1)), today),
    lastTrainedByName(db, user.name, today),
    listSoreness(db, user.name, addDays(today, -6), today)
  ]);
  const healthById = new Map<string, HealthWorkout>(healthWorkouts.map((workout) => [workout.id, workout]));
  const fitbitById = new Map<string, FitbitWorkout>(fitbit.map((workout) => [workout.id, workout]));

  const nextUp = recommendNext(lastByName, sessions, today, soreness);
  // This week: every strength muscle as due, recovering or covered, on the
  // body map, with the due ones listed by how short they are.
  const week = weekStatus(sessions, today, soreness);
  const muscleViews: MuscleView[] = TRACKED_MUSCLES.map((muscle) => {
    const view = muscleWeekOf(sessions, soreness, muscle, today);
    return {
      muscle,
      bucket: view.bucket,
      points: view.points,
      readyIn: view.readyIn,
      fatigue: view.fatigue,
      sessions: view.hits.map((hit) => `${formatDay(hit.session.date)} · ${hit.session.name} · ${hit.intensity}, +${hit.points}`),
      sore: view.sore.map((report) => ({
        id: report.id,
        severity: report.severity,
        when: report.date === today ? "today" : formatDay(report.date),
        today: report.date === today
      }))
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
    const strain = health ? workoutStrain(health) : null;
    // Other watch workouts that overlap this one without being folded into it.
    const overlaps = fitbit
      .filter((other) => other.id !== workout.id && !other.ignored)
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
      chips: session ? describeMuscles(session.muscleGroups, session.muscleIntensity) : [],
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
      chips: describeMuscles(session.muscleGroups, session.muscleIntensity),
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
  for (const item of recent.filter((entry) => entry.date >= recentStart)) typeCounts.set(item.workoutType, (typeCounts.get(item.workoutType) ?? 0) + 1);
  const shown = (typeFilter ? recent.filter((item) => item.workoutType === typeFilter) : recent).filter(
    (item) => item.date >= recentStart
  );
  // Recent workouts by week (Monday to Sunday), newest first, with totals.
  const thisWeek = weekStartOf(today);
  const shownWeeks = [...new Set(shown.map((item) => weekStartOf(item.date)))].map((weekStart) => {
    const items = shown.filter((item) => weekStartOf(item.date) === weekStart);
    const minutes = items.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
    return {
      weekStart,
      label:
        weekStart === thisWeek
          ? "This week"
          : weekStart === addDays(thisWeek, -7)
            ? "Last week"
            : `Week of ${shortDay.format(new Date(`${weekStart}T00:00:00Z`))}`,
      summary: [`${items.length} workout${items.length === 1 ? "" : "s"}`, minutes ? formatMinutes(minutes) : null]
        .filter(Boolean)
        .join(" · "),
      items
    };
  });

  // The week grid: one page per rolling 7 days, newest first, back to the
  // first week with a logged session. Strength groups are shaded by how much
  // of the group was worked (groupDayIntensity), their muscles by the hardest
  // each got. The points column is that week's volume, so on the newest page
  // it's the live 4-point target; a group shows its percent of that. The split
  // under it counts the same list as Recent workouts (auto-detected walks left
  // out); the muscles can say more than the type (activityCategoriesOf).
  const kindsOf = (item: RecentItem) => activityCategoriesOf(item.workoutType, item.session?.muscleGroups);
  const muscleDays = new Map<string, Intensity>(); // "date|muscle"
  for (const session of sessions) {
    for (const name of session.muscleGroups) {
      for (const muscle of musclesOf(name)) {
        const key = `${session.date}|${muscle}`;
        muscleDays.set(key, harder(muscleDays.get(key), intensityOf(session, name)));
      }
    }
  }
  // Pages stop at the first logged session: earlier weeks would only have
  // unlabeled watch workouts, and every muscle at 0 points.
  const firstDate = sessions.map((session) => session.date).sort()[0] ?? today;
  const weekPages: WeekPage[] = [];
  for (let week = 0; week < HISTORY_WEEKS; week++) {
    const end = addDays(today, -7 * week);
    const pageDays = rollingDateWindow(end, 7);
    if (week > 0 && pageDays[6] < firstDate) break;
    const pointsOf = (muscle: TrackedMuscle) => loadOf(sessions, muscle, end).points;
    const pointsCell = (points: number) => ({ aside: `${points}/${WEEKLY_TARGET_POINTS}`, done: points >= WEEKLY_TARGET_POINTS });
    // A group's share of its target, 4 points per muscle, each muscle capped
    // at 4 so one muscle's extra can't cover for another: Shoulders at 8 of 12
    // points is 67%. Groups differ in size, so a percent compares better.
    const groupCell = (group: MuscleGroup) => {
      const muscles = trackedOf(group);
      const points = muscles.reduce((sum, muscle) => sum + Math.min(WEEKLY_TARGET_POINTS, pointsOf(muscle)), 0);
      const target = WEEKLY_TARGET_POINTS * muscles.length;
      return { aside: `${Math.round((points / target) * 100)}%`, done: points >= target };
    };
    const strength: CoverageRow[] = STRENGTH_GROUPS.map((group) => ({
      name: group,
      ...groupCell(group),
      levels: pageDays.map((day) =>
        intensityClass(groupDayIntensity(sessions.filter((session) => session.date === day), group))
      ),
      muscles: (MUSCLES[group] as readonly TrackedMuscle[]).map((muscle) => ({
        name: muscle,
        ...pointsCell(pointsOf(muscle)),
        levels: pageDays.map((day) => intensityClass(muscleDays.get(`${day}|${muscle}`))),
        muscles: []
      }))
    }));
    // The split: sessions of each kind that week against the targets.
    const split = splitOf(recent.filter((item) => pageDays.includes(item.date)).map(kindsOf));
    weekPages.push({
      key: end,
      label: week === 0 ? "Last 7 days" : week === 1 ? "Previous 7 days" : `${week} weeks earlier`,
      range: `${shortDay.format(new Date(`${pageDays[0]}T00:00:00Z`))} – ${shortDay.format(new Date(`${end}T00:00:00Z`))}`,
      days: pageDays.map((day) => ({ date: day, letter: weekdayLetter.format(new Date(`${day}T00:00:00Z`)) })),
      strength,
      split: split.map((entry) => ({ ...entry, label: ACTIVITY_LABELS[entry.kind] }))
    });
  }

  // The newest week's split, for the line under Next up.
  const thisSplit = splitOf(recent.filter((item) => item.date > addDays(today, -7)).map(kindsOf));
  const splitBehind = splitShort(thisSplit);

  return (
    <AppShell
      user={user}
      date={today}
      active="training"
      title="Training"
    >

      <section className="card training-week-card" aria-label="This week">
        <div className="training-next">
          <span className="training-missing-label">Next up</span>
          <strong>
            {nextUp.split
              ? `${nextUp.split}${nextUp.addCore ? " + core" : ""}`
              : nextUp.rest === "recovering"
                ? `Recover${nextUp.addCore ? ", or core" : ""}`
                : "You're covered"}
          </strong>
          <span className="training-missing-note">
            {nextUp.split
              ? nextUp.neglected
                  .map(
                    (item) =>
                      `${item.muscle} ${item.points}/${WEEKLY_TARGET_POINTS}${item.since == null ? ", not logged yet" : item.since >= 7 ? `, ${item.since} days` : ""}`
                  )
                  .join(" · ")
              : nextUp.rest === "recovering"
                ? "What's short this week is still recovering. A rest day, cardio or mobility fits."
                : "Every muscle has its weekly volume. A rest day, cardio or mobility fits."}
          </span>
        </div>
        <p className={splitBehind.length ? "training-split-line" : "training-split-line done"}>
          <span>Split</span>
          {splitBehind.length
            ? `${splitBehind.map((entry) => `${ACTIVITY_LABELS[entry.kind].toLowerCase()} ${entry.count}/${entry.target}`).join(", ")} this week`
            : `on track: ${thisSplit
                .filter((entry) => entry.count)
                .map((entry) => `${entry.count} ${ACTIVITY_LABELS[entry.kind].toLowerCase()}`)
                .join(", ")}`}
        </p>
        <BodyMap muscles={muscleViews} />
        {week.due.length ? (
          <div className="training-week-bucket due">
            <span className="training-week-label">
              Due <small>{week.due.length}</small>
            </span>
            <div className="training-week-chips">
              {week.due.map((item: MuscleStatus) => (
                <span key={item.muscle}>
                  {item.muscle}
                  <small>
                    {" "}
                    {item.points}/{WEEKLY_TARGET_POINTS}
                  </small>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <p className="training-week-note">
          {WEEKLY_TARGET_POINTS} points per muscle in any 7 days: light {INTENSITY_RULES.light.points}, medium{" "}
          {INTENSITY_RULES.medium.points}, hard {INTENSITY_RULES.hard.points}. Recovery: light 1 day, medium 2–3, hard 5–6.
        </p>
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
                  defaultType={workoutTypeOf(workout.type)}
                  prompt={`My ${workout.name.toLowerCase()} on ${formatDay(workout.day)} at ${formatClock(workout.startedAt)} was `}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" aria-label="Week by week">
        <WeekPages pages={weekPages} />
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
        {shownWeeks.length ? (
          shownWeeks.map((week) => (
            <div key={week.weekStart} className="training-recent-week">
              <h3 className="training-week-head">
                {week.label} <span>{week.summary}</span>
              </h3>
              {week.items.map((item) => (
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
                      {item.labelPrompt && item.fitbitId ? <LabelButton prompt={item.labelPrompt} workoutId={item.fitbitId} date={item.date} defaultType={item.workoutType} /> : null}
                    </div>
                  ) : null}
                  {item.fitbitId ? (
                    <MergeControls id={item.fitbitId} mergedCount={item.mergedCount} overlaps={item.overlaps} />
                  ) : null}
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
                </article>
              ))}
            </div>
          ))
        ) : (
          <p className="footnote">
            No {typeFilter ? `${WORKOUT_TYPE_LABELS[typeFilter].toLowerCase()} ` : ""}workouts in the last {WINDOW_DAYS} days.
          </p>
        )}
        {ignoredWorkouts.length ? (
          <p className="footnote training-ignored-toggle">
            {ignoredWorkouts.length} ignored watch workout{ignoredWorkouts.length === 1 ? "" : "s"} ·{" "}
            <a href={showIgnored ? "/training" : "/training?ignored=1#ignored"}>{showIgnored ? "Hide" : "Show"}</a>
          </p>
        ) : null}
        {showIgnored && ignoredWorkouts.length ? (
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
    </AppShell>
  );
}
