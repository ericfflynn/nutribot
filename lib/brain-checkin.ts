// The chat brain's journal and habit tools. Same contract as the meal and
// workout tools in lib/brain.ts: they build drafts, and nothing is saved
// until the owner taps Save. Plan: docs/journal-habits-plan.md.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { addDays } from "./dates";
import {
  HABIT_DIRECTIONS,
  HABIT_MEASURES,
  describeDays,
  bandsProblem,
  describeGoal,
  formatHabitAmount,
  formatMinutes,
  habitOutcome,
  listHabitLogs,
  listHabits,
  normalizeDays,
  summarizeHabitDay,
  trackedOn,
  type Habit,
  type HabitInput,
  type HabitLogInput
} from "./habits";
import {
  JOURNAL_KINDS,
  MOOD_LABELS,
  STRESS_LABELS,
  getJournalEntry,
  listJournalEntries,
  listJournalTags,
  ratingLabel,
  type JournalInput,
  type JournalKind,
  type Rating
} from "./journal";
import { TAG_CATEGORIES, normalizeTags } from "./journal-tags";

// A saved entry a journal draft rewrites (draft_journal with edits).
export type JournalEditTarget = { id: string; date: string; kind: JournalKind };

export type JournalDraft = JournalInput & {
  type: "journal";
  id: string;
  // Set when saving overwrites a saved entry instead of adding one.
  edits?: JournalEditTarget | null;
  // Offered in conversation, not asked for: the chat shows a small "Save to
  // journal" button instead of the full card.
  offer?: boolean;
  saved_id: string | null;
  discarded?: boolean;
};

export type HabitLogDraft = HabitLogInput & Pick<Habit, "name" | "measure" | "unit">;

// One card for a day's habit logs, zeros included. Saving adds them to the
// day, after deleting any saved logs it replaces (a correction).
export type HabitsDraft = {
  type: "habits";
  id: string;
  date: string;
  logs: HabitLogDraft[];
  replaces_logs?: { id: string; label: string }[];
  saved_id: string | null;
  discarded?: boolean;
};

// Adds a tracked habit, or changes one (habit_id set).
export type HabitDraft = {
  type: "habit";
  id: string;
  habit_id: string | null;
  habit: HabitInput;
  saved_id: string | null;
  discarded?: boolean;
};

export type CheckinDraft = JournalDraft | HabitsDraft | HabitDraft;

export const CHECKIN_TOOLS = ["draft_journal", "draft_habits", "draft_habit", "list_habits", "list_journal", "list_habit_logs"];

