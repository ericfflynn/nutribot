// Ailments: illness, injury and pain as records that last and end. Pure, so
// the browser can use the labels and the body state can use the rules; the
// database and chat tools are in lib/ailments.ts. Spec: docs/ailments.md.
import { addDays } from "./dates";
import { SYMPTOMS } from "./illness-days";
import { MUSCLES, TRACKED_MUSCLES, type Intensity, type TrackedMuscle } from "./workouts";

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

export const ILLNESS_SYMPTOMS = [...SYMPTOMS, "canker sore", "swollen lymph nodes", "tooth pain", "ear pressure"] as const;
export const PAIN_SYMPTOMS = ["sharp", "dull ache", "stiff", "clicking", "weak", "swelling", "numb or tingling"] as const;
export const AILMENT_SYMPTOMS = [...ILLNESS_SYMPTOMS, ...PAIN_SYMPTOMS] as const;

// Upper body is everything an upper-body day loads; a bad (3) injury rests its
// whole region so it can heal.
const UPPER: TrackedMuscle[] = ["Chest", ...MUSCLES.Shoulders, ...MUSCLES.Arms, "Lats", "Upper Back", "Traps"];
const LOWER: TrackedMuscle[] = [...MUSCLES.Legs, "Lower Back"];
const CORE: TrackedMuscle[] = [...MUSCLES.Core, "Lower Back"];
export const REGIONS = { upper: UPPER, lower: LOWER, core: CORE } as const;
export type Region = keyof typeof REGIONS;

// What training each body part takes: the muscles whose work loads it. A sore
// shoulder rests pressing and pulling, not only the delts.
export const BODY_PARTS: Record<string, { muscles: TrackedMuscle[]; region: Region; cardio?: true }> = {
  shoulder: { muscles: ["Chest", "Front Delts", "Side Delts", "Rear Delts", "Triceps", "Lats", "Upper Back", "Traps"], region: "upper" },
  elbow: { muscles: ["Biceps", "Triceps", "Forearms"], region: "upper" },
  wrist: { muscles: ["Forearms", "Biceps", "Lats", "Upper Back", "Traps", "Chest", "Triceps"], region: "upper" },
  hand: { muscles: ["Forearms", "Biceps", "Lats", "Upper Back", "Traps", "Chest", "Triceps"], region: "upper" },
  neck: { muscles: ["Traps", "Upper Back"], region: "upper" },
  "upper back": { muscles: ["Upper Back", "Traps", "Lats"], region: "upper" },
  chest: { muscles: ["Chest", "Obliques"], region: "upper" },
  ribs: { muscles: ["Chest", "Obliques"], region: "core" },
  "lower back": { muscles: ["Lower Back", "Hamstrings", "Glutes"], region: "core" },
  abs: { muscles: ["Upper Abs", "Lower Abs", "Obliques"], region: "core" },
  hip: { muscles: ["Glutes", "Hamstrings", "Quads"], region: "lower" },
  knee: { muscles: ["Quads", "Hamstrings", "Calves"], region: "lower", cardio: true },
  ankle: { muscles: ["Calves", "Quads"], region: "lower", cardio: true },
  foot: { muscles: ["Calves", "Quads"], region: "lower", cardio: true }
};
export const BODY_PART_NAMES = Object.keys(BODY_PARTS);
export const SIDES = ["left", "right"] as const;

// "right shoulder" -> shoulder; "Rear Delts" -> Rear Delts (a muscle).
export function partOf(name: string): string | null {
  const plain = name.trim().toLowerCase().replace(/^(left|right|both)\s+/, "");
  if (BODY_PARTS[plain]) return plain;
  const muscle = TRACKED_MUSCLES.find((item) => item.toLowerCase() === plain || `${item.toLowerCase()}`.replace(/s$/, "") === plain);
  return muscle ?? null;
}

function regionOf(part: string): Region | null {
  if (BODY_PARTS[part]) return BODY_PARTS[part].region;
  const muscle = part as TrackedMuscle;
  return UPPER.includes(muscle) ? "upper" : LOWER.includes(muscle) ? "lower" : CORE.includes(muscle) ? "core" : null;
}

// The muscles a list of body parts limits, in TRACKED_MUSCLES order.
export function musclesFor(bodyParts: readonly string[]): TrackedMuscle[] {
  const set = new Set<TrackedMuscle>();
  for (const name of bodyParts) {
    const part = partOf(name);
    if (!part) continue;
    for (const muscle of BODY_PARTS[part]?.muscles ?? [part as TrackedMuscle]) set.add(muscle);
  }
  return TRACKED_MUSCLES.filter((muscle) => set.has(muscle));
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
  bodyParts: string[]; // "right shoulder"
  muscles: TrackedMuscle[]; // what it limits
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
  limits: AilmentLimits;
  cause: string | null;
};

