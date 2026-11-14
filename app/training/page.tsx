import { AppShell, Login } from "../shared-ui";
import { BodyMap, type MuscleView } from "../body-map";
import { WeekPages, LabelButton, MergeControls, RestoreButton, WorkoutEditor, type CoverageRow, type WeekPage } from "../training-ui";
import { NextUp, type NextUpPage, type NextUpTier } from "../next-up";
import { getSessionUser } from "@/lib/auth";
import { addDays, currentWeekToDate, localDateTime, todayLocalDate } from "@/lib/dates";
import { ZONES, getZoneBounds, zoneMinutes, type ZoneMinutes } from "@/lib/health/zones";
import { WorkoutZones, ZoneLadder } from "../zone-ladder";
import { listHealthWorkouts, type HealthWorkout } from "@/lib/health/queries";
import { getPool } from "@/lib/supabase";
import { listSoreness } from "@/lib/body-log";
import { getBodyState } from "@/lib/body-state/load";
import { getDailyCall, listDailyCalls, type DailyCall, type PlannedDay } from "@/lib/body-state/call";
import { ailmentAvoidOf, illnessStateOf } from "@/lib/body-state/build";
import { isPossibleDuplicate, type WorkoutRecord } from "@/lib/health/dedupe-rules";
import {
  ACTIVITY_LABELS,
  activityCategoriesOf,
  INTENSITIES,
  INTENSITY_RULES,
  bucketOf,
  fatigueLevel,
  WEEKLY_TARGET_POINTS,
  intensityOf,
  muscleWeekOf,
  splitOf,
  loadOf,
  trackedOf,
  TRACKED_MUSCLES,
  MUSCLES,
  STRENGTH_GROUPS,
  canLabel,
  splitKinds,
  suggestNext,
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABELS,
  describeMuscles,
  groupDayIntensity,
  musclesOf,
  listFitbitWorkouts,
  listWorkoutSessions,
  type FitbitWorkout,
  type Intensity,
  type MuscleGroup,
  type TrackedMuscle,
  type WorkoutSession,
  type WorkoutType,
  weekStartOf,
  workoutTypeOf
} from "@/lib/workouts";

export const dynamic = "force-dynamic";

// Next up pages back this many days of calls.
const PAST_CALL_DAYS = 7;
// Recent workouts lists this many days.
const WINDOW_DAYS = 14;
// The week grid pages back this many calendar weeks, as far as there's data.
const HISTORY_WEEKS = 8;
// The hour (local) after which an untrained day is over for planning: the
// owner's workouts have all started by 5 pm.
const PLAN_DAY_OVER_HOUR = 19;

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });


function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  if (!hours) return `${total} min`;
  return total % 60 ? `${hours} h ${total % 60} min` : `${hours} h`;
}
const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" });
const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });


