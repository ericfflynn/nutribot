// Ailments: illness, injury and pain as records that last and end. Pure, so
// the browser can use the labels and the body state can use the rules; the
// database and chat tools are in lib/ailments.ts. Spec: docs/ailments.md.
import { addDays } from "./dates";
import { SYMPTOMS } from "./illness-days";
import { MUSCLES, TRACKED_MUSCLES, type TrackedMuscle } from "./workouts";

export const AILMENT_KINDS = ["illness", "injury", "pain"] as const;
export type AilmentKind = (typeof AILMENT_KINDS)[number];

// One 0-3 scale for every kind, worded for each. 0 ends it.
export const ILLNESS_SEVERITY = ["Better", "Mild", "Sick", "Very sick"] as const;
export const PAIN_SEVERITY = ["Gone", "Mild", "Hurts", "Bad"] as const;
export const SEVERITY_GUIDES: Record<"illness" | "pain", string[]> = {
  illness: [
    "0 Better: over it",
    "1 Mild: a bit off, a cold above the neck, can go about the day",
    "2 Sick: clearly unwell, below the neck (aches, chest, stomach) or a fever",
    "3 Very sick: in bed"
  ],
  pain: [
    "0 Gone: doesn't hurt any more",
    "1 Mild: noticeable, most movements fine",
    "2 Hurts: some movements hurt",
    "3 Bad: hurts at rest or gets in the way of the day"
  ]
};

export function severityLabel(kind: AilmentKind, severity: number) {
  const labels = kind === "illness" ? ILLNESS_SEVERITY : PAIN_SEVERITY;
  return labels[Math.max(0, Math.min(3, Math.round(severity)))];
}

// Suggested symptoms, not a limit: any plain words are allowed, folded onto
// ones already in use (symptomsInUse in lib/ailments.ts, lib/vocab.ts).
export const ILLNESS_SYMPTOMS = [...SYMPTOMS, "canker sore", "swollen lymph nodes", "tooth pain", "ear pressure"] as const;
export const PAIN_SYMPTOMS = ["sharp", "dull ache", "stiff", "clicking", "weak", "swelling", "numb or tingling"] as const;
export const AILMENT_SYMPTOMS = [...ILLNESS_SYMPTOMS, ...PAIN_SYMPTOMS] as const;

// Upper body is everything an upper-body day loads; a bad (3) injury rests the
// whole region of the muscles it affects so it can heal.
const UPPER: TrackedMuscle[] = ["Chest", ...MUSCLES.Shoulders, ...MUSCLES.Arms, "Lats", "Upper Back", "Traps"];
const LOWER: TrackedMuscle[] = [...MUSCLES.Legs, "Lower Back"];
const CORE: TrackedMuscle[] = [...MUSCLES.Core, "Lower Back"];
export const REGIONS = { upper: UPPER, lower: LOWER, core: CORE } as const;
export type Region = keyof typeof REGIONS;

// The region a muscle belongs to (upper, legs, core; lower back is both).
function regionsOf(muscles: readonly TrackedMuscle[]): Region[] {
  return (Object.keys(REGIONS) as Region[]).filter((region) => muscles.some((muscle) => (REGIONS[region] as readonly TrackedMuscle[]).includes(muscle)));
}

export type CauseRef = { type: "workout" | "habit_log" | "journal"; id: string; label: string };

export type AilmentDay = {
  id: string;
  date: string;
  severity: number;
  symptoms: string[];
  note: string | null;
  journalEntryId: string | null;
};

export type Ailment = {
  id: string;
  kind: AilmentKind;
  name: string;
  bodyParts: string[]; // in their words: "right shoulder", "jaw"
  muscles: TrackedMuscle[]; // the muscles whose work loads it, picked by the chat
  startedOn: string;
  endedOn: string | null; // the day it was over, null while open
  cause: string | null; // the owner's words, or their guess
  causeRefs: CauseRef[];
  note: string | null;
  days: AilmentDay[]; // oldest first
};

// The 2 days after an illness that reached Sick ease back (as illness did).
export const EASE_DAYS = 2;

export type AilmentPhase = "active" | "easing";

export type OpenAilment = {
  id: string;
  kind: AilmentKind;
  name: string;
  bodyParts: string[];
  since: string;
  day: number; // day 1 is the first day
  severity: number; // the latest report; an ailment stays at it until the owner says otherwise
  symptoms: string[];
  phase: AilmentPhase;
  reportedOn: string | null; // the latest report's date
  peak: number;
  // The muscles whose work loads it (an injury or pain): Claude weighs these
  // when it makes the call. Empty for illness.
  affects: TrackedMuscle[];
  limits: AilmentLimits; // the hard limits, only from a bad (3) injury
  cause: string | null;
};

// Hard limits: only a bad (3) injury or pain sets them, resting its whole
// region with nothing hard anywhere (the owner, November 10, 2026). Below 3,
// Claude weighs the ailment when it makes the call.
export type AilmentLimits = { out: TrackedMuscle[]; noHard: boolean };