export type AilmentLimits = {
  out: TrackedMuscle[];
  light: TrackedMuscle[];
  noHard: boolean; // nothing hard anywhere
  easyCardio: boolean; // a knee, ankle or foot: walk or bike, nothing pounding
};

const NO_LIMITS: AilmentLimits = { out: [], light: [], noHard: false, easyCardio: false };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// What an injury or pain does to training at a severity: mild keeps its
// muscles light, hurts takes them out, bad rests its whole region and keeps
// everything off hard. Illness works through the illness phase instead.
export function limitsOf(ailment: Pick<Ailment, "kind" | "bodyParts" | "muscles">, severity: number): AilmentLimits {
  if (ailment.kind === "illness" || severity <= 0) return NO_LIMITS;
  const parts = ailment.bodyParts.map(partOf).filter((part): part is string => Boolean(part));
  const easyCardio = severity >= 2 && parts.some((part) => BODY_PARTS[part]?.cardio);
  if (severity === 1) return { out: [], light: [...ailment.muscles], noHard: false, easyCardio };
  if (severity === 2) return { out: [...ailment.muscles], light: [], noHard: false, easyCardio };
  const regions = new Set(parts.map(regionOf).filter((region): region is Region => Boolean(region)));
  const out = new Set<TrackedMuscle>([...ailment.muscles, ...[...regions].flatMap((region) => REGIONS[region])]);
  return { out: TRACKED_MUSCLES.filter((muscle) => out.has(muscle)), light: [], noHard: true, easyCardio };
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
    return { ...base, day: daysBetween(ailment.startedOn, ended), severity: 0, phase: "easing", limits: NO_LIMITS };
  }
  // No report yet (created ahead of its first day): count it as mild.
  const severity = latest?.severity ?? 1;
  return { ...base, day: daysBetween(ailment.startedOn, date) + 1, severity, phase: "active", limits: limitsOf(ailment, severity) };
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

// Each muscle's limit across every open ailment (the strictest wins), with
// the ailment that set it, plus the day-wide limits. What Next up and the
// guardrails read.
export type MuscleLimit = { max: Intensity | null; because: string };
export type CombinedLimits = {
  muscles: Map<TrackedMuscle, MuscleLimit>;
  noHard: string | null; // the ailment keeping everything off hard
  easyCardio: string | null;
};

export function combinedLimits(open: readonly Pick<OpenAilment, "name" | "limits">[]): CombinedLimits {
  const muscles = new Map<TrackedMuscle, MuscleLimit>();
  let noHard: string | null = null;
  let easyCardio: string | null = null;
  for (const item of open) {
    const tag = item.name.toLowerCase();
    for (const muscle of item.limits.out) muscles.set(muscle, { max: null, because: tag });
    for (const muscle of item.limits.light) if (!muscles.has(muscle)) muscles.set(muscle, { max: "light", because: `${tag}, light only` });
    if (item.limits.noHard) noHard ??= item.name;
    if (item.limits.easyCardio) easyCardio ??= item.name;
  }
  return { muscles, noHard, easyCardio };
}

// "Upper body out", "Chest, Triceps light only": what the limits mean, short.
export function limitsLine(limits: AilmentLimits) {
  const named = (list: TrackedMuscle[]) => {
    for (const [region, muscles] of Object.entries(REGIONS) as [Region, TrackedMuscle[]][]) {
      const label = region === "upper" ? "upper body" : region === "lower" ? "legs" : "core";
      if (muscles.every((muscle) => list.includes(muscle)) && list.every((muscle) => muscles.includes(muscle))) return label;
    }
    const groups = Object.entries(MUSCLES).filter(([, members]) => members.length && (members as readonly TrackedMuscle[]).every((muscle) => list.includes(muscle)));
    const covered = new Set(groups.flatMap(([, members]) => members as readonly string[]));
    return [...groups.map(([group]) => group.toLowerCase()), ...list.filter((muscle) => !covered.has(muscle))].join(", ");
  };
  const parts = [
    limits.out.length ? `${named(limits.out)} out` : null,
    limits.light.length ? `${named(limits.light)} light only` : null,
    limits.noHard ? "nothing hard" : null,
    limits.easyCardio ? "easy cardio only" : null
  ].filter(Boolean);
  const line = parts.join(", ");
  return line ? line.replace(/^./, (letter) => letter.toUpperCase()) : null;
}

// "Right shoulder · day 2, hurts · Upper body out"
export function ailmentLine(item: OpenAilment) {
  if (item.phase === "easing") return `${item.name} · easing back after ${item.day} days`;
  const limits = limitsLine(item.limits);
  return [`${item.name} · day ${item.day}, ${severityLabel(item.kind, item.severity).toLowerCase()}`, limits].filter(Boolean).join(" · ");
}
