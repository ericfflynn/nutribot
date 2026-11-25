// The pure side of chat memories (docs/memory.md): kinds, areas, what's live
// on a day and where each memory goes. No database or SDK, so the body state
// and tests can use it.
import { addDays } from "./dates";
import type { WeighIn } from "./health/queries";

export const MEMORY_KINDS = ["preference", "situation", "goal", "fact", "pattern"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_STATUSES = ["active", "resolved", "forgotten"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
// Where a memory is used: body-state areas, and `chat` for how the chat talks to them.
export const MEMORY_AREAS = [
  "physical.training",
  "physical.sleep",
  "physical.recovery",
  "physical.fuel",
  "physical.ailments",
  "mental.mood",
  "lifestyle.career",
  "lifestyle.relationships",
  "lifestyle.habits",
  "chat"
] as const;
export type MemoryArea = (typeof MEMORY_AREAS)[number];
// A goal's number code can measure. Weight only for now.
export const GOAL_METRICS = ["weight_lb"] as const;
export type GoalTarget = { metric: (typeof GOAL_METRICS)[number]; target: number };

// A situation fades this many days after its review date (or its last
// update, if later) when nothing has touched it.
export const STALE_AFTER_DAYS = 7;
// A situation saved without a review date (from before v2) gets one this long after its last update.
const DEFAULT_REVIEW_DAYS = 14;
// Facts ride in every chat turn while there are this many or fewer; past that, search finds them.
export const CORE_FACTS_MAX = 20;

export type Memory = {
  id: string;
  kind: MemoryKind;
  content: string;
  status: MemoryStatus;
  told: boolean; // the owner asked to remember it
  followUpOn: string | null; // a day to ask about it; a situation's review date, YYYY-MM-DD
  areas: MemoryArea[];
  target: GoalTarget | null;
  createdAt: string; // local date
  updatedAt: string;
  resolvedAt: string | null; // local date it was resolved or forgotten
};

export type Fields = Pick<Memory, "kind" | "content" | "status" | "followUpOn" | "areas" | "target">;

// The note a reply carries for each memory it saved or changed. It rides in
// the message's drafts so the sheet can show it, but it isn't a draft: it's
// already saved, and discarded means the owner undid it. Notes from before v2
// (Nov 24, 2026) carry v1 kinds and no areas or target.
export type MemoryNote = {
  type: "memory";
  id: string;
  memory_id: string;
  action: "saved" | "updated" | "resolved" | "forgotten";
  kind: MemoryKind | "about" | "ongoing";
  content: string;
  // What the memory was before this change, so Undo can put it back. Null for a new one.
  previous: (Omit<Fields, "areas" | "target" | "kind"> & Partial<Pick<Fields, "areas" | "target">> & { kind: string }) | null;
  saved_id: null;
  discarded?: boolean;
};

// ---------- What's live, and where it goes ----------

// The day a situation stops being live when nothing touches it.
export function staleOn(memory: Pick<Memory, "kind" | "followUpOn" | "updatedAt">): string | null {
  if (memory.kind !== "situation") return null;
  const review = memory.followUpOn ?? addDays(memory.updatedAt, DEFAULT_REVIEW_DAYS);
  const from = review > memory.updatedAt ? review : memory.updatedAt;
  return addDays(from, STALE_AFTER_DAYS + 1);
}

// Live on a day: saved by then, not yet resolved or forgotten on it, and for
// a situation, not stale. Works for past days too (the body state is rebuilt).
export function isLive(memory: Memory, date: string): boolean {
  if (memory.createdAt > date) return false;
  if (memory.status !== "active" && (memory.resolvedAt == null || memory.resolvedAt <= date)) return false;
  const stale = staleOn(memory);
  return stale == null || date < stale;
}

// The memories every chat turn starts with: active goals, live situations,
// how to talk to them, and facts while there are few.
export function coreMemories(memories: Memory[], today: string): Memory[] {
  const live = memories.filter((memory) => isLive(memory, today));
  const facts = live.filter((memory) => memory.kind === "fact");
  return live.filter(
    (memory) =>
      memory.kind === "goal" ||
      memory.kind === "situation" ||
      (memory.kind === "fact" && facts.length <= CORE_FACTS_MAX) ||
      memory.areas.includes("chat")
  );
}

// Live memories tagged with any of the areas, optionally of some kinds only.
export function memoriesFor(memories: Memory[], areas: readonly MemoryArea[], today: string, kinds?: readonly MemoryKind[]): Memory[] {
  return memories.filter(
    (memory) => isLive(memory, today) && memory.areas.some((area) => areas.includes(area)) && (!kinds || kinds.includes(memory.kind))
  );
}

// Where a goal with a weight target stands: the latest weigh-in, the change
// over about 30 days, and what's left.
export function goalProgress(memory: Pick<Memory, "target">, weighIns: readonly WeighIn[]): string | null {
  if (memory.target?.metric !== "weight_lb" || !weighIns.length) return null;
  const sorted = [...weighIns].sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted.at(-1)!;
  const monthAgo = [...sorted].reverse().find((item) => item.day <= addDays(latest.day, -28));
  const toGo = Math.round((latest.pounds - memory.target.target) * 10) / 10;
  const change = monthAgo ? Math.round((latest.pounds - monthAgo.pounds) * 10) / 10 : null;
  return [
    `${latest.pounds} lb on ${latest.day}`,
    change != null ? `${change > 0 ? "up" : change < 0 ? "down" : "flat"}${change ? ` ${Math.abs(change)}` : ""} since ${monthAgo!.day}` : null,
    toGo === 0 ? "at the target" : `${Math.abs(toGo)} lb ${toGo > 0 ? "above" : "below"} the target`
  ]
    .filter(Boolean)
    .join(", ");
}

const KIND_LABELS: Record<MemoryKind, string> = { preference: "preference", situation: "situation", goal: "goal", fact: "fact", pattern: "pattern" };

// One memory as a line: id, kind, areas, dates, then the memory.
export function memoryLine(memory: Memory, progress?: string | null) {
  const facts = [
    KIND_LABELS[memory.kind],
    memory.areas.length ? memory.areas.join(", ") : null,
    `since ${memory.createdAt}`,
    memory.followUpOn ? `${memory.kind === "situation" ? "review" : "follow up"} ${memory.followUpOn}` : null
  ].filter(Boolean);
  const target = memory.target ? ` [target ${memory.target.target} lb${progress ? `: ${progress}` : ""}]` : "";
  return `- [${memory.id}] (${facts.join("; ")}) ${memory.content}${target}`;
}

// The block each chat turn starts with: the core, then the follow-ups due
// (any live memory whose day has come).
export function describeMemories(
  memories: Memory[],
  today: string,
  options: { weighIns?: readonly WeighIn[]; others?: number } = {}
) {
  const core = coreMemories(memories, today);
  const due = memories.filter((memory) => isLive(memory, today) && memory.followUpOn && memory.followUpOn <= today);
  const line = (memory: Memory) => memoryLine(memory, goalProgress(memory, options.weighIns ?? []));
  const others = options.others ?? memories.filter((memory) => isLive(memory, today)).length - core.length;
  const parts: string[] = [];
  if (core.length) {
    parts.push(
      `<memories>\n${core.map(line).join("\n")}${others > 0 ? `\n(${others} more, by area: they come with the tools for their area, and list_memories finds them.)` : ""}\n</memories>`
    );
  } else if (others > 0) {
    parts.push(`<memories>\n(${others} memories, by area: they come with the tools for their area, and list_memories finds them.)\n</memories>`);
  }
  if (due.length) parts.push(`<follow_ups_due>\n${due.map((memory) => memoryLine(memory)).join("\n")}\n</follow_ups_due>`);
  return parts.join("\n\n");
}

// The memories a tool's result carries: what's live in its areas, as lines.
// Empty when there are none, so a result can leave the field out.
export function recallFor(memories: Memory[], today: string) {
  return (areas: readonly MemoryArea[], kinds?: readonly MemoryKind[]) => memoriesFor(memories, areas, today, kinds).map((memory) => memoryLine(memory));
}
export type Recall = ReturnType<typeof recallFor>;

// What code checks a memory has: areas, a review day for a situation, a target only on a goal.
export function checkMemory(fields: Pick<Fields, "kind" | "areas" | "followUpOn" | "target">): string | null {
  if (!fields.areas.length) return "Give at least one area.";
  if (fields.kind === "situation" && !fields.followUpOn) return "A situation needs follow_up_on, its review day.";
  if (fields.target && fields.kind !== "goal") return "Only a goal has a target.";
  return null;
}

