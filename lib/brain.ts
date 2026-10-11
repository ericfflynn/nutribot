// The chat brain: one user message in, a reply plus drafts (meals, workouts,
// journal entries, habits) out.
// Contract and rationale: docs/brain.md. Tools only create drafts; nothing is
// saved until the owner taps Save (app/actions.ts → saveDraftAction).
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { CHECKIN_PROMPT, CHECKIN_TOOLS, checkinTools, type CheckinDraft } from "./brain-checkin";
import { runClaude } from "./claude-brain";
import { addDays, isValidLocalDate, localDateTime } from "./dates";
import { HEALTH_DATA_TYPES } from "./health/google";
import { runHealthSync } from "./health/sync";
import { normalizeGeneratedMacroEstimate, type ParsedMacros } from "./macros";
import { gramsFromPercentGoals } from "./goals";
import {
  getMacroEntry,
  getUserGoals,
  getWaterOunces,
  searchMacroEntries,
  summarizeEntries,
  type MacroEntry,
  type MealType
} from "./supabase";
import {
  MUSCLE_GROUPS,
  WORKOUT_TYPES,
  chooseMatch,
  listFitbitWorkouts,
  listWorkoutSessions,
  type FitbitWorkout,
  type MatchResult,
  type MuscleGroup,
  type TimeHint,
  type WorkoutSession,
  type WorkoutType
} from "./workouts";

// The saved meal an edit draft corrects, as it was when the draft was made.
export type MealEditTarget = {
  id: string;
  date: string;
  meal_type: MealType | null;
  calories: number;
};

export type MealDraft = {
  type: "meal";
  id: string;
  date: string;
  raw_text: string;
  meal_type: MealType;
  estimate: ParsedMacros;
  // Set when saving overwrites an existing meal instead of adding one.
  edits?: MealEditTarget | null;
  saved_id: string | null;
  discarded?: boolean;
};

export type WorkoutDraft = {
  type: "workout";
  id: string;
  date: string;
  raw_text: string;
  name: string;
  workout_type: WorkoutType;
  muscle_groups: MuscleGroup[];
  rpe: number | null;
  duration_min: number | null;
  time_hint: TimeHint | null;
  untracked: boolean;
  notes: string;
  questions: string[];
  match: MatchResult;
  // "user" when the owner or their message picked the Fitbit workout.
  linked_by: "auto" | "user" | null;
  saved_id: string | null;
  discarded?: boolean;
};

export type Draft = MealDraft | WorkoutDraft | CheckinDraft;

export type Turn = { role: "user" | "assistant"; text: string };

export type BrainReply = {
  reply: string;
  drafts: Draft[];
  meta: { model: string; durationMs: number; turns: number };
};

export type BrainContext = {
  db: Pool;
  userName: string;
  // The day the owner is looking at; the default date for drafts.
  viewDate: string;
  history: Turn[];
  // Unsaved drafts still on screen, so "make that 2 eggs" can revise one.
  openDrafts: Draft[];
  // Run a quick exercise-only health sync when today's workout isn't in yet.
  syncIfMissing: boolean;
  now?: Date;
};

const SERVER = "nutribot";
const TOOLS = ["draft_meal", "draft_workout", "list_workouts", "list_meals", "get_goals", ...CHECKIN_TOOLS];

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD.");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const mealItem = z.object({
  name: z.string(),
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  assumption: z.string().describe("Portion assumption for this item.")
});

function describeWorkout(w: FitbitWorkout) {
  const minutes = w.activeMinutes != null ? `, ${w.activeMinutes} min` : "";
  const hr = w.avgHr != null ? `, avg HR ${w.avgHr}` : "";
  return `${w.name} ${w.startedAt.slice(11)}–${w.endedAt.slice(11)}${minutes}${hr} (id ${w.id})`;
}

