// Chat memories (docs/memory.md): what the chat keeps about the owner between
// conversations. Each memory has a kind, which says how long it lasts
// (preference, situation, goal, fact, pattern), and areas, which say where it's
// used: body-state paths plus `chat`. Code delivers each memory to whatever
// needs it (the chat's core, a tool's result, the morning call, the body
// state); Claude decides what to save and how to tag it. Saves are instant,
// no card: the reply shows a "Remembered" note the owner can undo.
import { randomUUID } from "crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { todayLocalDate } from "./dates";
import {
  GOAL_METRICS,
  MEMORY_AREAS,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  checkMemory,
  isLive,
  memoryLine,
  type Fields,
  type Memory,
  type MemoryKind,
  type MemoryNote,
  type MemoryStatus
} from "./memories-core";

export * from "./memories-core";

type Queryable = Pick<Pool, "query">;

const SELECT = `id::text, kind, content, status, told, follow_up_on::text as "followUpOn", areas, target,
  (created_at at time zone $2)::date::text as "createdAt", (updated_at at time zone $2)::date::text as "updatedAt",
  (resolved_at at time zone $2)::date::text as "resolvedAt"`;
const zone = () => process.env.APP_TIME_ZONE || "America/New_York";

export async function listMemories(db: Queryable, userName: string, statuses: MemoryStatus[] = ["active"]): Promise<Memory[]> {
  const { rows } = await db.query<Memory>(
    `select ${SELECT} from public.chat_memories where user_name = $1 and status = any($3) order by created_at`,
    [userName, zone(), statuses]
  );
  return rows;
}

async function getMemory(db: Queryable, userName: string, id: string) {
  const { rows } = await db.query<Memory>(`select ${SELECT} from public.chat_memories where user_name = $1 and id = $3::uuid`, [
    userName,
    zone(),
    id
  ]);
  return rows[0] ?? null;
}

