// The chat thread (chat_messages): one continuous thread per user. Assistant
// rows carry the drafts shown with that reply; saving a draft records the new
// row's id on the draft so it can't be saved twice.
import type { Pool } from "pg";
import type { BrainReply, Draft, Turn } from "./brain";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  drafts: Draft[];
  createdAt: string;
};

// How much of the thread Claude sees, and how far back drafts stay editable.
export const HISTORY_TURNS = 10;
const OPEN_DRAFT_MESSAGES = 3;

export async function listMessages(db: Pool, userName: string, limit: number): Promise<ChatMessage[]> {
  const { rows } = await db.query<ChatMessage>(
    `
    select id::text as "id", role, content, drafts, created_at::text as "createdAt"
    from (
      select * from public.chat_messages
      where user_name = $1
      order by id desc
      limit $2
    ) recent
    order by id
    `,
    [userName, limit]
  );
  return rows;
}

export function historyFrom(messages: ChatMessage[]): Turn[] {
  return messages.slice(-HISTORY_TURNS).map((message) => ({ role: message.role, text: message.content }));
}

// Unsaved, undiscarded drafts from the last few replies, newest version of each.
export function openDraftsFrom(messages: ChatMessage[]): Draft[] {
  const recent = messages.filter((message) => message.role === "assistant").slice(-OPEN_DRAFT_MESSAGES);
  const byId = new Map<string, Draft>();
  for (const message of recent) {
    for (const draft of message.drafts) byId.set(draft.id, draft);
  }
  return [...byId.values()].filter((draft) => !draft.saved_id && !draft.discarded);
}

export async function appendExchange(db: Pool, userName: string, userText: string, reply: BrainReply) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(`insert into public.chat_messages (user_name, role, content) values ($1, 'user', $2)`, [
      userName,
      userText
    ]);
    const { rows } = await client.query<{ id: string }>(
      `
      insert into public.chat_messages (user_name, role, content, drafts)
      values ($1, 'assistant', $2, $3::jsonb)
      returning id::text
      `,
      [userName, reply.reply, JSON.stringify(reply.drafts)]
    );
    await client.query("commit");
    return rows[0].id;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// Loads one draft for saving, locked so two taps can't save it twice. The
// callback runs inside the transaction and returns the updated draft.
export async function withDraft<T>(
  db: Pool,
  userName: string,
  messageId: string,
  draftId: string,
  update: (draft: Draft, client: import("pg").PoolClient) => Promise<{ draft: Draft; result: T }>
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ drafts: Draft[] }>(
      `
      select drafts from public.chat_messages
      where id = $1 and user_name = $2 and role = 'assistant'
      for update
      `,
      [messageId, userName]
    );
    const drafts = rows[0]?.drafts;
    const draft = drafts?.find((item) => item.id === draftId);
    if (!drafts || !draft) {
      throw new Error("Draft not found.");
    }
    if (draft.saved_id || draft.discarded) {
      throw new Error("This draft was already saved or discarded.");
    }
    const { draft: updated, result } = await update(draft, client);
    await client.query(`update public.chat_messages set drafts = $3::jsonb where id = $1 and user_name = $2`, [
      messageId,
      userName,
      JSON.stringify(drafts.map((item) => (item.id === draftId ? updated : item)))
    ]);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
