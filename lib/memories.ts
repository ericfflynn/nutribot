// Chat memories (docs/brain.md#memory): what the chat keeps about the owner
// between conversations, so it can follow up and connect what's going on with
// their goals and data. Unlike the other chat tools these save right away, no
// card: the reply shows a "Remembered" note the owner can undo. A first
// version, meant to be replaced by a fuller system later.
import { randomUUID } from "crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";

type Queryable = Pick<Pool, "query">;

export const MEMORY_KINDS = ["about", "goal", "ongoing", "pattern"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_STATUSES = ["active", "resolved", "forgotten"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export type Memory = {
  id: string;
  kind: MemoryKind;
  content: string;
  status: MemoryStatus;
  told: boolean; // the owner asked to remember it
  followUpOn: string | null; // a day to ask about it, YYYY-MM-DD
  createdAt: string; // local date
  updatedAt: string;
};

type Fields = Pick<Memory, "kind" | "content" | "status" | "followUpOn">;

// The note a reply carries for each memory it saved or changed. It rides in
// the message's drafts so the sheet can show it, but it isn't a draft: it's
// already saved, and discarded means the owner undid it.
export type MemoryNote = {
  type: "memory";
  id: string;
  memory_id: string;
  action: "saved" | "updated" | "resolved" | "forgotten";
  kind: MemoryKind;
  content: string;
  // What the memory was before this change, so Undo can put it back. Null for a new one.
  previous: Fields | null;
  saved_id: null;
  discarded?: boolean;
};

const SELECT = `id::text, kind, content, status, told, follow_up_on::text as "followUpOn",
  (created_at at time zone $2)::date::text as "createdAt", (updated_at at time zone $2)::date::text as "updatedAt"`;
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
    `insert into public.chat_memories (user_name, kind, content, told, follow_up_on) values ($1, $2, $3, $4, $5::date) returning id::text`,
    [userName, fields.kind, fields.content, told, fields.followUpOn]
  );
  return rows[0].id;
}

export async function setMemory(db: Queryable, userName: string, id: string, fields: Fields) {
  const { rowCount } = await db.query(
    `
    update public.chat_memories
    set kind = $3, content = $4, status = $5, follow_up_on = $6::date, updated_at = now(),
      resolved_at = case when $5 = 'active' then null when status = $5 then resolved_at else now() end
    where user_name = $1 and id = $2::uuid
    `,
    [userName, id, fields.kind, fields.content, fields.status, fields.followUpOn]
  );
  if (!rowCount) throw new Error("That memory no longer exists.");
}

// Undo a note: a new memory is forgotten, a change goes back to what it was.
export async function undoMemoryNote(db: Queryable, userName: string, note: MemoryNote) {
  const current = await getMemory(db, userName, note.memory_id);
  if (!current) throw new Error("That memory no longer exists.");
  await setMemory(db, userName, note.memory_id, note.previous ?? { ...current, status: "forgotten" });
}

const KIND_LABELS: Record<MemoryKind, string> = { about: "about them", goal: "goal", ongoing: "ongoing", pattern: "pattern" };

// The block each turn starts with: every active memory, follow-ups due first.
export function describeMemories(memories: Memory[], today: string) {
  if (!memories.length) return "";
  const due = memories.filter((memory) => memory.followUpOn && memory.followUpOn <= today);
  const line = (memory: Memory) =>
    `- [${memory.id}] (${KIND_LABELS[memory.kind]}, since ${memory.createdAt}${memory.followUpOn ? `, follow up ${memory.followUpOn}` : ""}) ${memory.content}`;
  const parts = [`<memories>\n${memories.map(line).join("\n")}\n</memories>`];
  if (due.length) parts.push(`<follow_ups_due>\n${due.map(line).join("\n")}\n</follow_ups_due>`);
  return parts.join("\n\n");
}

export const MEMORY_TOOLS = ["remember", "update_memory", "list_memories"];

