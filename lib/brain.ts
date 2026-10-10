// The chat brain: one user message in, a reply plus meal/workout drafts out.
// Contract and rationale: docs/brain.md. Tools only create drafts; nothing is
// saved until the owner taps Save (app/actions.ts → saveDraftAction).
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runClaude } from "./claude-brain";
import { addDays, isValidLocalDate, localDateTime } from "./dates";
import { HEALTH_DATA_TYPES } from "./health/google";
import { runHealthSync } from "./health/sync";
import { normalizeGeneratedMacroEstimate, type ParsedMacros } from "./macros";
import type { MealType } from "./supabase";
import {
  MUSCLE_GROUPS,
  WORKOUT_TYPES,
  chooseMatch,
  listFitbitWorkouts,
  type FitbitWorkout,
  type MatchResult,
  type MuscleGroup,
  type TimeHint,
  type WorkoutType
} from "./workouts";

export type MealDraft = {
  type: "meal";
  id: string;
  date: string;
  raw_text: string;
  meal_type: MealType;
  estimate: ParsedMacros;
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

export type Draft = MealDraft | WorkoutDraft;

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
const TOOLS = ["draft_meal", "draft_workout", "list_fitbit_workouts"];

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
- To change an open draft, call the same tool again with replaces set to its id. Saved drafts can't be changed here.
- A message can hold several meals and workouts, or none. Plain questions get a plain answer and no drafts.

## Meals
- Estimate each food item separately. The app sums the totals.
- Use reasonable portions when quantities are missing, and state the portion in the item's assumption.
- notes holds a concrete assumption only when it matters ("Assumed 4 oz chicken"). Never write generic caveats like "values may vary".
- If confidence is below 0.75, accuracy_suggestion asks for the single most useful missing detail (portion, brand, cooking fat, weight, count). Otherwise it's empty.
- meal_type comes from the foods and when they were eaten: breakfast, lunch, dinner or snack.

## Workouts
- Muscle groups are only: ${MUSCLE_GROUPS.join(", ")}. "tris" is Triceps, "bis" Biceps; quads, hamstrings, glutes and calves are Legs; lats and traps are Back; delts are Shoulders; core is Abs. A named exercise counts for the groups it mainly trains (bench press: Chest, Triceps). Push, pull and legs days are Chest/Shoulders/Triceps, Back/Biceps and Legs. Runs, rides and walks are Cardio.
- workout_type: strength for lifting, run, walk, ride, sport (tennis, golf), class (pilates, yoga, aerobics), or other.
- rpe converts intensity words: easy or light 3-4, moderate or solid 6, hard 8, brutal or all-out 9-10. Use a number they give as is. With no sense of intensity, rpe is null and you ask how hard it was. That is the only question to ask about a workout; never ask for exercises, sets or duration.
- The watch records most workouts, and the app matches each draft to the right one. Help it with time_hint when they say when: morning 05:00-12:00, afternoon 12:00-17:00, evening or after work 17:00-22:00, or a specific time ±1 hour. Leave time_hint null for "just now" or no time.
- untracked is true only when they say they didn't wear the watch. Only then is duration_min filled, and only if they state it.
- For past days, or when they describe a workout by its time or type, call list_fitbit_workouts and pass fitbit_workout_id when their description clearly points to one workout.
- The tool result says which watch workout was matched. Mention it briefly ("matched to your 6:12 PM weightlifting, 49 min"), or say it will link when the watch syncs.

## Everything else
- Answer general questions directly and briefly. You can't see their meal history, goals or health metrics yet; say so if asked.
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
      draft.type === "meal"
        ? { id: draft.id, type: "meal", date: draft.date, raw_text: draft.raw_text, meal_type: draft.meal_type, items: draft.estimate.items }
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

  function resolveDraftId(replaces: string | undefined) {
    if (!replaces) return { id: randomUUID() };
    const previous = drafts.get(replaces) ?? openById.get(replaces);
    if (!previous) return { error: `No open draft with id ${replaces}.` };
    if (previous.saved_id) return { error: "That draft is already saved; it can be edited on the Log page." };
    return { id: replaces };
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
      meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      items: z.array(mealItem).min(1),
      confidence: z.number().min(0).max(1),
      notes: z.string(),
      accuracy_suggestion: z.string(),
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error!);
      const day = checkDate(args.date);
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
        saved_id: null
      });
      return text({
        draft_id: target.id,
        date: day.date,
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
      fitbit_workout_id: z.string().nullable().describe("A specific watch workout from list_fitbit_workouts."),
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
    "list_fitbit_workouts",
    "List the watch's recorded workouts in a date range (at most 31 days), newest first.",
    {
      start_date: localDate,
      end_date: localDate,
      unlabeled_only: z.boolean().describe("Only workouts nothing has been logged for.")
    },
    async (args) => {
      if (args.start_date > args.end_date || addDays(args.start_date, 31) < args.end_date) {
        return errorText("Use a range of at most 31 days, start before end.");
      }
      const workouts = await listFitbitWorkouts(db, userName, args.start_date, args.end_date);
      const rows = workouts.filter((w) => !args.unlabeled_only || !w.sessionId).map((w) => `${w.day} ${describeWorkout(w)}`);
      return text(rows.length ? rows.join("\n") : "No watch workouts in that range.");
    },
    { annotations: { readOnlyHint: true } }
  );

  const run = await runClaude({
    system: systemPrompt(today, nowLocal, context.viewDate),
    prompt: promptFor(message, context.history, context.openDrafts),
    server: {
      name: SERVER,
      config: createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: [draftMeal, draftWorkout, listWorkouts] }),
      tools: TOOLS
    }
  });

  return {
    reply: run.text,
    drafts: [...drafts.values()],
    meta: { model: run.model, durationMs: run.durationMs, turns: run.turns }
  };
}
