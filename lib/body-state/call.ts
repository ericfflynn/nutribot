// The daily call (docs/body-state.md, The call): what to do today. Code sets
// the limits (guardrails) from the body state; Claude makes the call inside
// them each morning and writes the coach note; code checks it and falls back
// to the rules. Stored on the day's body state row (body_states.call).
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { runClaude } from "../claude-brain";
import { addDays, localDateTime } from "../dates";
import { listJournalEntries } from "../journal";
import { describeMemories, listMemories } from "../memories";
import { appendAssistantMessage, currentConversation } from "../chat";
import { INTENSITIES, TRACKED_MUSCLES, muscleCapsOn, type Intensity, type TrackedMuscle } from "../workouts";
import { callOf, morningBrief } from "./brief";
import { buildBodyState } from "./build";
import { limitsLine, musclesLine, severityLabel } from "../ailments-core";
import { loadBodySources } from "./load";
import { saveBodyState } from "./store";
import type { BodySources, BodyState } from "./types";

export const CALL_KINDS = ["rest", "walk", "mobility", "cardio", "strength"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

export type Guardrails = {
  rest: boolean; // no training today: rest, a walk or easy mobility
  maxIntensity: Intensity;
  allowedKinds: CallKind[];
  // Each muscle's most today; null is out.
  muscles: { muscle: TrackedMuscle; max: Intensity | null; because: string | null }[];
  because: string[]; // what set the limits, in words
  // Open injuries and pain below bad, for Claude to weigh (added Nov 10,
  // 2026): the muscles each affects, and the words a reason must use to
  // work them past light.
  ailments?: { name: string; severity: string; day: number; bodyParts: string[]; affects: TrackedMuscle[] }[];
};

export type DailyCall = {
  kind: CallKind;
  dayType: string | null; // "Pull day", for strength
  work: { muscle: TrackedMuscle; intensity: Intensity }[];
  accessory: TrackedMuscle[];
  headline: string; // "Easy pull day", "Rest today"
  note: string; // the coach note, 2-4 sentences
  reasons: string[]; // short evidence rows
  // How the plan treats each open injury or pain (added Nov 10, 2026).
  ailments?: { name: string; plan: string }[];
  ask: string | null; // the one question for the owner
  source: "claude" | "rules";
  madeAt: string; // local "YYYY-MM-DDTHH:MM"
  revised?: string | null; // why the chat changed it during the day
};

const RANK: Record<Intensity, number> = { light: 0, medium: 1, hard: 2 };
const lower = (a: Intensity, b: Intensity) => (RANK[a] <= RANK[b] ? a : b);

// The hard edges of the day. Rules only take things away; the strictest wins.
export function guardrailsOf(state: BodyState, sources: Pick<BodySources, "sessions">): Guardrails {
  const { illness, training } = state.physical;
  const readiness = training.readiness;
  const because: string[] = [];
  let rest = false;
  let max: Intensity = "hard";
  let kinds: CallKind[] = [...CALL_KINDS];
  const severity = illness.phase === "sick" ? (illness.told?.severity ?? 2) : 0;
  if (severity >= 2) {
    rest = true;
    max = "light";
    kinds = ["rest", "walk"];
    because.push(`Sick (${illness.headline}): rest, a walk at most.`);
  } else if (severity === 1) {
    max = "light";
    because.push("Mildly sick: light only.");
  } else if (illness.phase === "recovering" || illness.phase === "early_signs") {
    max = "medium";
    because.push(illness.phase === "recovering" ? "Easing back after being sick: nothing hard." : "Early signs of getting sick: nothing hard.");
  }
  if (readiness?.level === "rest") {
    rest = true;
    max = "light";
    kinds = kinds.filter((kind) => kind === "rest" || kind === "walk" || kind === "mobility");
    because.push(`Readiness says rest: ${readiness.reasons.join(", ")}.`);
  } else if (readiness?.level === "easy") {
    max = lower(max, "medium");
    because.push(`Readiness says easy: ${readiness.reasons.join(", ")}.`);
  }
  // Open injuries and pain (docs/ailments.md). Only a bad (3) one sets hard
  // limits: its region out, nothing hard. The rest Claude weighs: they're
  // listed in `ailments`, and working their muscles past light needs a reason
  // that names them (checkCall).
  const open = (state.physical.ailments?.open ?? []).filter((item) => item.phase === "active" && item.kind !== "illness");
  const resting = new Map<TrackedMuscle, string>();
  for (const item of open) {
    for (const muscle of item.limits.out) if (!resting.has(muscle)) resting.set(muscle, `${item.name.toLowerCase()}, resting`);
    const line = limitsLine(item.limits);
    if (line) because.push(`${item.name} is bad (day ${item.day}): ${line.toLowerCase()}.`);
    if (item.limits.noHard) max = lower(max, "medium");
  }
  const ailments = open.map((item) => ({
    name: item.name,
    severity: severityLabel(item.kind, item.severity),
    day: item.day,
    bodyParts: item.bodyParts,
    affects: item.affects
  }));
  // Next up's rules skip the muscles an ailment affects; here that's Claude's call.
  const weighed = new Set(open.map((item) => item.name.toLowerCase()));
  if (rest) kinds = kinds.filter((kind) => kind !== "strength" && kind !== "cardio");
  const caps = muscleCapsOn(sources.sessions, state.meta.date);
  const outBy = new Map(training.muscles.map((item) => [item.muscle, item.out]));
  const muscles = TRACKED_MUSCLES.map((muscle) => {
    if (resting.has(muscle)) return { muscle, max: null, because: resting.get(muscle)! };
    const out = outBy.get(muscle) ?? null;
    if (out && !weighed.has(out)) return { muscle, max: null, because: out };
    return { muscle, max: lower(max, caps.get(muscle) ?? "hard"), because: null };
  });
  return { rest, maxIntensity: max, allowedKinds: kinds, muscles, ailments, because };
}

// The call the rules make: Training's suggestion with illness and readiness.
export function rulesCall(state: BodyState, madeAt: string): DailyCall {
  const pick = state.physical.training.suggested;
  const brief = morningBrief(state);
  const headline = callOf(state).replace(/^./, (letter) => letter.toUpperCase());
  return {
    kind: pick.name ? "strength" : state.physical.illness.phase === "sick" ? "rest" : "mobility",
    dayType: pick.name,
    work: pick.work,
    accessory: [],
    headline,
    note: [brief.text, pick.note].filter(Boolean).join(" "),
    reasons: state.physical.training.readiness?.reasons ?? [],
    // The rules skip whatever an open injury affects.
    ailments: (state.physical.ailments?.open ?? [])
      .filter((item) => item.phase === "active" && item.kind !== "illness")
      .map((item) => ({ name: item.name, plan: item.affects.length ? `Skipping ${musclesLine(item.affects)} work.` : "Nothing in training loads it." })),
    ask: ailmentAsk(state),
    source: "rules",
    madeAt
  };
}

// The morning's follow-up on open ailments not reported today: "How's the
// right shoulder today?" Every morning until it's over (the owner, Nov 10, 2026).
export function ailmentAsk(state: BodyState): string | null {
  const names = (state.physical.ailments?.open ?? [])
    .filter((item) => item.phase === "active" && item.reportedOn !== state.meta.date)
    .map((item) => item.name.toLowerCase());
  if (!names.length) return null;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and the ${names.at(-1)}` : names[0];
  return `How's the ${list} today?`;
}

// What breaks a guardrail, or null when the call fits.
export function checkCall(call: Pick<DailyCall, "kind" | "work" | "accessory"> & Partial<Pick<DailyCall, "ailments">>, guardrails: Guardrails): string | null {
  if (!guardrails.allowedKinds.includes(call.kind)) return `Kind ${call.kind} isn't allowed today; allowed: ${guardrails.allowedKinds.join(", ")}.`;
  if (call.kind !== "strength" && call.work.length) return "Only a strength call lists muscles to work.";
  if (call.kind === "strength" && !call.work.length) return "A strength call needs muscles to work.";
  const capOf = new Map(guardrails.muscles.map((item) => [item.muscle, item]));
  for (const item of call.work) {
    const cap = capOf.get(item.muscle);
    if (!cap || cap.max == null) return `${item.muscle} is out today (${cap?.because ?? "not allowed"}).`;
    if (RANK[item.intensity] > RANK[cap.max]) return `${item.muscle} can be ${cap.max} at most today.`;
  }
  for (const muscle of call.accessory) {
    if (capOf.get(muscle)?.max == null) return `${muscle} is out today, so it can't be an accessory.`;
  }
  // Each open injury or pain is weighed, and the call says how it treats it
  // (the judgment the evals check).
  for (const ailment of guardrails.ailments ?? []) {
    if (!call.ailments?.some((item) => item.name === ailment.name && item.plan.trim())) {
      return `Say in ailments how today's plan treats the ${ailment.name.toLowerCase()} (${ailment.severity.toLowerCase()}, day ${ailment.day}).`;
    }
  }
  return null;
}

const muscle = z.enum(TRACKED_MUSCLES as unknown as [TrackedMuscle, ...TrackedMuscle[]]);
export const callShape = {
  kind: z.enum(CALL_KINDS),
  day_type: z.string().nullable().describe('For strength: "Push day", "Pull day", "Leg day", "Arm day", "Shoulder day" or your own short name; null otherwise.'),
  work: z.array(z.object({ muscle, intensity: z.enum(INTENSITIES) })).describe("Strength only: the muscles to train and how hard; empty otherwise."),
  accessory: z.array(muscle).describe("A light finisher or two outside the day, or empty."),
  headline: z.string().min(3).max(60).describe('A few words: "Easy pull day", "Rest today".'),
  note: z.string().min(20).max(700).describe("The coach note: 2-4 sentences."),
  reasons: z.array(z.string().max(120)).max(4).describe('Short evidence rows: "Recovery 23, red", "4 drinks last night".'),
  ask: z.string().max(160).nullable().describe("One question for the owner, or null."),
  ailments: z
    .array(z.object({ name: z.string().describe("Exactly as in guardrails.ailments."), plan: z.string().min(3).max(160) }))
    .describe("One per open injury or pain in guardrails.ailments: how today's plan treats it (\"skipping pressing and rows, light band work only\", \"legs don't load it, training as normal\"). Empty when none is open.")
};

export const CALL_STYLE = `Be their coach: warm and supportive, and direct. Say what to do and why in plain words, citing their numbers ("recovery's 23 after the wine and three hard days"). Kind, never preachy or alarmed; on a rough stretch, encourage. No hedging, no exclamation marks, no lists in the note. Times in 12-hour form ("10 pm"). Temperatures in Fahrenheit (a °C difference times 1.8).`;

function callPrompt(today: string) {
  return `You make the owner's training call for today, ${today}, in NutriBot, their private health app. The app has already worked out the facts (the body state) and the limits for today (guardrails). Inside the limits the decision is yours: rest or train, what kind, which day type and muscles, and how hard. The rule-based pick is a sensible default, not an order: change it when their journal, memories or data say something it can't see (journaled knee pain, a big week at work, a goal), and say why in reasons.

How to decide:
- Their body first: illness, readiness and recovery, sleep, what's sore. Then what's due (training.due, days since each day type) and the week's split against its targets. Then their life and goals from the journal and memories.
- A rest or easy day is a good call when the body needs it; say what kind of movement still helps (a walk, mobility).
- Strength muscles take an intensity each, never above their guardrail.
- Heart-rate zone goals (training.zones: this week's workout minutes per zone against the weekly goal, the usual week, the pace): plan cardio toward them. When moderate, vigorous or peak is behind pace and the body allows it, a cardio day or a cardio finisher fits: a steady run or ride for moderate, intervals (4 × 4 minutes hard) for vigorous and peak. Say which zone it's for in the note. Lifting earns little of it. Don't chase minutes on a rest or easy day.
- Open ailments (physical.ailments.open) are yours to weigh. Illness is already in the guardrails, and so is a bad (3) injury, which rests the whole region of its muscles. For a mild or hurting injury or pain, guardrails.ailments lists the muscles whose training loads it; decide how much to spare them from its severity, its day and trend (reportedOn, the days in the journal), what they wrote about it, and what's due. Usually that means skipping them or keeping them light for a few days (light rehab work is fine) and training something else; think about cardio that loads it too (running on a sore knee). Say how the plan treats each one in ailments, and name them in the note.

${CALL_STYLE}

The note is 2-4 sentences: what you see, what to do today, and one thing that helps (sleep, food, water, recovery). ask is one question you want answered this morning, about how they feel or anything that changes today; null if nothing. When an ailment is open and not reported today, ask about it by name ("How's the shoulder this morning?"), in the same one question.

Call submit_call once with the call. If it comes back with an error, fix that and call it again.`;
}

export type Submitted = z.infer<z.ZodObject<typeof callShape>>;

export function toCall(args: Submitted, source: DailyCall["source"], madeAt: string): DailyCall {
  return {
    kind: args.kind,
    dayType: args.kind === "strength" ? args.day_type : null,
    work: args.kind === "strength" ? args.work : [],
    accessory: args.kind === "strength" ? [...new Set(args.accessory)] : [],
    headline: args.headline.trim(),
    note: args.note.trim(),
    reasons: args.reasons,
    ailments: args.ailments ?? [],
    ask: args.ask?.trim() || null,
    source,
    madeAt
  };
}

// The submit_call tool: checks a call against the guardrails and keeps the
// last good one. Shared by the morning call and the chat's revisions.
export function callTool(guardrails: Guardrails, madeAt: string, onCall: (call: DailyCall) => void | Promise<void>, extra: Record<string, z.ZodTypeAny> = {}) {
  return tool(
    "submit_call",
    "Submit today's call. It's checked against the guardrails; an error says what to fix.",
    { ...callShape, ...extra },
    async (args) => {
      const call = toCall(args as Submitted, "claude", madeAt);
      const problem = checkCall(call, guardrails);
      if (problem) return { content: [{ type: "text" as const, text: problem }], isError: true };
      await onCall(call);
      return { content: [{ type: "text" as const, text: "Saved." }] };
    }
  );
}

// Claude's call for a day, or the rules' when Claude fails or breaks a limit.
export async function makeCall(db: Pool, userName: string, state: BodyState, sources: BodySources, guardrails: Guardrails): Promise<DailyCall> {
  const madeAt = localDateTime();
  const fallback = rulesCall(state, madeAt);
  const date = state.meta.date;
  try {
    const [journal, memories] = await Promise.all([
      listJournalEntries(db, userName, addDays(date, -3), date),
      listMemories(db, userName)
    ]);
    const lastEntries = [...journal].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
    let made: DailyCall | null = null;
    const server = "nutribot_call";
    await runClaude({
      system: callPrompt(date),
      prompt: [
        `<body_state>\n${JSON.stringify(state)}\n</body_state>`,
        `<guardrails>\n${JSON.stringify(guardrails)}\n</guardrails>`,
        `<rule_based_pick>\n${JSON.stringify(fallback)}\n</rule_based_pick>`,
        lastEntries.length
          ? `<journal>\n${lastEntries.map((entry) => `${entry.date} ${entry.kind}: ${entry.body}`).join("\n")}\n</journal>`
          : "",
        describeMemories(memories, date)
      ]
        .filter(Boolean)
        .join("\n\n"),
      server: {
        name: server,
        config: createSdkMcpServer({ name: server, version: "1.0.0", tools: [callTool(guardrails, madeAt, (call) => void (made = call))] }),
        tools: ["submit_call"]
      },
      effort: "medium",
      maxTurns: 4
    });
    return made ?? fallback;
  } catch {
    console.error("daily call failed; using the rules");
    return fallback;
  }
}

// ---------- Storage ----------

// The day's call: on the newest version that has one.
export async function getDailyCall(db: Pick<Pool, "query">, userName: string, date: string): Promise<DailyCall | null> {
  const { rows } = await db.query<{ call: DailyCall }>(
    `select call from public.body_states where user_name = $1 and state_date = $2::date and call is not null order by version desc limit 1`,
    [userName, date]
  );
  return rows[0]?.call ?? null;
}

// Puts a call on the day's current version, saving today's state first if
// it changed, so the call sits on the facts it was made from.
export async function saveDailyCall(
  db: Pool,
  userName: string,
  state: BodyState,
  guardrails: Guardrails,
  call: DailyCall,
  trigger: "morning" | "checkin" | "report"
) {
  await saveBodyState(db, userName, state, trigger);
  await db.query(
    `
    update public.body_states set call = $3::jsonb, guardrails = $4::jsonb
    where id = (
      select id from public.body_states where user_name = $1 and state_date = $2::date order by version desc limit 1
    )
    `,
    [userName, state.meta.date, JSON.stringify(call), JSON.stringify(guardrails)]
  );
}

// The morning call is made from this hour, once last night's sleep is in;
// from LATE_HOUR without it. The owner wants it ready at 7.
const CALL_FROM_HOUR = 5;
const LATE_HOUR = 11;

// Makes today's call once, after a sync: claimed in reminder_sends ('daily_call')
// so two syncs at once don't both run Claude. Posts the brief as the first
// message of today's chat. Returns what happened.
export async function ensureDailyCall(db: Pool, userName: string) {
  const now = localDateTime();
  const date = now.slice(0, 10);
  const hour = Number(now.slice(11, 13));
  if (hour < CALL_FROM_HOUR) return { status: "too early" };
  if (await getDailyCall(db, userName, date)) return { status: "already made" };
  const sources = await loadBodySources(db, userName, date);
  const state = buildBodyState(sources, date, { trigger: "morning" });
  if (state.physical.sleep.minutes == null && hour < LATE_HOUR) return { status: "waiting for sleep" };
  const { rows } = await db.query(
    `insert into public.reminder_sends (user_name, local_date, kind) values ($1, $2::date, 'daily_call') on conflict do nothing returning 1`,
    [userName, date]
  );
  if (!rows.length) return { status: "in progress" };
  try {
    const guardrails = guardrailsOf(state, sources);
    const call = await makeCall(db, userName, state, sources, guardrails);
    await saveDailyCall(db, userName, state, guardrails, call, "morning");
    const conversation = await currentConversation(db, userName);
    await appendAssistantMessage(db, userName, conversation, briefMessage(call));
    return { status: "made", source: call.source };
  } catch (error) {
    await db.query(`delete from public.reminder_sends where user_name = $1 and local_date = $2::date and kind = 'daily_call'`, [userName, date]);
    throw error;
  }
}

// The brief as the chat's first message of the day.
export function briefMessage(call: DailyCall) {
  return [`**${call.headline}**`, call.note, call.ask].filter(Boolean).join("\n\n");
}

// "Hard: Lats, Upper Back · Medium: Biceps"
export function workLine(work: DailyCall["work"]) {
  return [...INTENSITIES]
    .reverse()
    .map((intensity) => ({ intensity, muscles: work.filter((item) => item.intensity === intensity).map((item) => item.muscle) }))
    .filter((group) => group.muscles.length)
    .map((group) => `${group.intensity.replace(/^./, (letter) => letter.toUpperCase())}: ${group.muscles.join(", ")}`)
    .join(" · ");
}