export const CHECKIN_PROMPT = `## Journal
- Call draft_journal for a check-in answer, or when they ask to journal something ("put that in my journal"). Keep body in their words, lightly cleaned up (typos, filler); never shorten it into a summary.
- When they share how they feel or how their day is going in conversation, without asking to journal it, talk with them first. If it says how they feel or what's going on with them (a mood, a struggle, a stressor, an event, a binge), also call draft_journal with offer true; skip it only for small talk and plain questions, and when unsure, offer, since it costs them nothing. It shows as a small "Save to journal" button under your reply, so don't mention it, call it a draft or ask them to review it. At most one offer per reply, and don't offer again for the same thing.
- Mood is the main rating: ${MOOD_LABELS.map((label, index) => `${index + 1} ${label}`).join(", ")}. It's how they feel emotionally.
- Stress is optional and separate: ${STRESS_LABELS.map((label, index) => `${index + 1} ${label}`).join(", ")}. It's pressure or strain, not mood. Set it only when they talk about pressure, worry or calm; never work it out from mood, and never set mood from stress. A great mood can come with high stress.
- energy (1 drained, 5 energized) and soreness (1 none, 5 very sore) are optional too. Every rating the text doesn't support is null, never a guess.
- tags: one to four lowercase tags for what came up. Prefer these, by category: ${TAG_CATEGORIES.map((category) => `${category.label}: ${category.tags.join(", ")}`).join("; ")}. Add a custom tag only for something specific that none of these cover ("sore legs"), and reuse the owner's earlier tags (list_journal) over new wording.
- kind is morning before noon, evening after 5 pm, other in between, except that an answer to a check-in takes that check-in's kind whatever the time: a message starting "Morning check-in:" (from Today's card) is morning, "Evening check-in:" is evening. An entry written before 4 am about the night before belongs to the previous date.
- A day can have several entries of the same kind. New writing about their day, even a follow-up to an earlier entry, is a new entry: call draft_journal without edits.
- Edit a saved entry only when they ask to change it ("change my mood this morning to 4", "fix that entry", "add this to my earlier entry"): call draft_journal with edits set to its id and the whole revised entry, keeping their earlier words. list_journal shows ids. Never say whether an entry exists without checking list_journal.

## Check-ins
- A check-in is a short conversation, not a form. Nothing is required; skip whatever they don't want to answer.
- If they start with no details ("evening check-in", "morning check-in", or a reminder's prompt), first call list_habit_logs and list_workouts for today, then ask one short, friendly question that covers what's missing: how they feel (morning: how they slept), any habits tracked today with no log yet, and an unlabeled workout if there is one. Example: "How was today, mood-wise? And any nicotine or drinks, and did you get your reading in?"
- Ask about missing habits and unlabeled workouts once per check-in. If they answer only part of it, draft what they gave and let the rest go; never ask the same thing again in that conversation (the history shows what you already asked).
- From their answer, draft what applies in one reply: the journal entry (mood if they gave a sense of it), the day's habits, a workout. If mood is still unclear after they answered, you may ask once ("Would you call today a 3 or more like a 4?"); never ask about stress, energy or soreness.
- Close with one useful line when the data supports it: a habit streak, a goal met, or an observation from list_journal over recent weeks ("third evening this week tagged work with mood 2"). Keep it to one sentence and never lecture.

## Habits
- Call list_habits before logging a habit, and rate each use with that habit's scale_guide so ratings stay consistent. Intensity is 1 light, 2 moderate, 3 heavy; counts and minutes are numbers.
- details keeps their words ("1 Zyn on the golf course"). Add started_at and ended_at when they give times or say how late. For a habit whose cutoff applies that day (list_habits says when), ask until when if they didn't say; without times the day can't be judged.
- Times are 24-hour local. Read a time without am or pm the way it was most likely meant: gaming, drinks and anything after dinner are evening ("8:30 to 11:15" is 20:30-23:15). Don't ask which.
- amount 0 means they said they didn't do it today. Only record 0 when they say so. A habit never mentioned stays unlogged.
- One draft_habits call per day holds all of that day's habit logs, uses and zeros together.
- Saving a card adds its logs to the day. To log more uses later in the day, make a new card. To correct a saved log ("it was 3 drinks, not 2"), call draft_habits with replace_logs set to the ids of the logs that change (list_habit_logs and draft_habits show them) and the corrected logs; never send a correction as an extra log, or the day counts both.
- In an evening check-in, call list_habit_logs for today and ask once, in one short sentence, about active habits tracked today with no log yet, so missing days get their zeros ("Any weed, nicotine or drinks today? Read or play Xbox?").
- To start tracking something new, or change a habit's name, description, scale, goal, color bands, cutoff or days, call draft_habit with the habit's current values for everything that isn't changing (list_habits has them). The owner can also edit habits on the Habits tab. A habit's measure can't change once it has logs; suggest a new habit instead. Intensity habits need a scale_guide that says what 1, 2 and 3 mean.
- Each habit can have a goal: for limit habits the most that's OK in a day (0 means none), for build habits the least. A day meeting the goal is green; a miss is yellow, orange or red. Color bands set where orange and red start, in the habit's measure: gaming with goal 0 and bands orange 60, red 90 is yellow for 1-60 minutes, orange to 90, red past 90; reading with goal 20 and bands orange 10, red 1 is yellow under 20, orange under 10, red at none. Without bands the app steps from the goal. When they describe colors or levels ("over an hour is bad, over 2 hours is really bad"), set goal and bands with draft_habit. A cutoff makes any use after that time a miss, optionally on weeknights (Sun-Thu) only. list_habit_logs says whether each day met the goal; use it for "how am I doing".
- An evening check-in usually ends with two drafts: the journal entry and the day's habits. Mention them in a sentence or two, not a list; the cards show the details.`;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD.");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("Local time, HH:MM.");
const rating = z.number().int().min(1).max(5).nullable();
const uuid = z.string().uuid();
const MAX_RANGE_DAYS = 92;

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function errorText(message: string) {
  return { ...text(message), isError: true };
}

function describeHabit(habit: Habit) {
  const measure = habit.measure === "count" ? `count of ${habit.unit ?? "uses"}` : habit.measure;
  const parts = [`${habit.name} (id ${habit.id}): ${measure}, ${habit.direction}`];
  const goal = describeGoal(habit);
  if (goal) parts.push(`goal: ${goal}`);
  if (habit.days) parts.push(`tracked ${describeDays(habit.days)} only (days ${habit.days.join(",")})`);
  if (habit.description) parts.push(`description: ${habit.description}`);
  if (habit.scaleGuide) parts.push(`scale: ${habit.scaleGuide}`);
  if (!habit.active) parts.push("archived");
  return parts.join("; ");
}

