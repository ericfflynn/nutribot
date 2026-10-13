// The app feedback queue: bugs, ideas and changes the owner mentions in chat
// ("the sessions card is redundant"), saved for the next dev pass. Same
// draft-then-Save contract as the other chat tools. Read them with
// `npm run feedback`; see AGENTS.md.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Pool } from "pg";
import { z } from "zod";

type Queryable = Pick<Pool, "query">;

export const FEEDBACK_KINDS = ["bug", "idea", "change"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_AREAS = ["today", "chat", "training", "habits", "journal", "reminders", "health", "other"] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];
export const FEEDBACK_STATUSES = ["open", "done", "dropped"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackInput = {
  kind: FeedbackKind;
  area: FeedbackArea;
  title: string; // one line: "Drop the Sessions card on Training"
  details: string; // their words, lightly cleaned up
};

export type Feedback = FeedbackInput & { id: string; status: FeedbackStatus; createdAt: string; resolvedAt: string | null; note: string | null };

// A new item, or a change to a saved one (feedback_id set): new wording,
// or a status of done or dropped ("forget that idea").
export type FeedbackDraft = FeedbackInput & {
  type: "feedback";
  id: string;
  feedback_id?: string | null;
  status?: FeedbackStatus;
  saved_id: string | null;
  discarded?: boolean;
};

export async function saveFeedback(
  db: Queryable,
  userName: string,
  input: FeedbackInput & { status?: FeedbackStatus },
  id?: string | null
) {
  if (id) {
    const { rows } = await db.query<{ id: string }>(
      `
      update public.app_feedback
      set kind = $3, area = $4, title = $5, details = $6, status = $7,
        resolved_at = case when $7 = 'open' then null when status = $7 then resolved_at else now() end
      where id = $1::uuid and user_name = $2
      returning id::text
      `,
      [id, userName, input.kind, input.area, input.title, input.details, input.status ?? "open"]
    );
    if (!rows[0]) throw new Error("That feedback item no longer exists.");
    return rows[0].id;
  }
  const { rows } = await db.query<{ id: string }>(
    `
    insert into public.app_feedback (user_name, kind, area, title, details)
    values ($1, $2, $3, $4, $5)
    returning id::text
    `,
    [userName, input.kind, input.area, input.title, input.details]
  );
  return rows[0].id;
}

export async function listFeedback(db: Queryable, userName: string | null, statuses: FeedbackStatus[] = ["open"]): Promise<Feedback[]> {
  const { rows } = await db.query<Feedback>(
    `
    select id::text, kind, area, title, details, status, note,
      created_at::text as "createdAt", resolved_at::text as "resolvedAt"
    from public.app_feedback
    where ($1::text is null or user_name = $1) and status = any($2)
    order by created_at
    `,
    [userName, statuses]
  );
  return rows;
}

// Marks items done or dropped (or open again) at the end of a dev pass.
export async function resolveFeedback(db: Queryable, ids: string[], status: FeedbackStatus, note: string | null) {
  const { rowCount } = await db.query(
    `
    update public.app_feedback
    set status = $2, note = coalesce($3, note), resolved_at = case when $2 = 'open' then null else now() end
    where id::text like any($1)
    `,
    [ids.map((id) => `${id}%`), status, note]
  );
  return rowCount ?? 0;
}

export const FEEDBACK_TOOLS = ["draft_feedback", "list_feedback"];

export const FEEDBACK_PROMPT = `## App feedback
- When they say something about the app itself (a bug, something confusing, a feature they want, a change to a screen), call draft_feedback. One draft per distinct item; a message with three ideas is three drafts. Keep details in their words; the title is a short imperative line ("Drop the Sessions card on Training").
- kind: bug when something is broken or wrong, change when an existing screen should work differently, idea for something new. area is the tab or feature it's about.
- Don't argue with or design the feedback; just capture it and say it's queued for the next dev pass. If it's ambiguous which screen they mean, ask once.
- list_feedback answers "what's in my queue" or "what did I ask for", and gives each item's id.
- To change a saved item (reword it, or mark it done or dropped when they say it's handled or no longer wanted), call list_feedback, then draft_feedback with feedback_id and the item's full content plus the new status. Items are never deleted; dropped is the "delete", and keeps the history.`;

type DraftSlot = { id: string } | { error: string };

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

export function feedbackTools(context: {
  db: Pool;
  userName: string;
  resolveDraftId: (replaces: string | undefined) => DraftSlot;
  putDraft: (draft: FeedbackDraft) => void;
}) {
  const { db, userName, resolveDraftId, putDraft } = context;

  const draftFeedback = tool(
    "draft_feedback",
    "Create or revise a draft that queues one piece of app feedback (bug, change or idea) for the next dev pass.",
    {
      kind: z.enum(FEEDBACK_KINDS),
      area: z.enum(FEEDBACK_AREAS),
      title: z.string().min(1).max(120),
      details: z.string().min(1).max(2000).describe("Their words, lightly cleaned up."),
      feedback_id: z.string().nullable().describe("A saved item to change, from list_feedback; null for a new one."),
      status: z.enum(FEEDBACK_STATUSES).describe("open for new items; done or dropped to close a saved one."),
      replaces: z.string().optional().describe("Id of an open draft this revises.")
    },
    async (args) => {
      const target = resolveDraftId(args.replaces);
      if ("error" in target) return { ...text(target.error), isError: true };
      if (args.feedback_id) {
        const existing = await listFeedback(db, userName, [...FEEDBACK_STATUSES]);
        if (!existing.some((item) => item.id === args.feedback_id)) {
          return { ...text(`No feedback item with id ${args.feedback_id}. Call list_feedback.`), isError: true };
        }
      }
      putDraft({
        feedback_id: args.feedback_id,
        status: args.status,
        type: "feedback",
        id: target.id,
        kind: args.kind,
        area: args.area,
        title: args.title.trim(),
        details: args.details.trim(),
        saved_id: null
      });
      return text({ draft_id: target.id });
    }
  );

  const listFeedbackTool = tool(
    "list_feedback",
    "List queued app feedback, oldest first. Open items by default.",
    { include_resolved: z.boolean() },
    async (args) => {
      const items = await listFeedback(db, userName, args.include_resolved ? [...FEEDBACK_STATUSES] : ["open"]);
      if (!items.length) return text("The feedback queue is empty.");
      return text(
        items
          .map(
            (item) =>
              `${item.createdAt.slice(0, 10)} [${item.status}] ${item.kind}/${item.area}: ${item.title} — ${item.details}${item.note ? ` (note: ${item.note})` : ""} (id ${item.id})`
          )
          .join("\n")
      );
    },
    { annotations: { readOnlyHint: true } }
  );

  return [draftFeedback, listFeedbackTool];
}
