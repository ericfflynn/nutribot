// Database access: Supabase Postgres through pg and DATABASE_URL.
import { Pool, type PoolConfig } from "pg";
import { fallbackGoals, parseGoals, type Goals } from "./goals";
import type { ParsedMacros } from "./macros";

export type MacroFoodItem = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  // Missing on items saved before caffeine and sugar were tracked.
  caffeine_mg?: number;
  added_sugar_g?: number;
  assumption?: string;
};

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "dessert";

export type MacroEntry = {
  id: string;
  user_name: string;
  entry_date: string;
  raw_text: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  // Null for meals saved before Oct 31, 2026, when these weren't estimated.
  caffeine_mg: number | null;
  added_sugar_g: number | null;
  items: MacroFoodItem[];
  confidence: number;
  notes: string | null;
  meal_type: MealType | null;
  // Local "HH:MM" the meal was eaten; null means when it was logged.
  eaten_at: string | null;
  created_at: string;
};

type Queryable = Pick<Pool, "query">;

// What a save writes: an estimate, where caffeine and added sugar can be
// unknown (an older meal edited by its totals, or a draft from before them).
export type StoredMacros = Omit<ParsedMacros, "caffeine_mg" | "added_sugar_g"> & {
  caffeine_mg?: number | null;
  added_sugar_g?: number | null;
};

let pool: Pool | null = null;

function getPoolConfig(connectionString: string): PoolConfig {
  const parsed = new URL(connectionString);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: {
      rejectUnauthorized: false
    }
  };
}

// The shared pool, or null when DATABASE_URL isn't set.
export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool(getPoolConfig(connectionString));
  }

  return pool;
}

function requirePool() {
  const db = getPool();
  if (!db) {
    throw new Error("DATABASE_URL is required.");
  }
  return db;
}

function normalizeItems(items: unknown): MacroFoodItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const normalized: MacroFoodItem[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      normalized.push({
        name: item,
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        assumption: ""
      });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      normalized.push({
        name: String(obj.name || "Item"),
        calories: Number(obj.calories || 0),
        protein_g: Number(obj.protein_g || 0),
        carbs_g: Number(obj.carbs_g || 0),
        fat_g: Number(obj.fat_g || 0),
        ...(obj.caffeine_mg != null ? { caffeine_mg: Number(obj.caffeine_mg) } : {}),
        ...(obj.added_sugar_g != null ? { added_sugar_g: Number(obj.added_sugar_g) } : {}),
        assumption: String(obj.assumption || "")
      });
    }
  }

  return normalized;
}

function normalizeEntry(row: Omit<MacroEntry, "items"> & { items: unknown }): MacroEntry {
  return {
    ...row,
    items: normalizeItems(row.items)
  };
}

const ENTRY_COLUMNS = `
  id::text,
  user_name,
  entry_date::text,
  raw_text,
  calories::float8,
  protein_g::float8,
  carbs_g::float8,
  fat_g::float8,
  caffeine_mg::float8,
  added_sugar_g::float8,
  items,
  confidence::float8,
  notes,
  meal_type,
  to_char(eaten_at, 'HH24:MI') as eaten_at,
  created_at::text
`;

export async function listEntriesForDateRange(userName: string, startDate: string, endDate: string) {
  const { rows } = await requirePool().query(
    `
    select ${ENTRY_COLUMNS}
    from public.macro_entries
    where user_name = $1
      and entry_date >= $2::date
      and entry_date <= $3::date
    order by entry_date desc, created_at desc
    `,
    [userName, startDate, endDate]
  );
  return rows.map(normalizeEntry);
}