function describeSession(s: WorkoutSession) {
  const rpe = s.rpe != null ? `, RPE ${s.rpe}` : "";
  const groups = s.muscleGroups.length ? ` [${s.muscleGroups.join(", ")}]` : "";
  return `logged as "${s.name}"${groups}${rpe}`;
}

const clockFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: process.env.APP_TIME_ZONE || "America/New_York"
});

// One saved meal for list_meals: when, type, totals, then each item with its portion.
function describeMeal(entry: MacroEntry) {
  const logged = new Date(entry.created_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  const at = Number.isNaN(logged.getTime()) ? "" : ` logged ${localDateTime(logged).slice(0, 10)} ${clockFormat.format(logged)}`;
  const macros = (m: { calories: number; protein_g: number; carbs_g: number; fat_g: number }) =>
    `${m.calories} cal, ${m.protein_g}P/${m.carbs_g}C/${m.fat_g}F`;
  const items = entry.items
    .map((item) => `  - ${item.name}: ${macros(item)}${item.assumption ? ` (${item.assumption})` : ""}`)
    .join("\n");
  return `${entry.entry_date} ${entry.meal_type ?? "untyped"} (id ${entry.id}${at}): "${entry.raw_text}" = ${macros(entry)}${items ? `\n${items}` : ""}`;
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function errorText(message: string) {
  return { ...text(message), isError: true };
}

function systemPrompt(today: string, nowLocal: string, viewDate: string) {
  return `You are NutriBot, a private health assistant for one person. You log meals and workouts from what they write, and you chat about food, training and recovery.

Today is ${today}; local time is ${nowLocal.slice(11)}. The person is looking at ${viewDate}, which is the default date for anything they log. Resolve "yesterday", "Tuesday", "last week" against today.

## Logging
- Call draft_meal once per meal and draft_workout once per separate activity. "Back and bis, then a 20 min run" is two workouts, because the watch records two.
- A draft is a review card, not a saved record. Never say "logged" or "saved". Say the draft is ready to review, and mention anything worth checking.
- To change an open draft, call the same tool again with replaces set to its id.
- A message can hold several meals and workouts, or none. Plain questions get a plain answer and no drafts.

## Meals
- Estimate each food item separately. The app sums the totals.
- Use reasonable portions when quantities are missing, and state the portion in the item's assumption.
- notes holds a concrete assumption only when it matters ("Assumed 4 oz chicken"). Never write generic caveats like "values may vary".
- If confidence is below 0.75, accuracy_suggestion asks for the single most useful missing detail (portion, brand, cooking fat, weight, count). Otherwise it's empty.
- meal_type comes from the foods and when they were eaten: breakfast, lunch, dinner, snack or dessert. Dessert is a sweet treat, usually after a meal (brownie, ice cream, cake); use it whenever they call something dessert.
- They eat many of the same meals. Before drafting a meal, call list_meals with search set to its main food or place in a word or two ("smoothie", "buttermilks", "overnight oats"), over the last 90 days, unless it's plainly a one-off. When a past entry is the same meal, reuse its items, portions and macros, adjusted for anything they say is different, and mention which day you matched ("same as your Oct 3 smoothie"). Prefer their most recent version.
- list_meals also answers questions about what they ate on a day or over a week.
- get_goals gives their daily targets and a day's progress. Use it for "how much do I have left", whether a meal fits, or what to eat to hit protein. Goals are changed in the Goals panel on Today, not here.

## Fixing saved meals
- To correct a meal that's already saved (wrong type, portion, day, macros, or a missing item), find it with list_meals, then call draft_meal with edits set to its id and the whole corrected meal: keep its items as they are unless the fix changes them. Leave date out to keep its day.
- An edit draft replaces the saved meal only when they tap Update. Say what changes ("snack to dessert, calories stay 390").
- If they ask to fix something without saying which meal and more than one fits, ask which.

## Workouts
- Muscle groups are only: ${MUSCLE_GROUPS.join(", ")}. "tris" is Triceps, "bis" Biceps; quads, hamstrings, glutes and calves are Legs; lats and traps are Back; delts are Shoulders; core is Abs. A named exercise counts for the groups it mainly trains (bench press: Chest, Triceps). Push, pull and legs days are Chest/Shoulders/Triceps, Back/Biceps and Legs. Runs, rides and walks are Cardio.
- workout_type: strength for lifting, run, walk, ride, sport (tennis, golf), class (pilates, yoga, aerobics), or other.
- rpe converts intensity words: easy or light 3-4, moderate or solid 6, hard 8, brutal or all-out 9-10. Use a number they give as is. With no sense of intensity, rpe is null and you ask how hard it was. That is the only question to ask about a workout; never ask for exercises, sets or duration.
- The watch records most workouts, and the app matches each draft to the right one. Help it with time_hint when they say when: morning 05:00-12:00, afternoon 12:00-17:00, evening or after work 17:00-22:00, or a specific time ±1 hour. Leave time_hint null for "just now" or no time.
- untracked is true only when they say they didn't wear the watch. Only then is duration_min filled, and only if they state it.
- For past days, or when they describe a workout by its time or type, call list_workouts and pass fitbit_workout_id when their description clearly points to one workout.
- list_workouts also shows what each workout was logged as (name, muscle groups, RPE). Use it when they ask about recent training or what to train next.
- The tool result says which watch workout was matched. Mention it briefly ("matched to your 6:12 PM weightlifting, 49 min"), or say it will link when the watch syncs.

${CHECKIN_PROMPT}

## Everything else
- Answer general questions directly and briefly. You can see their saved meals, workouts, goals, water, journal and habits, but not yet their health metrics (sleep, recovery, heart rate); say so if asked.
- Write plain text in short sentences: no markdown, bullets, bold or headings. A blank line between topics is fine.`;
}

function promptFor(message: string, history: Turn[], openDrafts: Draft[]) {
  const parts: string[] = [];
  if (history.length) {
    parts.push(
      `<history>\n${history.map((turn) => `${turn.role === "user" ? "Them" : "You"}: ${turn.text}`).join("\n")}\n</history>`
    );
  }
  if (openDrafts.length) {
    const summary = openDrafts.map((draft) =>
      draft.type === "journal" || draft.type === "habits" || draft.type === "habit"
        ? draft
        : draft.type === "meal"
        ? {
            id: draft.id,
            type: "meal",
            date: draft.date,
            raw_text: draft.raw_text,
            meal_type: draft.meal_type,
            items: draft.estimate.items,
            edits: draft.edits?.id ?? null
          }
        : {
            id: draft.id,
            type: "workout",
            date: draft.date,
            raw_text: draft.raw_text,
            name: draft.name,
            muscle_groups: draft.muscle_groups,
            rpe: draft.rpe,
            fitbit: draft.match.match ? describeWorkout(draft.match.match) : null
          }
    );
    parts.push(`<open_drafts>\n${JSON.stringify(summary)}\n</open_drafts>`);
  }
  parts.push(`<message>\n${message}\n</message>`);
  return parts.join("\n\n");
}

export async function runBrain(message: string, context: BrainContext): Promise<BrainReply> {
  const now = context.now ?? new Date();
  const nowLocal = localDateTime(now);
  const today = nowLocal.slice(0, 10);
  const { db, userName } = context;

  // Drafts this reply produced, keyed by id so a revision replaces in place.
  const drafts = new Map<string, Draft>();
  const openById = new Map(context.openDrafts.map((draft) => [draft.id, draft]));
  let synced = false;

  function resolveDraftId(replaces: string | undefined): { id: string; previous?: Draft } | { error: string } {
    if (!replaces) return { id: randomUUID() };
    const previous = drafts.get(replaces) ?? openById.get(replaces);
    if (!previous) return { error: `No open draft with id ${replaces}.` };
    if (previous.saved_id) {
      return {
        error:
          previous.type === "meal"
            ? `That draft is already saved as meal ${previous.saved_id}. Call draft_meal with edits set to that id instead.`
            : previous.type === "workout"
              ? "That workout is already saved; it can be edited on the Training page."
              : "That draft is already saved. Make a new draft, or delete the saved one on Today."
      };
    }
    return { id: replaces, previous };
  }

  function checkDate(date: string | undefined) {
    const value = date ?? context.viewDate;
    if (!isValidLocalDate(value)) return { error: `Invalid date ${value}.` };
    if (value > today) return { error: "Can't log a future date." };
    return { date: value };
  }

  // Fitbit workouts already claimed by other open drafts in this conversation.
  function claimedIds(exceptId: string) {
    return [...openById.values(), ...drafts.values()]
      .filter((draft): draft is WorkoutDraft => draft.type === "workout" && draft.id !== exceptId && !draft.saved_id)
      .map((draft) => draft.match.match?.id)
      .filter((id): id is string => Boolean(id));
  }

  const draftMeal = tool(
    "draft_meal",
    "Create or revise a meal draft for review. One call per meal.",
    {
      date: localDate.optional(),
      raw_text: z.string().describe("The person's words for this meal."),
      meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "dessert"]),
      items: z.array(mealItem).min(1),
      confidence: z.number().min(0).max(1),
      notes: z.string(),
      accuracy_suggestion: z.string(),
      replaces: z.string().optional().describe("Id of an open draft this revises."),
      edits: z.string().optional().describe("Id of a saved meal (from list_meals) this draft corrects.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error!);

      // A revision of an edit draft keeps correcting the same saved meal.
      const previousEdit = target.previous?.type === "meal" ? target.previous.edits : null;
      const editId = args.edits ?? previousEdit?.id;
      let edits: MealEditTarget | null = null;
      if (editId) {
        if (previousEdit?.id === editId) {
          edits = previousEdit;
        } else {
          const entry = await getMacroEntry(db, userName, editId);
          if (!entry) return errorText(`No saved meal with id ${editId}. Find it with list_meals.`);
          edits = { id: entry.id, date: entry.entry_date, meal_type: entry.meal_type, calories: entry.calories };
        }
      }
      // An edit stays on the saved meal's day unless it says otherwise.
      const day = checkDate(args.date ?? (edits ? (target.previous?.type === "meal" ? target.previous.date : edits.date) : undefined));
      if ("error" in day) return errorText(day.error!);

      const estimate = normalizeGeneratedMacroEstimate({
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        items: args.items,
        confidence: args.confidence,
        notes: args.notes,
        accuracy_suggestion: args.accuracy_suggestion
      });
      drafts.set(target.id!, {
        type: "meal",
        id: target.id!,
        date: day.date!,
        raw_text: args.raw_text,
        meal_type: args.meal_type,
        estimate,
        edits,
        saved_id: null
      });
      return text({
        draft_id: target.id,
        date: day.date,
        ...(edits ? { corrects: `saved meal ${edits.id} (${edits.date} ${edits.meal_type ?? "untyped"}, ${edits.calories} cal)` } : {}),
        totals: { calories: estimate.calories, protein_g: estimate.protein_g, carbs_g: estimate.carbs_g, fat_g: estimate.fat_g }
      });
    }
  );

  const draftWorkout = tool(
    "draft_workout",
    "Create or revise a workout draft for review, matched to the watch's workout. One call per activity.",
    {
      date: localDate.optional(),
      raw_text: z.string().describe("The person's words for this activity."),
      name: z.string().describe('Short session name, e.g. "Chest + Triceps".'),
      workout_type: z.enum(WORKOUT_TYPES),
      muscle_groups: z.array(z.enum(MUSCLE_GROUPS)).min(1),
      rpe: z.number().min(1).max(10).nullable(),
      duration_min: z.number().int().positive().nullable().describe("Only for untracked workouts with a stated duration."),
      time_hint: z.object({ start: hhmm, end: hhmm }).nullable().describe("Local window when it happened, if stated."),
      untracked: z.boolean().describe("True only if they didn't wear the watch."),
      fitbit_workout_id: z.string().nullable().describe("A specific watch workout from list_workouts."),
      notes: z.string(),
      questions: z.array(z.string()).describe("Only how hard it was, when rpe is null."),
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error!);
      const day = checkDate(args.date);
      if ("error" in day) return errorText(day.error!);
      const date = day.date!;

      let match: MatchResult = { status: "none", match: null, alternatives: [] };
      let linkedBy: WorkoutDraft["linked_by"] = null;
      if (!args.untracked) {
        let workouts = await listFitbitWorkouts(db, userName, date, date);
        const query = {
          date,
          workoutType: args.workout_type,
          timeHint: args.time_hint,
          loggedAt: nowLocal,
          exclude: claimedIds(target.id!)
        };
        match = chooseMatch(query, workouts);
        if (match.status === "none" && date === today && context.syncIfMissing && !synced) {
          synced = true;
          await runHealthSync(db, {
            trigger: "manual",
            userName,
            types: HEALTH_DATA_TYPES.filter((type) => type === "exercise"),
            recentDays: 1
          });
          workouts = await listFitbitWorkouts(db, userName, date, date);
          match = chooseMatch(query, workouts);
        }
        if (args.fitbit_workout_id) {
          const chosen = workouts.find((w) => w.id === args.fitbit_workout_id);
          if (!chosen) return errorText(`No watch workout ${args.fitbit_workout_id} on ${date}.`);
          if (chosen.sessionId) return errorText("That watch workout is already labeled.");
          match = { status: "matched", match: chosen, alternatives: workouts.filter((w) => w.id !== chosen.id && !w.sessionId) };
          linkedBy = "user";
        } else if (match.match) {
          linkedBy = "auto";
        }
      }

      drafts.set(target.id!, {
        type: "workout",
        id: target.id!,
        date,
        raw_text: args.raw_text,
        name: args.name,
        workout_type: args.workout_type,
        muscle_groups: args.muscle_groups,
        rpe: args.rpe,
        duration_min: args.untracked ? args.duration_min : null,
        time_hint: args.time_hint,
        untracked: args.untracked,
        notes: args.notes,
        questions: args.questions,
        match,
        linked_by: linkedBy,
        saved_id: null
      });
      return text({
        draft_id: target.id,
        date,
        watch: args.untracked
          ? "untracked"
          : match.match
            ? `${match.status === "ambiguous" ? "best guess" : "matched"}: ${describeWorkout(match.match)}`
            : "no watch workout yet; it will link when the watch syncs",
        other_candidates: match.alternatives.length
      });
    }
  );

  const listWorkouts = tool(
    "list_workouts",
    "List workouts in a date range (at most 31 days), newest first: each watch workout with what it was logged as, if anything, plus logged workouts with no watch workout.",
    {
      start_date: localDate,
      end_date: localDate,
      unlabeled_only: z.boolean().describe("Only watch workouts nothing has been logged for.")
    },
    async (args) => {
      if (args.start_date > args.end_date || addDays(args.start_date, 31) < args.end_date) {
        return errorText("Use a range of at most 31 days, start before end.");
      }
      const [workouts, sessions] = await Promise.all([
        listFitbitWorkouts(db, userName, args.start_date, args.end_date),
        args.unlabeled_only ? [] : listWorkoutSessions(db, userName, args.start_date, args.end_date)
      ]);
      const sessionById = new Map(sessions.map((s) => [s.id, s]));
      const rows = workouts
        .filter((w) => !args.unlabeled_only || !w.sessionId)
        .map((w) => {
          const session = w.sessionId ? sessionById.get(w.sessionId) : undefined;
          return { day: w.day, line: `${w.day} ${describeWorkout(w)}${session ? `, ${describeSession(session)}` : ", not logged"}` };
        });
      // Logged sessions with no watch workout yet, or none at all.
      for (const s of sessions) {
        if (s.matchStatus === "linked") continue;
        const minutes = s.durationMin != null ? `, ${s.durationMin} min` : "";
        const watch = s.matchStatus === "untracked" ? "no watch" : "not linked to a watch workout yet";
        rows.push({ day: s.date, line: `${s.date} ${describeSession(s)}${minutes} (${watch})` });
      }
      rows.sort((a, b) => b.day.localeCompare(a.day));
      return text(rows.length ? rows.map((row) => row.line).join("\n") : "No workouts in that range.");
    },
    { annotations: { readOnlyHint: true } }
  );

  const listMeals = tool(
    "list_meals",
    "List saved meals in a date range, newest first, with ids, totals and each item's macros and portion. search keeps only meals whose text or item names contain every word.",
    {
      start_date: localDate,
      end_date: localDate,
      search: z.string().optional().describe('A word or two, e.g. "smoothie" or "chicken bowl".')
    },
    async (args) => {
      const words = (args.search ?? "").split(/\s+/).filter(Boolean);
      const maxDays = words.length ? 365 : 31;
      if (args.start_date > args.end_date || addDays(args.start_date, maxDays) < args.end_date) {
        return errorText(`Use a range of at most ${maxDays} days${words.length ? "" : " without a search"}, start before end.`);
      }
      const limit = 40;
      const entries = await searchMacroEntries(db, userName, {
        startDate: args.start_date,
        endDate: args.end_date,
        words,
        limit
      });
      if (!entries.length) return text(words.length ? "No matching meals in that range." : "No meals in that range.");
      const more = entries.length === limit ? `\n(Showing the newest ${limit}; narrow the range or search for more.)` : "";
      return text(entries.map(describeMeal).join("\n") + more);
    },
    { annotations: { readOnlyHint: true } }
  );

  const getGoals = tool(
    "get_goals",
    "Daily targets (calories, macros in grams and percent, water) and one day's saved totals against them. Open drafts aren't counted.",
    { date: localDate.optional() },
    async (args) => {
      const day = checkDate(args.date);
      if ("error" in day) return errorText(day.error!);
      const [goals, entries, waterOz] = await Promise.all([
        getUserGoals(userName, db),
        searchMacroEntries(db, userName, { startDate: day.date!, endDate: day.date!, words: [], limit: 100 }),
        getWaterOunces(userName, day.date!, db)
      ]);
      const grams = gramsFromPercentGoals(goals);
      const eaten = summarizeEntries(entries);
      const row = (target: number, done: number) => ({ target, done: Math.round(done), left: Math.round(target - done) });
      return text({
        date: day.date,
        meals_saved: entries.length,
        calories: row(goals.calories, eaten.calories),
        protein_g: { ...row(grams.protein_g, eaten.protein_g), pct_of_calories: goals.proteinPct },
        carbs_g: { ...row(grams.carbs_g, eaten.carbs_g), pct_of_calories: goals.carbsPct },
        fat_g: { ...row(grams.fat_g, eaten.fat_g), pct_of_calories: goals.fatPct },
        water_oz: row(goals.waterOz, waterOz)
      });
    },
    { annotations: { readOnlyHint: true } }
  );

  const run = await runClaude({
    system: systemPrompt(today, nowLocal, context.viewDate),
    prompt: promptFor(message, context.history, context.openDrafts),
    server: {
      name: SERVER,
      config: createSdkMcpServer({
        name: SERVER,
        version: "1.0.0",
        tools: [
          draftMeal,
          draftWorkout,
          listWorkouts,
          listMeals,
          getGoals,
          ...checkinTools({ db, userName, today, resolveDraftId, checkDate, putDraft: (draft) => drafts.set(draft.id, draft) })
        ]
      }),
      tools: TOOLS
    }
  });

  return {
    reply: run.text,
    drafts: [...drafts.values()],
    meta: { model: run.model, durationMs: run.durationMs, turns: run.turns }
  };
}