function checkRange(start: string, end: string) {
  if (start > end || addDays(start, MAX_RANGE_DAYS) < end) {
    return `Use a range of at most ${MAX_RANGE_DAYS} days, start before end.`;
  }
  return null;
}

type DraftSlot = { id: string; previous?: { type: string; saved_id: string | null } } | { error: string };

export function checkinTools(context: {
  db: Pool;
  userName: string;
  today: string;
  // Shared with the meal and workout tools in runBrain.
  resolveDraftId: (replaces: string | undefined) => DraftSlot;
  checkDate: (date: string | undefined) => { date: string } | { error: string };
  putDraft: (draft: CheckinDraft) => void;
}) {
  const { db, userName, resolveDraftId, checkDate, putDraft } = context;

  const draftJournal = tool(
    "draft_journal",
    "Create or revise a journal entry draft for review.",
    {
      date: localDate.optional(),
      kind: z.enum(JOURNAL_KINDS),
      body: z.string().min(1).describe("The entry in their words, lightly cleaned up."),
      mood: rating,
      energy: rating,
      stress: rating,
      soreness: rating,
      tags: z.array(z.string()).max(8),
      replaces: z.string().optional().describe("Id of an open draft this revises."),
      edits: z
        .string()
        .optional()
        .describe("Id of a saved entry (from list_journal) this draft rewrites: saving overwrites its date, kind, text, ratings and tags."),
      offer: z
        .boolean()
        .optional()
        .describe("True when they shared this in conversation without asking to journal it: shown as a small Save to journal button.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error);
      // A revision of an edit draft keeps editing the same entry.
      const previousEdit = target.previous?.type === "journal" ? (target.previous as JournalDraft).edits : null;
      const editId = args.edits ?? previousEdit?.id;
      let edits: JournalEditTarget | null = null;
      if (editId) {
        const entry = uuid.safeParse(editId).success ? await getJournalEntry(db, userName, editId) : null;
        if (!entry) return errorText(`No saved journal entry with id ${editId}. Call list_journal.`);
        edits = { id: entry.id, date: entry.date, kind: entry.kind };
      }
      const day = checkDate(args.date ?? edits?.date);
      if ("error" in day) return errorText(day.error);
      const ratings = { mood: args.mood, energy: args.energy, stress: args.stress, soreness: args.soreness };
      const known = (await listJournalTags(db, userName, day.date)).map((row) => row.tag);
      putDraft({
        type: "journal",
        id: target.id,
        date: day.date,
        kind: args.kind,
        body: args.body.trim(),
        ratings,
        tags: normalizeTags(args.tags, known),
        edits,
        ...(args.offer && !edits ? { offer: true } : {}),
        saved_id: null
      });
      return text({
        draft_id: target.id,
        date: day.date,
        ratings,
        ...(edits ? { rewrites: `saved ${edits.kind} entry ${edits.id} (${edits.date})` } : {})
      });
    }
  );

  const draftHabits = tool(
    "draft_habits",
    "Create or revise one day's habit logs for review: every use and every explicit zero that day.",
    {
      date: localDate.optional(),
      logs: z
        .array(
          z.object({
            habit_id: z.string(),
            amount: z.number().min(0).describe("Intensity 1-3, a count, or minutes; 0 means they didn't today."),
            details: z.string().nullable().describe("Their words for this use."),
            started_at: hhmm.nullable(),
            ended_at: hhmm.nullable()
          })
        )
        .min(1),
      replaces: z.string().optional().describe("Id of an open draft this revises."),
      replace_logs: z
        .array(z.string())
        .optional()
        .describe("Ids of saved logs that day (from list_habit_logs) this card corrects; they're deleted when it's saved. Leave out to add to the day.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error);
      const day = checkDate(args.date);
      if ("error" in day) return errorText(day.error);
      const saved = await listHabitLogs(db, userName, day.date, day.date);

      const habits = await listHabits(db, userName);
      const byId = new Map(habits.map((habit) => [habit.id, habit]));
      const logs: HabitLogDraft[] = [];
      for (const log of args.logs) {
        const habit = byId.get(log.habit_id);
        if (!habit) return errorText(`No active habit with id ${log.habit_id}. Call list_habits.`);
        if (habit.measure === "intensity" && !Number.isInteger(log.amount)) {
          return errorText(`${habit.name} is rated 0-3 in whole numbers.`);
        }
        if (habit.measure === "intensity" && log.amount > 3) return errorText(`${habit.name} is rated 0-3.`);
        if (habit.measure === "minutes" && log.amount > 24 * 60) return errorText("Minutes can't exceed a day.");
        logs.push({
          habitId: habit.id,
          name: habit.name,
          measure: habit.measure,
          unit: habit.unit,
          amount: log.amount,
          details: log.details?.trim() || null,
          startedAt: log.started_at,
          endedAt: log.ended_at
        });
      }
      // A revision of a correction keeps replacing the same logs.
      const previousReplaces = target.previous?.type === "habits" ? (target.previous as HabitsDraft).replaces_logs : undefined;
      const replaceIds = args.replace_logs ?? previousReplaces?.map((log) => log.id) ?? [];
      const replaces: { id: string; label: string }[] = [];
      for (const id of new Set(replaceIds)) {
        const log = saved.find((item) => item.id === id);
        const habit = log ? byId.get(log.habitId) : undefined;
        if (!log || !habit) return errorText(`No saved log ${id} on ${day.date}. Call list_habit_logs.`);
        replaces.push({ id, label: `${habit.name}: ${formatHabitAmount(habit, log.amount)}` });
      }
      putDraft({ type: "habits", id: target.id, date: day.date, logs, replaces_logs: replaces, saved_id: null });

      // What's still unknown that day, so Claude can ask about it.
      const covered = new Set([...saved.map((log) => log.habitId), ...logs.map((log) => log.habitId)]);
      return text({
        draft_id: target.id,
        date: day.date,
        logs: logs.map((log) => `${log.name}: ${formatHabitAmount(log, log.amount)}`),
        ...(replaces.length ? { replaces_saved: replaces.map((log) => log.label) } : {}),
        already_saved: saved
          .filter((log) => !replaces.some((item) => item.id === log.id))
          .map((log) => {
            const habit = byId.get(log.habitId);
            return `${log.id}: ${habit ? `${habit.name} ${formatHabitAmount(habit, log.amount)}` : "archived habit"}${log.details ? ` "${log.details}"` : ""}`;
          }),
        not_logged_yet: habits
          .filter((habit) => !covered.has(habit.id) && trackedOn(habit, day.date))
          .map((habit) => habit.name)
      });
    }
  );

  const draftHabit = tool(
    "draft_habit",
    "Create or revise a draft that adds a tracked habit, or changes one (habit_id set): its name, description, scale, goal, cutoff, days, or whether it's archived. A change keeps the habit's history.",
    {
      habit_id: z.string().nullable().describe("The habit to change, from list_habits; null for a new one."),
      name: z.string().min(1).max(40),
      description: z.string().max(300).nullable().describe("What counts, in their words. Keep the current one when changing something else."),
      days: z
        .array(z.number().int().min(0).max(6))
        .nullable()
        .describe("Weekdays it's tracked, 0 Sunday-6 Saturday; null for every day. Keep the current days when changing something else."),
      measure: z.enum(HABIT_MEASURES),
      unit: z.string().nullable().describe('For counts, e.g. "drinks".'),
      direction: z.enum(HABIT_DIRECTIONS).describe("limit: less is better. build: more is better."),
      scale_guide: z.string().nullable().describe("For intensity habits: what 1 light, 2 moderate and 3 heavy mean."),
      goal: z
        .number()
        .min(0)
        .nullable()
        .describe("Daily target in the habit's measure: the most that's OK for limit habits (0 = none), the least for build habits."),
      bands: z
        .object({ orange: z.number().min(0), red: z.number().min(0) })
        .nullable()
        .describe("Color bands in the habit's measure: limit habits turn orange past orange and red past red; build habits orange under orange and red under red. Null for the default steps. Keep the current bands when changing something else."),
      cutoff: hhmm.nullable().describe("Local time after which any use is a miss."),
      cutoff_weeknights: z.boolean().describe("The cutoff applies Sunday-Thursday nights only."),
      active: z.boolean(),
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error);
      if (args.measure === "intensity" && !args.scale_guide) return errorText("Intensity habits need a scale_guide.");
      if (args.measure === "count" && !args.unit) return errorText("Count habits need a unit.");
      const bandError = bandsProblem({ measure: args.measure, direction: args.direction, goal: args.goal, bands: args.bands });
      if (bandError) return errorText(bandError);
      const habits = await listHabits(db, userName, true);
      if (args.habit_id && !habits.some((habit) => habit.id === args.habit_id)) {
        return errorText(`No habit with id ${args.habit_id}.`);
      }
      const clash = habits.find((habit) => habit.name.toLowerCase() === args.name.trim().toLowerCase());
      if (clash && clash.id !== args.habit_id) return errorText(`${clash.name} is already tracked (id ${clash.id}).`);
      putDraft({
        type: "habit",
        id: target.id,
        habit_id: args.habit_id,
        habit: {
          name: args.name.trim(),
          measure: args.measure,
          unit: args.measure === "count" ? args.unit : null,
          direction: args.direction,
          scaleGuide: args.measure === "intensity" ? args.scale_guide : null,
          goal: args.goal,
          bands: args.bands,
          cutoff: args.cutoff,
          cutoffWeeknights: Boolean(args.cutoff) && args.cutoff_weeknights,
          description: args.description?.trim() || null,
          days: normalizeDays(args.days),
          active: args.active
        },
        saved_id: null
      });
      return text({ draft_id: target.id });
    }
  );

  const listHabitsTool = tool(
    "list_habits",
    "List tracked habits with ids, how each is measured, its cutoff and its intensity scale guide.",
    { include_archived: z.boolean() },
    async (args) => {
      const habits = await listHabits(db, userName, args.include_archived);
      return text(habits.length ? habits.map(describeHabit).join("\n") : "No habits are tracked yet.");
    },
    { annotations: { readOnlyHint: true } }
  );

  const listJournal = tool(
    "list_journal",
    `List journal entries in a date range (at most ${MAX_RANGE_DAYS} days), newest day first, with ratings and tags.`,
    { start_date: localDate, end_date: localDate },
    async (args) => {
      const error = checkRange(args.start_date, args.end_date);
      if (error) return errorText(error);
      const entries = await listJournalEntries(db, userName, args.start_date, args.end_date);
      if (!entries.length) return text("No journal entries in that range.");
      return text(
        entries
          .map((entry) => {
            const ratings = (Object.entries(entry.ratings) as [Rating, number | null][])
              .filter(([, value]) => value != null)
              .map(([name, value]) => `${name} ${value} (${ratingLabel(name, value!)})`)
              .join(", ");
            const tags = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
            return `${entry.date} ${entry.kind} (id ${entry.id})${ratings ? ` (${ratings})` : ""}${tags}: ${entry.body}`;
          })
          .join("\n")
      );
    },
    { annotations: { readOnlyHint: true } }
  );

  const listHabitLogsTool = tool(
    "list_habit_logs",
    `Each day's habit status in a date range (at most ${MAX_RANGE_DAYS} days), newest first: level, uses with details and times, and which habits are unlogged.`,
    { start_date: localDate, end_date: localDate },
    async (args) => {
      const error = checkRange(args.start_date, args.end_date);
      if (error) return errorText(error);
      const [habits, logs] = await Promise.all([
        listHabits(db, userName),
        listHabitLogs(db, userName, args.start_date, args.end_date)
      ]);
      if (!habits.length) return text("No habits are tracked yet.");
      const lines: string[] = [];
      for (let date = args.end_date; date >= args.start_date; date = addDays(date, -1)) {
        const dayLogs = logs.filter((log) => log.date === date);
        const days = summarizeHabitDay(habits, date, dayLogs).map((day) => {
          const outcome = habitOutcome(day);
          const verdict = outcome === "met" ? ", goal met" : outcome.startsWith("miss") ? `, goal missed (${outcome.slice(5)} of 3)` : "";
          if (outcome === "off") return `${day.habit.name}: not tracked that day`;
          if (day.status === "unknown") return `${day.habit.name}: not logged`;
          if (day.status === "none") {
            const zero = dayLogs.find((log) => log.habitId === day.habit.id);
            return `${day.habit.name}: none${verdict}${zero ? ` [id ${zero.id}]` : ""}`;
          }
          const uses = dayLogs
            .filter((log) => log.habitId === day.habit.id && log.amount > 0)
            .map((log) => {
              const times = log.startedAt || log.endedAt ? ` ${log.startedAt ?? "?"}-${log.endedAt ?? "?"}` : "";
              return `${formatHabitAmount(day.habit, log.amount)}${times}${log.details ? ` "${log.details}"` : ""} [id ${log.id}]`;
            });
          const late = day.lateMinutes ? `, ${formatMinutes(day.lateMinutes)} past ${day.habit.cutoff}` : "";
          return `${day.habit.name}: ${formatHabitAmount(day.habit, day.level)}${late}${verdict} (${uses.join("; ")})`;
        });
        lines.push(`${date}: ${days.join(" | ")}`);
      }
      return text(lines.join("\n"));
    },
    { annotations: { readOnlyHint: true } }
  );

  return [draftJournal, draftHabits, draftHabit, listHabitsTool, listJournal, listHabitLogsTool];
}