// The chat brain's meal history: entries in a date range, newest first,
// optionally only those whose text or item names contain every search word.
export async function searchMacroEntries(
  db: Queryable,
  userName: string,
  params: { startDate: string; endDate: string; words: string[]; limit: number }
) {
  const patterns = params.words.map((word) => `%${word.replace(/[\\%_]/g, "\\$&")}%`);
  const { rows } = await db.query(
    `
    select ${ENTRY_COLUMNS}
    from public.macro_entries
    where user_name = $1
      and entry_date >= $2::date
      and entry_date <= $3::date
      and (
        select bool_and(
          raw_text ilike pattern
          or exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) item
            where item->>'name' ilike pattern
          )
        )
        from unnest($4::text[]) pattern
      ) is not false
    order by entry_date desc, created_at desc
    limit $5
    `,
    [userName, params.startDate, params.endDate, patterns, params.limit]
  );
  return rows.map(normalizeEntry);
}

export async function getMacroEntry(db: Queryable, userName: string, id: string) {
  const { rows } = await db.query(
    `
    select ${ENTRY_COLUMNS}
    from public.macro_entries
    where user_name = $1 and id::text = $2
    `,
    [userName, id]
  );
  return rows[0] ? normalizeEntry(rows[0]) : null;
}

export async function saveMacroEntry(params: {
  userName: string;
  entryDate: string;
  rawText: string;
  parsed: StoredMacros;
  mealType?: MealType;
  eatenAt?: string | null;
  // A transaction's client, when the insert is part of a larger write.
  client?: Queryable;
}): Promise<string> {
  const { parsed } = params;
  const { rows } = await (params.client ?? requirePool()).query<{ id: string }>(
    `
    insert into public.macro_entries (
      user_name,
      entry_date,
      raw_text,
      calories,
      protein_g,
      carbs_g,
      fat_g,
      items,
      confidence,
      notes,
      meal_type,
      eaten_at,
      caffeine_mg,
      added_sugar_g
    )
    values ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::time, $13, $14)
    returning id::text
    `,
    [
      params.userName,
      params.entryDate,
      params.rawText,
      Math.round(parsed.calories),
      Math.round(parsed.protein_g),
      Math.round(parsed.carbs_g),
      Math.round(parsed.fat_g),
      JSON.stringify(parsed.items),
      parsed.confidence,
      parsed.notes || null,
      params.mealType ?? null,
      params.eatenAt ?? null,
      optionalAmount(parsed.caffeine_mg),
      optionalAmount(parsed.added_sugar_g)
    ]
  );
  return rows[0].id;
}

export async function updateMacroEntry(params: {
  id: string;
  userName: string;
  rawText: string;
  parsed: StoredMacros;
  // Left unchanged when omitted.
  mealType?: MealType;
  entryDate?: string;
  // null clears it back to the logged time.
  eatenAt?: string | null;
  client?: Queryable;
}) {
  const { parsed } = params;
  const { rowCount } = await (params.client ?? requirePool()).query(
    `
    update public.macro_entries
    set
      raw_text = $3,
      calories = $4,
      protein_g = $5,
      carbs_g = $6,
      fat_g = $7,
      items = $8::jsonb,
      confidence = $9,
      notes = $10,
      meal_type = coalesce($11, meal_type),
      entry_date = coalesce($12::date, entry_date),
      eaten_at = case when $13 then $14::time else eaten_at end,
      caffeine_mg = $15,
      added_sugar_g = $16
    where id = $1::uuid and user_name = $2
    `,
    [
      params.id,
      params.userName,
      params.rawText,
      Math.round(parsed.calories),
      Math.round(parsed.protein_g),
      Math.round(parsed.carbs_g),
      Math.round(parsed.fat_g),
      JSON.stringify(parsed.items),
      parsed.confidence,
      parsed.notes || null,
      params.mealType ?? null,
      params.entryDate ?? null,
      params.eatenAt !== undefined,
      params.eatenAt ?? null,
      optionalAmount(parsed.caffeine_mg),
      optionalAmount(parsed.added_sugar_g)
    ]
  );

  if (!rowCount) {
    throw new Error("Meal entry was not found.");
  }
}

export async function deleteMacroEntry(id: string, userName: string) {
  const { rowCount } = await requirePool().query(
    `
    delete from public.macro_entries
    where id = $1::uuid and user_name = $2
    `,
    [id, userName]
  );

  if (!rowCount) {
    throw new Error("Meal entry was not found.");
  }
}