// Next up's pills: the work by intensity, hardest first, then what's tacked on
// at the end.
function tiersOf(work: { muscle: string; intensity: Intensity }[], finish: string[], bloodFlow: string[] = []): NextUpTier[] {
  const tiers: NextUpTier[] = [...INTENSITIES]
    .reverse()
    .map((intensity) => ({
      label: INTENSITY_RULES[intensity].label,
      tone: intensity,
      muscles: work.filter((item) => item.intensity === intensity).map((item) => item.muscle)
    }))
    .filter((tier) => tier.muscles.length);
  if (bloodFlow.length) tiers.push({ label: "Flush", tone: "light", muscles: bloodFlow });
  if (finish.length) tiers.push({ label: "Finish", tone: "finish", muscles: finish });
  return tiers;
}

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

  const [sessions, fitbit, healthWorkouts, soreness, body, todayCall, zoneBounds, pastCalls] = await Promise.all([
    listWorkoutSessions(db, user.name, start, today),
    listFitbitWorkouts(db, user.name, start, today),
    listHealthWorkouts(user.name, start, today),
    listSoreness(db, user.name, addDays(today, -14), today),
    // Illness comes from the body state, so Next up agrees with Today.
    getBodyState(db, user.name, today),
    getDailyCall(db, user.name, today),
    getZoneBounds(user.name, today),
    // Next up pages back through the last week's calls.
    listDailyCalls(db, user.name, addDays(today, -PAST_CALL_DAYS), today)
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

  // Next up is for today, or tomorrow once today has a lift logged or the
  // day's training window is over.
  const loggedToday = sessions.some(
    (session) => session.date === today && activityCategoriesOf(session.workoutType, session.muscleGroups)[0] === "strength"
  );
  const nextDate = loggedToday || Number(localDateTime().slice(11, 13)) >= PLAN_DAY_OVER_HOUR ? addDays(today, 1) : today;
  // Readiness (recovery, drinks, strain run, food) is today's; tomorrow is
  // planned again in the morning with last night's data.
  const readiness = nextDate === today ? (body.physical.training.readiness ?? null) : null;
  // Open injuries and pain carry into tomorrow too: they last until they're over.
  const next = suggestNext(
    sessions,
    nextDate,
    soreness,
    undefined,
    illnessStateOf(body.physical.illness),
    readiness,
    ailmentAvoidOf(body.physical.ailments?.open ?? [])
  );
  // Today's plan is Claude's call (made each morning inside the same limits);
  // tomorrow, or before the call is made, it's the rules.
  const call = nextDate === today ? todayCall : null;
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
      title: session.name,
      detail: [
        WORKOUT_TYPE_LABELS[session.workoutType],
        session.durationMin != null ? `${session.durationMin} min` : null,
        session.rpe != null ? `RPE ${session.rpe}` : null
      ]
        .filter(Boolean)
        .join(" · "),
      zones: null,
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
  // Workouts by day, newest first (Nov 13, 2026: one list in place of Last 7
  // days, Unlabeled and Recent workouts). Days with nothing show as rest,
  // unless a type filter is on.
  const workoutDays = Array.from({ length: WINDOW_DAYS }, (_, index) => addDays(today, -index))
    .map((date) => ({
      date,
      label: date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : formatDay(date),
      items: shown.filter((item) => item.date === date)
    }))
    .filter((day) => !typeFilter || day.items.length);
  const thisWeekItems = recent.filter((item) => item.date >= weekStartOf(today));
  const thisWeekMinutes = thisWeekItems.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
  const workoutsSummary = thisWeekItems.length
    ? [`${thisWeekItems.length} this week`, thisWeekMinutes ? formatMinutes(thisWeekMinutes) : null].filter(Boolean).join(" · ")
    : null;

  // The week grid: one page per calendar week (Monday to Sunday), newest
  // first, back to the first week with a logged session. Strength groups are shaded by how much
  // of the group was worked (groupDayIntensity), their muscles by the hardest
  // each got. The points column is that week's volume, so on the newest page
  // it's the live 4-point target; a group shows its percent of that.
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
  const thisMonday = weekStartOf(today);
  for (let week = 0; week < HISTORY_WEEKS; week++) {
    const monday = addDays(thisMonday, -7 * week);
    const pageDays = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
    // This week's points run through today; past weeks through their Sunday.
    const end = week === 0 ? today : pageDays[6];
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
    weekPages.push({
      key: end,
      label: week === 0 ? "This week" : week === 1 ? "Last week" : `${week} weeks ago`,
      range: `${shortDay.format(new Date(`${pageDays[0]}T00:00:00Z`))} – ${shortDay.format(new Date(`${pageDays[6]}T00:00:00Z`))}`,
      days: pageDays.map((day) => ({ date: day, letter: weekdayLetter.format(new Date(`${day}T00:00:00Z`)) })),
      strength
    });
  }

  // The newest week's split: a tile per kind with a target, under Next up.
  const thisSplit = splitOf(splitKinds(sessions, fitbit, weekStartOf(today), today));

  // Next up's pages. The current one is Claude's call when there is one,
  // otherwise the rules' pick, with the notes that shaped it in the dropdown.
  // Before it, the last week's calls with what was done; after it, the days
  // today's call planned through Sunday.
  const ruleNotes = [next.illness?.note, next.readiness?.note, next.ailments?.note].filter((note): note is string => Boolean(note));
  const ruleWhy = (extra: string[] = []) => {
    const reasons = [...ruleNotes, ...extra];
    return reasons.length ? { note: null, reasons, ailments: [] } : null;
  };
  const dayLabel = (date: string) => (date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : formatDay(date));
  const callContent = (made: DailyCall) => ({
    headline: made.headline,
    summary: null,
    tiers: tiersOf(made.work, made.accessory),
    flags: made.revised ? [`Changed${made.madeAt.slice(0, 10) === today ? " today" : ""}: ${made.revised}`] : [],
    why: { note: made.note, reasons: made.reasons, ailments: made.ailments ?? [] }
  });
  // Today's call planned these days, each like a call of its own. After 7 pm
  // tomorrow's page is its planned day until its morning call is made.
  const plannedDays = (todayCall?.week ?? []).map((item, index) => ({ ...item, date: addDays(today, index + 1) }));
  // Only a fully planned day (headline and muscles) stands in for the rules'
  // pick; the first evening's text-only plans ride along as a flag.
  const plannedNextDay = plannedDays.find((item) => item.date === next.date);
  const plannedNext = plannedNextDay?.headline ? plannedNextDay : undefined;
  const plannedContent = (item: PlannedDay) => ({
    headline: item.headline ?? item.plan ?? "Planned",
    summary: "Planned by today's call. Each morning's call plans again from what actually happened.",
    tiers: tiersOf(item.work ?? [], item.accessory ?? []),
    flags: [],
    week: [],
    why: item.note ? { note: item.note, reasons: [], ailments: [] } : null
  });
  const weekRows = (week: PlannedDay[]) => week.map((item) => ({ day: item.day, plan: item.headline ?? item.plan ?? "" }));
  const current: NextUpPage = {
    key: `current-${next.date}`,
    kind: "current",
    label: `Next up · ${next.date === today ? "today" : "tomorrow"}`,
    done: null,
    ...(call
      ? { ...callContent(call), week: weekRows(call.week ?? []) }
      : plannedNext
        ? plannedContent(plannedNext)
        : next.pick
        ? {
            headline: next.pick.name,
            summary: null,
            tiers: tiersOf(next.pick.work, next.pick.accessory, next.pick.bloodFlow),
            flags: next.pick.heldBy ? [`Not hard: ${next.pick.heldBy.label.toLowerCase()}`] : [],
            week: [],
            why: ruleWhy(next.alternatives.length ? [`Or: ${next.alternatives.join(" · ")}`] : [])
          }
        : next.illness?.rest
          ? { headline: "Rest", summary: "Get better first. Tell the chat when you feel better.", tiers: [], flags: [], week: [], why: ruleWhy() }
          : next.readiness?.rest
            ? { headline: "Rest or active recovery", summary: "A walk, yoga or mobility.", tiers: [], flags: [], week: [], why: ruleWhy() }
            : {
                headline: "Rest or active recovery",
                summary: "Nothing's fresh and due yet. Light cardio, yoga or pilates fits.",
                tiers: [],
                flags: [],
                week: [],
                why: ruleWhy()
              })
  };
  if (!call && !plannedNext && plannedNextDay?.plan) current.flags = [`Planned this morning: ${plannedNextDay.plan}`, ...current.flags];
  const pastPages: NextUpPage[] = pastCalls
    .filter((item) => item.date < next.date)
    .map((item) => ({
      key: `past-${item.date}`,
      kind: "past",
      label: dayLabel(item.date),
      ...callContent(item.call),
      week: [],
      done: recent.filter((entry) => entry.date === item.date).map((entry) => entry.title)
    }));
  const plannedPages: NextUpPage[] = plannedDays
    .filter((item) => item.date > next.date)
    .map((item) => ({
      key: `planned-${item.date}`,
      kind: "planned",
      label: `${formatDay(item.date)} · planned`,
      done: null,
      ...plannedContent(item)
    }));
  const nextUpPages = [...pastPages, current, ...plannedPages];
  const nextUpSplit = thisSplit
    .filter((entry) => entry.target != null)
    .map((entry) => ({ kind: entry.kind, label: ACTIVITY_LABELS[entry.kind], count: entry.count, target: entry.target! }));

  return (
    <AppShell
      user={user}
      date={today}
      active="training"
      title="Training"
    >

      <NextUp pages={nextUpPages} start={pastPages.length} split={nextUpSplit} />

      <ZoneLadder week={zoneThisWeek} average={zoneAverage} bounds={zoneBounds} daysDone={zoneWeek.elapsedDays - 1} />

      <section className="card training-week-card" aria-label="Body map">
        <BodyMap muscles={muscleViews} />
      </section>

      <section className="card" aria-label="Week by week">
        <WeekPages pages={weekPages} />
      </section>

      <section className="group" aria-label="Workouts">
        <div className="training-workouts-head">
          <h2 className="card-title">Workouts</h2>
          {workoutsSummary ? <span>{workoutsSummary}</span> : null}
        </div>
        {typeCounts.size > 1 || typeFilter ? (
          <nav className="type-filter" aria-label="Filter by type">
            <a href="/training" aria-current={typeFilter ? undefined : "true"}>
              All
            </a>
            {WORKOUT_TYPES.filter((type) => typeCounts.has(type)).map((type) => (
              <a key={type} href={`/training?type=${type}`} aria-current={typeFilter === type ? "true" : undefined}>
                {WORKOUT_TYPE_LABELS[type]} {typeCounts.get(type)}
              </a>
            ))}
          </nav>
        ) : null}
        {workoutDays.length ? (
          workoutDays.map((day) => (
            <div key={day.date} className="training-recent-week">
              <h3 className="training-day-head">{day.label}</h3>
              {day.items.length ? null : <p className="training-day-rest">{day.date === today ? "Nothing yet" : "Rest"}</p>}
              {day.items.map((item) => (
                <article key={item.key} className="card training-workout">
                  <div className="training-workout-head">
                    <div>
                      <strong>{item.title}</strong>
                      {item.detail ? <span className="training-workout-detail">{item.detail}</span> : null}
                      {item.status ? <span className="training-workout-detail">{item.status}</span> : null}
                    </div>
                  </div>
                  {item.zones ? <WorkoutZones minutes={item.zones} /> : null}
                  {item.chips.length || item.labelPrompt ? (
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
