// The last 7 days of training, shared by Training's "Last 7 days" card and
// Today's Strain panel so the two can't disagree.
import { addDays } from "./dates";
import {
  INTENSITIES,
  INTENSITY_RULES,
  STRENGTH_GROUPS,
  WORKOUT_TYPE_LABELS,
  groupOf,
  intensityOf,
  splitKinds,
  splitOf,
  workoutTypeOf,
  type FitbitWorkout,
  type Intensity,
  type SplitEntry,
  type WorkoutSession,
  type WorkoutType
} from "./workouts";

export type WeekItem = {
  date: string;
  sort: string; // local "YYYY-MM-DDTHH:MM", for ordering within a day
  title: string;
  minutes: number | null;
  workoutType: WorkoutType;
  session: WorkoutSession | null;
};

export type WeekRow = { date: string; day: string; items: { title: string; tag: string | null; hard: boolean }[] };

const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

// Every watch workout except ignored ones and unlabeled walks, plus logged
// sessions that aren't linked to one (pending or not on the watch).
export function weekItems(sessions: readonly WorkoutSession[], fitbit: readonly FitbitWorkout[]): WeekItem[] {
  const fitbitIds = new Set(fitbit.map((workout) => workout.id));
  const items: WeekItem[] = [];
  for (const workout of fitbit) {
    if (workout.ignored) continue;
    const session = workout.sessionId ? (sessions.find((item) => item.id === workout.sessionId) ?? null) : null;
    if (!session && workout.type === "WALKING") continue;
    items.push({
      date: workout.day,
      sort: workout.startedAt,
      title: session?.name ?? workout.name,
      minutes: workout.activeMinutes,
      workoutType: session?.workoutType ?? workoutTypeOf(workout.type),
      session
    });
  }
  for (const session of sessions) {
    if (session.healthRecordKey && fitbitIds.has(session.healthRecordKey)) continue;
    items.push({
      date: session.date,
      sort: `${session.date}T23:59`,
      title: session.name,
      minutes: session.durationMin,
      workoutType: session.workoutType,
      session
    });
  }
  return items.sort((a, b) => b.sort.localeCompare(a.sort));
}

// One row per day of the 7 ending `today`, oldest first: what was done, with
// how hard a lift was or what kind of workout it was. The last row is labeled
// `todayLabel`, or its weekday when null (a past day on Today).
export function lastWeekRows(items: readonly WeekItem[], today: string, todayLabel: string | null = "Today"): WeekRow[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const dayItems = items
      .filter((item) => item.date === date)
      .slice()
      .reverse()
      .map((item) => {
        const session = item.session;
        const strength = session?.muscleGroups.some((name) => STRENGTH_GROUPS.includes(groupOf(name)));
        let tag: string | null = WORKOUT_TYPE_LABELS[item.workoutType];
        let hard = false;
        if (session && strength) {
          const hardest = session.muscleGroups
            .map((name) => intensityOf(session, name))
            .reduce<Intensity>((most, value) => (INTENSITIES.indexOf(value) > INTENSITIES.indexOf(most) ? value : most), "light");
          tag = INTENSITY_RULES[hardest].label;
          hard = hardest === "hard";
        }
        return { title: `${item.title}${item.minutes != null ? ` · ${item.minutes} min` : ""}`, tag, hard };
      });
    return { date, day: date === today && todayLabel ? todayLabel : weekdayShort.format(new Date(`${date}T00:00:00Z`)), items: dayItems };
  });
}

// Strength, cardio and mobility sessions in the 7 days ending `today`, against
// their targets (sport has no target).
export function weekSplit(sessions: readonly WorkoutSession[], fitbit: readonly FitbitWorkout[], today: string): SplitEntry[] {
  return splitOf(splitKinds(sessions, fitbit, addDays(today, -6), today)).filter((entry) => entry.target != null);
}
