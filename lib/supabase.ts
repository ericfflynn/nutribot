import { createClient } from "@supabase/supabase-js";
import { Pool, type PoolConfig } from "pg";
import { getFallbackMacroGoals, parseMacroGoals, type MacroGoals } from "./goals";
import type { ParsedMacros } from "./macro-parser";

export type MacroFoodItem = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  assumption?: string;
};

export type MacroEntry = {
  id: string;
  user_name: string;
  entry_date: string;
  raw_text: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items: MacroFoodItem[];
  confidence: number;
  notes: string | null;
  created_at: string;
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

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool(getPoolConfig(connectionString));
  }

  return pool;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false
    }
  });
}

export function isDatabaseConfigured() {
  return Boolean(
    process.env.DATABASE_URL || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
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

export async function listEntriesForDate(userName: string, entryDate: string) {
  const db = getPool();
  if (db) {
    const { rows } = await db.query(
      `
      select
        id::text,
        user_name,
        entry_date::text,
        raw_text,
        calories::float8,
        protein_g::float8,
        carbs_g::float8,
        fat_g::float8,
        items,
        confidence::float8,
        notes,
        created_at::text
      from public.macro_entries
      where user_name = $1 and entry_date = $2::date
      order by created_at desc
      `,
      [userName, entryDate]
    );
    return rows.map(normalizeEntry);
  }

  const { data, error } = await getSupabase()
    .from("macro_entries")
    .select("*")
    .eq("user_name", userName)
    .eq("entry_date", entryDate)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []).map((row) => normalizeEntry(row as Omit<MacroEntry, "items"> & { items: unknown }));
}

export async function saveMacroEntry(params: {
  userName: string;
  entryDate: string;
  rawText: string;
  parsed: ParsedMacros;
}) {
  const { parsed } = params;
  const db = getPool();
  if (db) {
    await db.query(
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
        notes
      )
      values ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
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
        parsed.notes || null
      ]
    );
    return;
  }

  const { error } = await getSupabase().from("macro_entries").insert({
    user_name: params.userName,
    entry_date: params.entryDate,
    raw_text: params.rawText,
    calories: Math.round(parsed.calories),
    protein_g: Math.round(parsed.protein_g),
    carbs_g: Math.round(parsed.carbs_g),
    fat_g: Math.round(parsed.fat_g),
    items: parsed.items,
    confidence: parsed.confidence,
    notes: parsed.notes || null
  });

  if (error) {
    throw error;
  }
}

export async function getUserMacroGoals(userName: string): Promise<MacroGoals> {
  const db = getPool();
  if (db) {
    const { rows } = await db.query(
      `
      select
        calories::float8,
        protein_pct::float8,
        carbs_pct::float8,
        fat_pct::float8
      from public.user_macro_goals
      where user_name = $1
      limit 1
      `,
      [userName]
    );

    if (rows[0]) {
      return parseMacroGoals({
        calories: rows[0].calories,
        proteinPct: rows[0].protein_pct,
        carbsPct: rows[0].carbs_pct,
        fatPct: rows[0].fat_pct
      });
    }

    return getFallbackMacroGoals(userName);
  }

  const { data, error } = await getSupabase()
    .from("user_macro_goals")
    .select("calories, protein_pct, carbs_pct, fat_pct")
    .eq("user_name", userName)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return getFallbackMacroGoals(userName);
  }

  return parseMacroGoals({
    calories: Number(data.calories),
    proteinPct: Number(data.protein_pct),
    carbsPct: Number(data.carbs_pct),
    fatPct: Number(data.fat_pct)
  });
}

export async function saveUserMacroGoals(userName: string, goals: MacroGoals) {
  const normalized = parseMacroGoals(goals);
  const db = getPool();
  if (db) {
    await db.query(
      `
      insert into public.user_macro_goals (
        user_name,
        calories,
        protein_pct,
        carbs_pct,
        fat_pct,
        updated_at
      )
      values ($1, $2, $3, $4, $5, now())
      on conflict (user_name)
      do update set
        calories = excluded.calories,
        protein_pct = excluded.protein_pct,
        carbs_pct = excluded.carbs_pct,
        fat_pct = excluded.fat_pct,
        updated_at = now()
      `,
      [
        userName,
        normalized.calories,
        normalized.proteinPct,
        normalized.carbsPct,
        normalized.fatPct
      ]
    );
    return normalized;
  }

  const { error } = await getSupabase().from("user_macro_goals").upsert(
    {
      user_name: userName,
      calories: normalized.calories,
      protein_pct: normalized.proteinPct,
      carbs_pct: normalized.carbsPct,
      fat_pct: normalized.fatPct,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_name" }
  );

  if (error) {
    throw error;
  }

  return normalized;
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
