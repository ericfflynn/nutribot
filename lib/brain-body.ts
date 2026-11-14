// The chat brain's read tool for the body state (docs/body-state.md): the
// day's picture of body and mind in domains, areas and signals.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { addDays } from "./dates";
import { getBodyState, loadBodySources } from "./body-state/load";
import { buildBodyState } from "./body-state/build";
import { CALL_STYLE, callShape, checkCall, getDailyCall, guardrailsOf, saveDailyCall, toCall } from "./body-state/call";
import { localDateTime } from "./dates";
import { listBodyStates, listBodyStateVersions } from "./body-state/store";
import type { BodyState } from "./body-state/types";

export const BODY_TOOLS = ["get_body_state", "list_body_states", "submit_call"];

export const BODY_PROMPT = `## Body state
- The body state is the app's core model of how the owner is doing on a day, rebuilt from all their data. get_body_state returns it. Use it first for "how am I doing", "what should I do today", "why is my recovery low", and before suggesting training.
- It has three domains: physical (areas sleep, recovery, vitals, illness, load, training, fuel), mental (mood) and lifestyle (habits, career, relationships). Each domain and area has a status (good, ok, watch, low, unknown) and a headline with the evidence; a domain takes its worst area. Under each area are the signals: numbers against the owner's own baseline (usual), streaks and 7-day trends.
- explanations lists things that move the numbers besides illness: drinking or other habits, a late night, a hard training stretch, work stress. Use them when a number is off: "recovery is low after a late night" rather than an alarm.
- Illness phases: sick (they said so: logged, or a journal entry tagged sick), recovering (2 days after), early_signs (the watch shows resting HR, temperature or HRV off their baseline and nothing explains it), well. What the owner says beats what the data suggests.
- Today's call (get_body_state's call, shown on Today's check-in and as Training's Next up) is what to do today: made by you each morning inside guardrails the app sets (illness, readiness, sore muscles, the training rules), with a coach note and a question. physical.training.suggested is the rule-based default it started from. Explain the call from its reasons and the state; don't re-derive it.
- When they tell you something that changes today's plan ("my wrist hurts", "no gym today", "I feel great, can I go harder?", their answer to the morning question), revise the call: call submit_call with the whole new call and revised_because, after saving any report it depends on. The call includes week, the plan for each day left through Sunday so every muscle reaches 4 points (training.muscles[].points7 is this week's points); keep it in step with today's change ("chest today instead" moves what Saturday needs). When not everything fits, muscles that also missed last week come first (last Sunday's body state has last week's points). It's checked against the guardrails (which can't be lifted: "I feel great" doesn't make a red day hard); an error says what to fix. Revise only today's call, and only when the plan really changes. Say what changed in a sentence. The call's voice: ${CALL_STYLE}
- Temperatures are in Celsius in the data (physical.vitals.sleepTemp is a °C difference from the watch's baseline). Always tell the owner Fahrenheit, as the headlines do: multiply a difference by 1.8 (+0.5°C is +0.9°F).
- Status unknown means no data for that area; say so instead of guessing. meta.missing lists what's missing for the day.
- Body states are stored daily from late June 2026. list_body_states reads history: each day's domain and area statuses and headlines, plus any areas you ask for in full by path (physical.recovery, mental.mood, lifestyle.career, explanations). Use it for "how was October", "when was I last sick", trends and comparisons. A past day changes when something is logged late; with versions for a single day it shows what the app believed as the day went on. Before about mid-September most mental and lifestyle areas are unknown: there was no journal or habit data yet.`;

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

export function bodyTools({ db, userName, today }: { db: Pool; userName: string; today: string }) {
  const getBodyStateTool = tool(
    "get_body_state",
    "Read the body state for a day (today by default): domains, areas, signals, explanations and the suggested training.",
    { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("Local date, YYYY-MM-DD; null for today.") },
    async (args) => {
      const date = args.date ?? today;
      if (date > today) return { ...text("Can't read a future date."), isError: true };
      const [state, call] = await Promise.all([getBodyState(db, userName, date), getDailyCall(db, userName, date)]);
      return text({ ...state, call });
    },
    { annotations: { readOnlyHint: true } }
  );
  const listBodyStatesTool = tool(
    "list_body_states",
    "Read stored body states over a date range (up to 366 days): each day's domain and area statuses and headlines, and any areas asked for in full. With versions and a single day, every version of that day.",
    {
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      paths: z.array(z.string()).max(8).describe("Areas to include in full, by path: physical.recovery, mental.mood, explanations. Empty for statuses only."),
      versions: z.boolean().describe("With start_date equal to end_date: every version of that day, not just the current one.")
    },
    async (args) => {
      if (args.end_date < args.start_date) return { ...text("end_date is before start_date."), isError: true };
      if (addDays(args.start_date, 365) < args.end_date) return { ...text("At most 366 days at a time."), isError: true };
      const days = args.versions && args.start_date === args.end_date
        ? await listBodyStateVersions(db, userName, args.start_date)
        : await listBodyStates(db, userName, args.start_date, args.end_date);
      if (!days.length) return text("No stored body states in that range.");
      return text(
        days.map((day) => ({
          date: day.date,
          version: day.version,
          trigger: day.trigger,
          built_at: day.builtAt,
          ...heads(day.state),
          ...Object.fromEntries(args.paths.map((path) => [path, pick(day.state, path)]))
        }))
      );
    },
    { annotations: { readOnlyHint: true } }
  );

  return [getBodyStateTool, listBodyStatesTool, revisionTool(db, userName, today)];
}

const AREAS = {
  physical: ["sleep", "recovery", "vitals", "illness", "load", "training", "fuel"],
  mental: ["mood"],
  lifestyle: ["habits", "career", "relationships"]
} as const;

// "status: headline" for each domain and area: a day in a few lines.
function heads(state: BodyState) {
  const line = (head: { status: string; headline: string }) => `${head.status}: ${head.headline}`;
  const out: Record<string, string> = {};
  for (const [domain, areas] of Object.entries(AREAS)) {
    const value = state[domain as keyof typeof AREAS] as unknown as Record<string, { status: string; headline: string }> & {
      status: string;
      headline: string;
    };
    if (!value) continue;
    out[domain] = line(value);
    for (const area of areas) if (value[area]) out[`${domain}.${area}`] = line(value[area]);
  }
  out.illness_phase = state.physical?.illness?.phase ?? "unknown";
  return out;
}

function pick(state: BodyState, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), state);
}

// submit_call for the chat: guardrails built when it runs, so a report saved
// earlier in the turn (soreness, a sick day) counts.
function revisionTool(db: Pool, userName: string, today: string) {
  return tool(
    "submit_call",
    "Revise today's call when something they said changes the plan. The whole call, checked against today's guardrails; an error says what to fix.",
    { ...callShape, revised_because: z.string().max(160).describe("What they said that changed it.") },
    async (args) => {
      const sources = await loadBodySources(db, userName, today);
      const state = buildBodyState(sources, today, { trigger: "report" });
      const guardrails = guardrailsOf(state, sources);
      const call = toCall(args, "claude", localDateTime());
      const problem = checkCall(call, guardrails);
      if (problem) return { ...text(problem), isError: true };
      await saveDailyCall(db, userName, state, guardrails, { ...call, revised: args.revised_because }, "report");
      return text("Today's call is revised.");
    }
  );
}
