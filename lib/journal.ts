// Journal entries (journal_entries): morning and evening check-ins written in
// chat, with 1-5 ratings Claude pulls from the text. Plan: docs/journal-habits-plan.md.
import type { Pool } from "pg";

type Queryable = Pick<Pool, "query">;

export const JOURNAL_KINDS = ["morning", "evening", "other"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const RATINGS = ["mood", "energy", "stress", "soreness"] as const;
export type Rating = (typeof RATINGS)[number];

export type JournalInput = {
  date: string;
  kind: JournalKind;
  body: string;
  // 1-5, or null when the entry doesn't say.
  ratings: Record<Rating, number | null>;
  tags: string[];
};

export type JournalEntry = JournalInput & { id: string; createdAt: string };

export async function saveJournalEntry(db: Queryable, userName: string, input: JournalInput) {
  const { rows } = await db.query<{ id: string }>(
    `
    insert into public.journal_entries (user_name, entry_date, kind, body, mood, energy, stress, soreness, tags)
    values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
    returning id::text
    `,
    [
      userName,
      input.date,
      input.kind,
      input.body,
      input.ratings.mood,
      input.ratings.energy,
      input.ratings.stress,
      input.ratings.soreness,
      input.tags
    ]
  );
  return rows[0].id;
}

// Oldest first within a day.
export async function listJournalEntries(
  db: Queryable,
  userName: string,
  startDate: string,
  endDate: string
): Promise<JournalEntry[]> {
  const { rows } = await db.query(
    `
    select id::text, entry_date::text as date, kind, body, mood, energy, stress, soreness, tags, created_at::text as "createdAt"
    from public.journal_entries
    where user_name = $1 and entry_date between $2::date and $3::date
    order by entry_date desc, created_at
    `,
    [userName, startDate, endDate]
  );
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    kind: row.kind,
    body: row.body,
    ratings: { mood: row.mood, energy: row.energy, stress: row.stress, soreness: row.soreness },
    tags: row.tags,
    createdAt: row.createdAt
  }));
}

export async function deleteJournalEntry(db: Queryable, userName: string, id: string) {
  const { rowCount } = await db.query(`delete from public.journal_entries where id = $1::uuid and user_name = $2`, [
    id,
    userName
  ]);
  return Boolean(rowCount);
}
