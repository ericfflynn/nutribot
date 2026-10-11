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
  describeGoal,
  formatHabitAmount,
  formatMinutes,
  habitOutcome,
  listHabitLogs,
  listHabits,
  summarizeHabitDay,
  type Habit,
  type HabitInput,
  type HabitLogInput
} from "./habits";
import { JOURNAL_KINDS, listJournalEntries, type JournalInput } from "./journal";

export type JournalDraft = JournalInput & {
  type: "journal";
  id: string;
  saved_id: string | null;
  discarded?: boolean;
};

export type HabitLogDraft = HabitLogInput & Pick<Habit, "name" | "measure" | "unit">;

// One card for a day's habit logs, zeros included.
export type HabitsDraft = {
  type: "habits";
  id: string;
  date: string;
  logs: HabitLogDraft[];
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
- When they write about how they feel or how the day or night went (stress, work, energy, soreness, mood), call draft_journal. Keep body in their words, lightly cleaned up (typos, filler); never shorten it into a summary.
- Ratings are 1-5: mood (1 awful, 5 great), energy (1 drained, 5 energized), stress (1 calm, 5 overwhelmed), soreness (1 none, 5 very sore). Set one only when the text supports it; otherwise null. Never ask for ratings.
- tags are a few short lowercase labels for what came up ("work", "sore legs", "poor sleep", "social"). Reuse earlier tags from list_journal when they fit.
- kind is morning before noon, evening after 5 pm, other in between. An entry written before 4 am about the night before belongs to the previous date.
- If they start a check-in with no details ("evening check-in", "morning check-in"), ask how the day went, or how they slept and feel, in one short question. In the evening, also ask about habits not logged yet (below).

## Habits
- Call list_habits before logging a habit, and rate each use with that habit's scale_guide so ratings stay consistent. Intensity is 1 light, 2 moderate, 3 heavy; counts and minutes are numbers.
- details keeps their words ("1 Zyn on the golf course"). Add started_at and ended_at when they give times or say how late. For a habit whose cutoff applies that day (list_habits says when), ask until when if they didn't say; without times the day can't be judged.
- Times are 24-hour local. Read a time without am or pm the way it was most likely meant: gaming, drinks and anything after dinner are evening ("8:30 to 11:15" is 20:30-23:15). Don't ask which.
- amount 0 means they said they didn't do it today. Only record 0 when they say so. A habit never mentioned stays unlogged.
- One draft_habits call per day holds all of that day's habit logs, uses and zeros together.
- In an evening check-in, call list_habit_logs for today and ask in one short sentence about active habits with no log yet, so missing days get their zeros ("Any weed, nicotine or drinks today? Read or play Xbox?").
- To start tracking something new, or change a habit's scale, goal or cutoff, call draft_habit. Intensity habits need a scale_guide that says what 1, 2 and 3 mean.
- Each habit can have a goal: for limit habits the most that's OK in a day (0 means none), for build habits the least. A cutoff makes any use after that time a miss, optionally on weeknights (Sun-Thu) only. list_habit_logs says whether each day met the goal; use it for "how am I doing".
- An evening check-in usually ends with two drafts: the journal entry and the day's habits. Mention them in a sentence or two, not a list; the cards show the details.`;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date, YYYY-MM-DD.");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("Local time, HH:MM.");
const rating = z.number().int().min(1).max(5).nullable();
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
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error);
      const day = checkDate(args.date);
      if ("error" in day) return errorText(day.error);
      const ratings = { mood: args.mood, energy: args.energy, stress: args.stress, soreness: args.soreness };
      putDraft({
        type: "journal",
        id: target.id,
        date: day.date,
        kind: args.kind,
        body: args.body.trim(),
        ratings,
        tags: [...new Set(args.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
        saved_id: null
      });
      return text({ draft_id: target.id, date: day.date, ratings });
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
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return errorText(target.error);
      const day = checkDate(args.date);
      if ("error" in day) return errorText(day.error);

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
      putDraft({ type: "habits", id: target.id, date: day.date, logs, saved_id: null });

      // What's still unknown that day, so Claude can ask about it.
      const saved = await listHabitLogs(db, userName, day.date, day.date);
      const covered = new Set([...saved.map((log) => log.habitId), ...logs.map((log) => log.habitId)]);
      return text({
        draft_id: target.id,
        date: day.date,
        logs: logs.map((log) => `${log.name}: ${formatHabitAmount(log, log.amount)}`),
        not_logged_yet: habits.filter((habit) => !covered.has(habit.id)).map((habit) => habit.name)
      });
    }
  );

  const draftHabit = tool(
    "draft_habit",
    "Create or revise a draft that adds a tracked habit, or changes one (habit_id set): its scale, cutoff, or whether it's archived.",
    {
      habit_id: z.string().nullable().describe("The habit to change, from list_habits; null for a new one."),
      name: z.string().min(1).max(40),
      measure: z.enum(HABIT_MEASURES),
      unit: z.string().nullable().describe('For counts, e.g. "drinks".'),
      direction: z.enum(HABIT_DIRECTIONS).describe("limit: less is better. build: more is better."),
      scale_guide: z.string().nullable().describe("For intensity habits: what 1 light, 2 moderate and 3 heavy mean."),
      goal: z
        .number()
        .min(0)
        .nullable()
        .describe("Daily target in the habit's measure: the most that's OK for limit habits (0 = none), the least for build habits."),
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
          cutoff: args.cutoff,
          cutoffWeeknights: Boolean(args.cutoff) && args.cutoff_weeknights,
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
            const ratings = Object.entries(entry.ratings)
              .filter(([, value]) => value != null)
              .map(([name, value]) => `${name} ${value}`)
              .join(", ");
            const tags = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
            return `${entry.date} ${entry.kind}${ratings ? ` (${ratings})` : ""}${tags}: ${entry.body}`;
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
          if (day.status === "unknown") return `${day.habit.name}: not logged`;
          if (day.status === "none") return `${day.habit.name}: none${verdict}`;
          const uses = dayLogs
            .filter((log) => log.habitId === day.habit.id && log.amount > 0)
            .map((log) => {
              const times = log.startedAt || log.endedAt ? ` ${log.startedAt ?? "?"}-${log.endedAt ?? "?"}` : "";
              return `${formatHabitAmount(day.habit, log.amount)}${times}${log.details ? ` "${log.details}"` : ""}`;
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
