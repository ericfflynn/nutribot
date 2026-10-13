// Journal entries (journal_entries): morning and evening check-ins written in
// chat, with 1-5 ratings Claude pulls from the text. Plan: docs/journal-habits-plan.md.
import type { Pool } from "pg";
import { normalizeTags } from "./journal-tags";

type Queryable = Pick<Pool, "query">;

export const JOURNAL_KINDS = ["morning", "evening", "other"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const RATINGS = ["mood", "stress", "energy", "soreness"] as const;
export type Rating = (typeof RATINGS)[number];

// Mood is the main check-in; stress is optional and recorded separately,
// never worked out from mood (or mood from stress). Unrecorded is null.
export const MOOD_LABELS = ["Very low", "A little down", "Neutral / okay", "Good", "Excellent"] as const;
export const STRESS_LABELS = ["None / relaxed", "Mild", "Moderate", "High", "Overwhelming"] as const;
export const ENERGY_LABELS = ["Drained", "Low", "Okay", "Good", "Energized"] as const;
export const SORENESS_LABELS = ["None", "A little", "Moderate", "Sore", "Very sore"] as const;

export const RATING_LABELS: Record<Rating, readonly string[]> = {
  mood: MOOD_LABELS,
  energy: ENERGY_LABELS,
  stress: STRESS_LABELS,
  soreness: SORENESS_LABELS
};

// "Good" for mood 4.
export function ratingLabel(rating: Rating, value: number) {
  return RATING_LABELS[rating][Math.min(5, Math.max(1, Math.round(value))) - 1];
}

// The ratings shown, mood first, then stress, then the rest; only recorded ones.
export function recordedRatings(ratings: Record<Rating, number | null>) {
  return RATINGS.filter((name) => ratings[name] != null).map((name) => ({
    name,
    value: ratings[name]!,
    label: ratingLabel(name, ratings[name]!)
  }));
}

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

// Fixes a saved entry's ratings and tags. The body stays as written.
export async function updateJournalEntry(
  db: Queryable,
  userName: string,
  id: string,
  changes: { ratings: Record<Rating, number | null>; tags: string[] }
) {
  const { rowCount } = await db.query(
    `
    update public.journal_entries
    set mood = $3, energy = $4, stress = $5, soreness = $6, tags = $7
    where id = $1::uuid and user_name = $2
    `,
    [id, userName, changes.ratings.mood, changes.ratings.energy, changes.ratings.stress, changes.ratings.soreness, changes.tags]
  );
  return Boolean(rowCount);
}

// Every tag used in the past `days` days, normalized, most used first.
export async function listJournalTags(db: Queryable, userName: string, endDate: string, days = 365) {
  const { rows } = await db.query<{ tag: string; uses: number }>(
    `
    select tag, count(*)::int as uses
    from public.journal_entries, unnest(tags) as tag
    where user_name = $1 and entry_date > $2::date - $3::int and entry_date <= $2::date
    group by tag
    order by uses desc, tag
    `,
    [userName, endDate, days]
  );
  // Older entries may hold variants ("Work", "#work"); count them as one.
  const counts = new Map<string, number>();
  for (const row of rows) {
    const tag = normalizeTags([row.tag])[0];
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + row.uses);
  }
  return [...counts].map(([tag, uses]) => ({ tag, uses })).sort((a, b) => b.uses - a.uses || a.tag.localeCompare(b.tag));
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
    tags: normalizeTags(row.tags, [], 20),
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
