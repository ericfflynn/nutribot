// The chat brain's read tool for the body state (docs/body-state.md): the
// day's picture of body and mind in domains, areas and signals.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { addDays } from "./dates";
import { getBodyState } from "./body-state/load";
import { listBodyStates, listBodyStateVersions } from "./body-state/store";
import type { BodyState } from "./body-state/types";

export const BODY_TOOLS = ["get_body_state", "list_body_states"];

export const BODY_PROMPT = `## Body state
- The body state is the app's core model of how the owner is doing on a day, rebuilt from all their data. get_body_state returns it. Use it first for "how am I doing", "what should I do today", "why is my recovery low", and before suggesting training.
- It has three domains: physical (areas sleep, recovery, vitals, illness, load, training, fuel), mental (mood) and lifestyle (habits, career, relationships). Each domain and area has a status (good, ok, watch, low, unknown) and a headline with the evidence; a domain takes its worst area. Under each area are the signals: numbers against the owner's own baseline (usual), streaks and 7-day trends.
- explanations lists things that move the numbers besides illness: drinking or other habits, a late night, a hard training stretch, work stress. Use them when a number is off: "recovery is low after a late night" rather than an alarm.
- Illness phases: sick (they said so: logged, or a journal entry tagged sick), recovering (2 days after), early_signs (the watch shows resting HR, temperature or HRV off their baseline and nothing explains it), well. What the owner says beats what the data suggests.
- physical.training.suggested is Training's Next up for that day, with illness applied: sick means rest. Explain it from the state's headlines and signals rather than re-deriving it, and say which area drives it.
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
      return text(await getBodyState(db, userName, date));
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

  return [getBodyStateTool, listBodyStatesTool];
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