async function addMemory(db: Queryable, userName: string, fields: Omit<Fields, "status">, told: boolean) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.chat_memories (user_name, kind, content, told, follow_up_on, areas, target)
     values ($1, $2, $3, $4, $5::date, $6::text[], $7::jsonb) returning id::text`,
    [userName, fields.kind, fields.content, told, fields.followUpOn, fields.areas, fields.target ? JSON.stringify(fields.target) : null]
  );
  return rows[0].id;
}

export async function setMemory(db: Queryable, userName: string, id: string, fields: Fields) {
  const { rowCount } = await db.query(
    `
    update public.chat_memories
    set kind = $3, content = $4, status = $5, follow_up_on = $6::date, areas = $7::text[], target = $8::jsonb, updated_at = now(),
      resolved_at = case when $5 = 'active' then null when status = $5 then resolved_at else now() end
    where user_name = $1 and id = $2::uuid
    `,
    [userName, id, fields.kind, fields.content, fields.status, fields.followUpOn, fields.areas, fields.target ? JSON.stringify(fields.target) : null]
  );
  if (!rowCount) throw new Error("That memory no longer exists.");
}

// Undo a note: a new memory is forgotten, a change goes back to what it was.
// A note from before v2 has a v1 kind and no areas: those stay as they are now.
export async function undoMemoryNote(db: Queryable, userName: string, note: MemoryNote) {
  const current = await getMemory(db, userName, note.memory_id);
  if (!current) throw new Error("That memory no longer exists.");
  const previous = note.previous;
  const restored: Fields = previous
    ? {
        ...current,
        ...previous,
        kind: (MEMORY_KINDS as readonly string[]).includes(previous.kind) ? (previous.kind as MemoryKind) : current.kind,
        areas: previous.areas ?? current.areas,
        target: previous.target !== undefined ? previous.target : current.target
      }
    : { ...current, status: "forgotten" };
  await setMemory(db, userName, note.memory_id, restored);
}

// ---------- Prompt and tools ----------

export const MEMORY_TOOLS = ["remember", "update_memory", "list_memories"];

export const MEMORY_PROMPT = `## Memory
- You keep memories about the owner between conversations. Each chat starts fresh every day, so anything worth carrying past today goes in a memory. remember saves one right away (no card; the reply shows a small "Remembered" note they can undo, so don't announce it).
- Kinds, each with its own life:
  - preference: how they like things done (training, food, how you talk to them). Lasts until they change it.
  - situation: something going on that colors stress, mood, sleep or energy (a rough patch with their partner, a launch at work, a move, a sick parent). Always give follow_up_on as its review day: a week for a deadline, about two weeks for a rough stretch. It fades a week after that day unless it's updated.
  - goal: something they're working toward. A weight goal gets target { metric: "weight_lb", target }; anything else stays words.
  - fact: lasting background (people and who they are, their job, history).
  - pattern: a cause and effect they agree with ("sleeps badly after late gaming").
- areas say where it's used, one or more: physical.training, physical.sleep, physical.recovery, physical.fuel, physical.ailments, mental.mood, lifestyle.career, lifestyle.relationships, lifestyle.habits, and chat (how you talk to them, used in every turn). A training preference is physical.training; a rough patch at home is lifestyle.relationships and mental.mood.
- Save one when:
  - They push back on or react to a recommendation: the training call, a training answer, meal advice ("I don't like pull after heavy chest", "stop suggesting oatmeal"). That's a preference in its area. It isn't app feedback; file feedback only when the app itself is broken or should work differently, and then save the preference too if there is one.
  - They mention something going on that affects how they feel: a situation.
  - They say what they want to reach: a goal.
  - They mention a person, their job or their history for the first time: a fact.
  - They agree with a pattern you or the data point out: a pattern.
  - They say "remember …": always (told: true), in their meaning.
- Don't save what's already logged (meals, workouts, habits, journal entries, ailments) or passing details of one day. One memory per call, a sentence that stands on its own, with dates resolved ("Tension at home with their partner since Nov 20; a likely stressor").
- <memories> holds the core: goals, live situations, chat preferences, and facts while there are few. The rest come with the tools for their area (get_body_state, list_workouts and draft_workout, draft_meal and get_goals, list_habits and draft_habits carry a memories field): follow those preferences. When a person, place or past event comes up that you don't know, search with list_memories.
- Before saving, check <memories> and the tool results: when one already covers it, update_memory instead of adding a second. When a situation ends or a goal is reached or dropped, mark it resolved; when something is wrong or they ask you to forget it, mark it forgotten.
- follow_up_on is also a day to ask about anything ("interview Thursday" → that Thursday). <follow_ups_due> lists the ones due: ask about one naturally when the conversation allows, early in a day's first conversation or when it fits, not as a checklist. After asking, update it: move the day, resolve it, or clear it (a situation always keeps a day).
- Use memories to connect the dots: tie how they feel and what the data shows to what's going on and to their goals ("recovery has been low all week, the same week as the launch"; "protein's been short three days, and the 180 goal needs it"). Bring something up unprompted when it helps; don't recite memories back.
- "What do you remember about me" or "what do you know about X": list_memories (resolved ones too on request).`;

const targetSchema = z
  .object({ metric: z.enum(GOAL_METRICS), target: z.number().min(50).max(500) })
  .nullable()
  .describe('A goal\'s number: { metric: "weight_lb", target: 180 }. Null for anything else.');

export function memoryTools({
  db,
  userName,
  putNote,
  dryRun = false
}: {
  db: Pool;
  userName: string;
  putNote: (note: MemoryNote) => void;
  // npm run brain: report what would be saved without writing it.
  dryRun?: boolean;
}) {
  const followUp = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe("A day to ask about it, YYYY-MM-DD; a situation's review day (required for one). Null for none.");
  const areas = z.array(z.enum(MEMORY_AREAS)).min(1).max(4).describe("Where it's used: body-state areas, or chat.");

  const remember = tool(
    "remember",
    "Save a memory about the owner right away. One per call.",
    {
      kind: z.enum(MEMORY_KINDS),
      content: z.string().min(3).max(400).describe("One memory that stands on its own, with dates resolved."),
      areas,
      follow_up_on: followUp,
      target: targetSchema,
      told: z.boolean().describe("True when they asked you to remember it.")
    },
    async (args) => {
      const fields = { kind: args.kind, content: args.content.trim(), followUpOn: args.follow_up_on, areas: [...new Set(args.areas)], target: args.target };
      const problem = checkMemory(fields);
      if (problem) return { ...text(problem), isError: true };
      const memoryId = dryRun ? "dry-run" : await addMemory(db, userName, fields, args.told);
      putNote({ type: "memory", id: randomUUID(), memory_id: memoryId, action: "saved", kind: args.kind, content: fields.content, previous: null, saved_id: null });
      return text({ memory_id: memoryId, saved: true, ...fields });
    }
  );

  const updateMemory = tool(
    "update_memory",
    "Change a saved memory: wording, kind, areas, follow-up day, target, or status resolved (a situation is over, a goal reached or dropped) or forgotten (wrong, or they asked you to forget it). Fields left out stay as they are.",
    {
      memory_id: z.string().describe("The id in brackets from <memories>, a tool's memories or list_memories."),
      kind: z.enum(MEMORY_KINDS).optional(),
      content: z.string().min(3).max(400).optional(),
      areas: areas.optional(),
      follow_up_on: followUp.optional(),
      target: targetSchema.optional(),
      status: z.enum(MEMORY_STATUSES).optional()
    },
    async (args) => {
      const current = await getMemory(db, userName, args.memory_id);
      if (!current) return { ...text(`No memory ${args.memory_id}.`), isError: true };
      const previous: Fields = {
        kind: current.kind,
        content: current.content,
        status: current.status,
        followUpOn: current.followUpOn,
        areas: current.areas,
        target: current.target
      };
      const next: Fields = {
        kind: args.kind ?? current.kind,
        content: args.content?.trim() ?? current.content,
        status: args.status ?? current.status,
        followUpOn: args.follow_up_on !== undefined ? args.follow_up_on : current.followUpOn,
        areas: args.areas ? [...new Set(args.areas)] : current.areas,
        target: args.target !== undefined ? args.target : current.target
      };
      // Resolving or forgetting doesn't need a review day or areas.
      const problem = next.status === "active" ? checkMemory(next) : null;
      if (problem) return { ...text(problem), isError: true };
      if (!dryRun) await setMemory(db, userName, current.id, next);
      // Only moving a follow-up after asking isn't worth a note.
      const quiet =
        next.kind === previous.kind &&
        next.content === previous.content &&
        next.status === previous.status &&
        next.areas.join() === previous.areas.join() &&
        JSON.stringify(next.target) === JSON.stringify(previous.target);
      if (!quiet) {
        const action = next.status === "forgotten" ? "forgotten" : next.status === "resolved" && previous.status !== "resolved" ? "resolved" : "updated";
        putNote({ type: "memory", id: randomUUID(), memory_id: current.id, action, kind: next.kind, content: next.content, previous, saved_id: null });
      }
      return text({ memory_id: current.id, ...next });
    }
  );

  const listMemoriesTool = tool(
    "list_memories",
    "Find memories: all live ones, or those in some areas, of some kinds, or containing every word of search (a name, a place, \"knee\"). include_resolved adds ones that are over and situations gone stale.",
    {
      areas: z.array(z.enum(MEMORY_AREAS)).describe("Only these areas; empty for any."),
      kinds: z.array(z.enum(MEMORY_KINDS)).describe("Only these kinds; empty for any."),
      search: z.string().nullable().describe("Words the memory must contain, or null."),
      include_resolved: z.boolean()
    },
    async (args) => {
      const all = await listMemories(db, userName, args.include_resolved ? ["active", "resolved"] : ["active"]);
      const today = todayLocalDate();
      const words = (args.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const found = all.filter(
        (memory) =>
          (args.include_resolved || isLive(memory, today)) &&
          (!args.areas.length || memory.areas.some((area) => args.areas.includes(area))) &&
          (!args.kinds.length || args.kinds.includes(memory.kind)) &&
          words.every((word) => memory.content.toLowerCase().includes(word))
      );
      if (!found.length) return text(all.length ? "No memories match." : "No memories yet.");
      return text(
        found
          .map((memory) => {
            const state = memory.status !== "active" ? memory.status : isLive(memory, today) ? null : "stale";
            return `${memoryLine(memory)}${state ? ` (${state})` : ""}`;
          })
          .join("\n")
      );
    },
    { annotations: { readOnlyHint: true } }
  );

  return [remember, updateMemory, listMemoriesTool];
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}