export const MEMORY_PROMPT = `## Memory
- You keep memories about the owner between conversations; every turn starts with the active ones in <memories>. Each chat otherwise starts fresh every day, so anything worth carrying past today goes in a memory.
- remember saves one right away (no card; the reply shows a small "Remembered" note they can undo, so don't announce it). Save what will matter later: people in their life and who they are, work and what it involves, situations still going on (a stressful launch, a trip, an injury, a hard stretch with someone), goals and why they hold them, preferences about how they want help, and patterns they agree with ("sleeps badly after late gaming"). Kinds: about (lasting facts), goal, ongoing (situations that end), pattern.
- Don't save what's already logged (meals, workouts, habits, journal entries, sick days) or passing details of one day. One fact per memory, in a sentence that stands on its own and with dates resolved ("Product launch at work through Nov 20; main stressor this month").
- When they say "remember …", always save it (told: true), in their meaning.
- Before saving, check <memories>: when one already covers it, update_memory instead of adding a second. When an ongoing situation ends, mark it resolved; when something is wrong or they ask you to forget it, mark it forgotten.
- follow_up_on is a day to ask about something ("interview Thursday" → that Thursday, or the day after). <follow_ups_due> lists the ones due: ask about one naturally when the conversation allows, early in a day's first conversation or when it fits, not as a checklist. After asking, update it: clear follow_up_on, resolve it, or move it.
- Use memories to connect the dots: tie how they feel and what the data shows to what's going on in their life and to their goals ("recovery has been red all week, the same week as the launch"), and check behavior against goals. Bring something up unprompted when it helps; don't recite memories back.
- "What do you remember about me" or "what do you know about X": answer from <memories>; list_memories also shows resolved ones.`;

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
    .describe("A day to ask about it, YYYY-MM-DD; null for none.");

  const remember = tool(
    "remember",
    "Save a memory about the owner right away. One fact per call.",
    {
      kind: z.enum(MEMORY_KINDS),
      content: z.string().min(3).max(400).describe("One fact that stands on its own, with dates resolved."),
      follow_up_on: followUp,
      told: z.boolean().describe("True when they asked you to remember it.")
    },
    async (args) => {
      const fields = { kind: args.kind, content: args.content.trim(), followUpOn: args.follow_up_on };
      const memoryId = dryRun ? "dry-run" : await addMemory(db, userName, fields, args.told);
      putNote({ type: "memory", id: randomUUID(), memory_id: memoryId, action: "saved", kind: args.kind, content: fields.content, previous: null, saved_id: null });
      return text({ memory_id: memoryId, saved: true });
    }
  );

  const updateMemory = tool(
    "update_memory",
    "Change a saved memory: new wording, kind or follow-up day, or status resolved (an ongoing situation is over) or forgotten (wrong, or they asked you to forget it). Fields left out stay as they are.",
    {
      memory_id: z.string().describe("The id in brackets from <memories> or list_memories."),
      kind: z.enum(MEMORY_KINDS).optional(),
      content: z.string().min(3).max(400).optional(),
      follow_up_on: followUp.optional(),
      status: z.enum(MEMORY_STATUSES).optional()
    },
    async (args) => {
      const current = await getMemory(db, userName, args.memory_id);
      if (!current) return { ...text(`No memory ${args.memory_id}.`), isError: true };
      const previous: Fields = { kind: current.kind, content: current.content, status: current.status, followUpOn: current.followUpOn };
      const next: Fields = {
        kind: args.kind ?? current.kind,
        content: args.content?.trim() ?? current.content,
        status: args.status ?? current.status,
        followUpOn: args.follow_up_on !== undefined ? args.follow_up_on : current.followUpOn
      };
      if (!dryRun) await setMemory(db, userName, current.id, next);
      // Only clearing or moving a follow-up after asking isn't worth a note.
      const quiet = next.kind === previous.kind && next.content === previous.content && next.status === previous.status;
      if (!quiet) {
        const action = next.status === "forgotten" ? "forgotten" : next.status === "resolved" && previous.status !== "resolved" ? "resolved" : "updated";
        putNote({ type: "memory", id: randomUUID(), memory_id: current.id, action, kind: next.kind, content: next.content, previous, saved_id: null });
      }
      return text({ memory_id: current.id, ...next });
    }
  );

  const listMemoriesTool = tool(
    "list_memories",
    "List memories, active by default; include_resolved adds situations that are over.",
    { include_resolved: z.boolean() },
    async (args) => {
      const memories = await listMemories(db, userName, args.include_resolved ? ["active", "resolved"] : ["active"]);
      if (!memories.length) return text("No memories yet.");
      return text(
        memories
          .map((memory) => `[${memory.id}] ${memory.status} ${memory.kind}, since ${memory.createdAt}${memory.followUpOn ? `, follow up ${memory.followUpOn}` : ""}: ${memory.content}`)
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