const NO_LIMITS: AilmentLimits = { out: [], noHard: false };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function limitsOf(ailment: Pick<Ailment, "kind" | "muscles">, severity: number): AilmentLimits {
  if (ailment.kind === "illness" || severity < 3) return NO_LIMITS;
  const out = new Set<TrackedMuscle>([...ailment.muscles, ...regionsOf(ailment.muscles).flatMap((region) => REGIONS[region])]);
  return { out: TRACKED_MUSCLES.filter((muscle) => out.has(muscle)), noHard: true };
}

// Where an ailment stands on `date`, reading only what was known by then.
// Open until a 0 report or its end date: nothing expires on its own (the
// owner, November 10, 2026); the morning check-in asks instead. An illness
// that reached Sick shows as easing for EASE_DAYS after it ends.
export function ailmentOn(ailment: Ailment, date: string): OpenAilment | null {
  if (ailment.startedOn > date) return null;
  const known = ailment.days.filter((day) => day.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const zero = known.find((day) => day.severity === 0 && (!ailment.endedOn || day.date <= ailment.endedOn));
  const ended = [ailment.endedOn, zero?.date].filter((day): day is string => Boolean(day) && day! <= date).sort()[0] ?? null;
  const sick = known.filter((day) => day.severity > 0 && (!ended || day.date < ended));
  const latest = sick.at(-1) ?? null;
  const peak = Math.max(0, ...sick.map((day) => day.severity));
  const base = {
    id: ailment.id,
    kind: ailment.kind,
    name: ailment.name,
    bodyParts: ailment.bodyParts,
    since: ailment.startedOn,
    symptoms: latest?.symptoms ?? [],
    reportedOn: latest?.date ?? null,
    peak,
    cause: ailment.cause
  };
  if (ended) {
    if (ailment.kind !== "illness" || peak < 2 || addDays(ended, EASE_DAYS) <= date) return null;
    return { ...base, day: daysBetween(ailment.startedOn, ended), severity: 0, phase: "easing", affects: [], limits: NO_LIMITS };
  }
  // No report yet (created ahead of its first day): count it as mild.
  const severity = latest?.severity ?? 1;
  const injury = ailment.kind !== "illness";
  return {
    ...base,
    day: daysBetween(ailment.startedOn, date) + 1,
    severity,
    phase: "active",
    affects: injury ? [...ailment.muscles] : [],
    limits: limitsOf(ailment, severity)
  };
}

// Every ailment open or easing on `date`, worst first.
export function openAilmentsOn(ailments: readonly Ailment[], date: string): OpenAilment[] {
  return ailments
    .map((ailment) => ailmentOn(ailment, date))
    .filter((item): item is OpenAilment => Boolean(item))
    .sort((a, b) => Number(b.phase === "active") - Number(a.phase === "active") || b.severity - a.severity || a.since.localeCompare(b.since));
}

// The dates an illness covered up to `date` (for baselines and sleep need):
// every day from its start until it ended.
export function illnessDates(ailments: readonly Ailment[], date: string): Set<string> {
  const dates = new Set<string>();
  for (const ailment of ailments) {
    if (ailment.kind !== "illness" || ailment.startedOn > date) continue;
    const zero = ailment.days.find((day) => day.severity === 0)?.date;
    const end = [ailment.endedOn, zero, addDays(date, 1)].filter((day): day is string => Boolean(day)).sort()[0];
    for (let day = ailment.startedOn; day < end; day = addDays(day, 1)) dates.add(day);
  }
  return dates;
}

// The muscle names a set covers, short: "upper body", "shoulders, chest".
export function musclesLine(list: readonly TrackedMuscle[]) {
  for (const [region, muscles] of Object.entries(REGIONS) as [Region, TrackedMuscle[]][]) {
    const label = region === "upper" ? "upper body" : region === "lower" ? "legs" : "core";
    if (muscles.every((muscle) => list.includes(muscle)) && list.every((muscle) => muscles.includes(muscle))) return label;
  }
  const groups = Object.entries(MUSCLES).filter(([, members]) => members.length && (members as readonly TrackedMuscle[]).every((muscle) => list.includes(muscle)));
  const covered = new Set(groups.flatMap(([, members]) => members as readonly string[]));
  return [...groups.map(([group]) => group), ...list.filter((muscle) => !covered.has(muscle))].map((name) => name.toLowerCase()).join(", ");
}

// "Upper body out, nothing hard": what the hard limits mean, or null.
export function limitsLine(limits: AilmentLimits) {
  const parts = [limits.out.length ? `${musclesLine(limits.out)} out` : null, limits.noHard ? "nothing hard" : null].filter(Boolean);
  const line = parts.join(", ");
  return line ? line.replace(/^./, (letter) => letter.toUpperCase()) : null;
}

// "Right shoulder · day 2, hurts · Upper body out"
export function ailmentLine(item: OpenAilment) {
  if (item.phase === "easing") return `${item.name} · easing back after ${item.day} days`;
  const limits = limitsLine(item.limits);
  return [`${item.name} · day ${item.day}, ${severityLabel(item.kind, item.severity).toLowerCase()}`, limits].filter(Boolean).join(" · ");
}