// Ounces of water logged on a day.
export async function getWaterOunces(userName: string, entryDate: string, db: Queryable = requirePool()): Promise<number> {
  const { rows } = await db.query(
    `
    select coalesce(sum(amount_oz), 0)::float8 as ounces
    from public.water_entries
    where user_name = $1 and entry_date = $2::date
    `,
    [userName, entryDate]
  );
  return rows[0].ounces;
}

export async function addWaterEntry(userName: string, entryDate: string, ounces: number) {
  await requirePool().query(
    `
    insert into public.water_entries (user_name, entry_date, amount_oz)
    values ($1, $2::date, $3)
    `,
    [userName, entryDate, ounces]
  );
}

// Takes back the day's most recent water entry (a mis-tap or an overcount).
export async function removeLastWaterEntry(userName: string, entryDate: string) {
  await requirePool().query(
    `
    delete from public.water_entries
    where id = (
      select id from public.water_entries
      where user_name = $1 and entry_date = $2::date
      order by created_at desc
      limit 1
    )
    `,
    [userName, entryDate]
  );
}

// The user's daily targets, or the defaults until they save some.
export async function getUserGoals(userName: string, db: Queryable = requirePool()): Promise<Goals> {
  const { rows } = await db.query(
    `
    select
      calories::float8,
      protein_pct::float8,
      carbs_pct::float8,
      fat_pct::float8,
      water_oz::float8,
      caffeine_limit_mg::float8,
      to_char(caffeine_cutoff, 'HH24:MI') as caffeine_cutoff,
      added_sugar_limit_g::float8
    from public.user_macro_goals
    where user_name = $1
    limit 1
    `,
    [userName]
  );

  if (!rows[0]) {
    return fallbackGoals;
  }
  return parseGoals({
    calories: rows[0].calories,
    proteinPct: rows[0].protein_pct,
    carbsPct: rows[0].carbs_pct,
    fatPct: rows[0].fat_pct,
    waterOz: rows[0].water_oz,
    caffeineLimitMg: rows[0].caffeine_limit_mg,
    caffeineCutoff: rows[0].caffeine_cutoff,
    addedSugarLimitG: rows[0].added_sugar_limit_g
  });
}

export async function saveUserGoals(userName: string, goals: Goals) {
  const normalized = parseGoals(goals);
  await requirePool().query(
    `
    insert into public.user_macro_goals (
      user_name,
      calories,
      protein_pct,
      carbs_pct,
      fat_pct,
      water_oz,
      caffeine_limit_mg,
      caffeine_cutoff,
      added_sugar_limit_g,
      updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8::time, $9, now())
    on conflict (user_name)
    do update set
      calories = excluded.calories,
      protein_pct = excluded.protein_pct,
      carbs_pct = excluded.carbs_pct,
      fat_pct = excluded.fat_pct,
      water_oz = excluded.water_oz,
      caffeine_limit_mg = excluded.caffeine_limit_mg,
      caffeine_cutoff = excluded.caffeine_cutoff,
      added_sugar_limit_g = excluded.added_sugar_limit_g,
      updated_at = now()
    `,
    [
      userName,
      normalized.calories,
      normalized.proteinPct,
      normalized.carbsPct,
      normalized.fatPct,
      normalized.waterOz,
      normalized.caffeineLimitMg,
      normalized.caffeineCutoff,
      normalized.addedSugarLimitG
    ]
  );
  return normalized;
}

// A draft saved from before caffeine and sugar were estimated has neither.
function optionalAmount(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));
}

export function summarizeEntries(entries: MacroEntry[]) {
  return entries.reduce(
    (total, entry) => ({
      calories: total.calories + Number(entry.calories || 0),
      protein_g: total.protein_g + Number(entry.protein_g || 0),
      carbs_g: total.carbs_g + Number(entry.carbs_g || 0),
      fat_g: total.fat_g + Number(entry.fat_g || 0)
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}
