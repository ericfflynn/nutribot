// Duplicate Fitbit workouts, folded at the data layer. health_workout_merges
// maps each duplicate record to its canonical record, and the health_workouts
// view shows one row per canonical record (metrics from the canonical, gaps
// filled from its duplicates, never summed). Auto rows are rebuilt after each
// exercise sync; rows the owner made ("user") are never overwritten.
// Rules: lib/health/dedupe-rules.ts.
import type { Pool, PoolClient } from "pg";
import {
  compareCompleteness,
  findDuplicates,
  resolveCanonical,
  type ManualDecision,
  type WorkoutRecord
} from "./dedupe-rules";

type Queryable = Pick<Pool, "query"> | PoolClient;

async function loadRecords(db: Queryable, userName: string, ids?: string[]): Promise<WorkoutRecord[]> {
  const { rows } = await db.query(
    `
    select
      id,
      type,
      (extract(epoch from started_at) * 1000)::float8 as "startedAt",
      (extract(epoch from ended_at) * 1000)::float8 as "endedAt",
      active_minutes::float8 as "activeMinutes",
      calories::float8 as "calories",
      avg_hr::float8 as "avgHr",
      distance_miles::float8 as "distanceMiles",
      steps::float8 as "steps"
    from public.health_workout_records
    where user_name = $1 and ($2::text[] is null or id = any($2))
    `,
    [userName, ids ?? null]
  );
  return rows;
}

async function loadDecisions(db: Queryable, userName: string) {
  const { rows } = await db.query<ManualDecision & { decidedBy: "auto" | "user" }>(
    `
    select record_key as "recordId", canonical_key as "canonicalId", decided_by as "decidedBy"
    from public.health_workout_merges
    where user_name = $1
    `,
    [userName]
  );
  return rows;
}

async function inTransaction<T>(db: Pool, userName: string, work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("begin");
    // One reconcile or manual change at a time per user.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`workout-merges:${userName}`]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// A logged session linked to a record that's now a duplicate moves to the
// canonical record, unless another session already holds it.
async function relinkSessions(client: PoolClient, userName: string) {
  const { rowCount } = await client.query(
    `
    update public.workout_sessions s
    set health_record_key = m.canonical_key
    from public.health_workout_merges m
    where s.user_name = $1 and m.user_name = $1
      and s.health_record_key = m.record_key and m.record_key <> m.canonical_key
      and not exists (
        select 1 from public.workout_sessions other
        where other.user_name = $1 and other.health_record_key = m.canonical_key
      )
    `,
    [userName]
  );
  return rowCount ?? 0;
}

export type ReconcilePlan = { duplicates: number; workouts: number };

// Works out the auto merges without writing anything.
export async function planWorkoutDuplicates(db: Queryable, userName: string): Promise<ReconcilePlan & { mapping: Map<string, string> }> {
  const [records, decisions] = await Promise.all([loadRecords(db, userName), loadDecisions(db, userName)]);
  const manual = decisions.filter((decision) => decision.decidedBy === "user");
  const mapping = findDuplicates(records, manual);
  return { mapping, duplicates: mapping.size, workouts: new Set(mapping.values()).size };
}

// Rebuilds the auto merges from the current records. Idempotent: a repeated
// sync recomputes the same mapping, so duplicates never come back.
export async function reconcileWorkoutDuplicates(db: Pool, userName: string) {
  return inTransaction(db, userName, async (client) => {
    const plan = await planWorkoutDuplicates(client, userName);
    await client.query(`delete from public.health_workout_merges where user_name = $1 and decided_by = 'auto'`, [userName]);
    const entries = [...plan.mapping.entries()];
    if (entries.length) {
      await client.query(
        `
        insert into public.health_workout_merges (user_name, record_key, canonical_key, decided_by)
        select $1, pair.record_key, pair.canonical_key, 'auto'
        from unnest($2::text[], $3::text[]) as pair(record_key, canonical_key)
        `,
        [userName, entries.map(([id]) => id), entries.map(([, canonical]) => canonical)]
      );
    }
    const relinked = await relinkSessions(client, userName);
    return { duplicates: plan.duplicates, workouts: plan.workouts, relinked };
  });
}

// Merges two workouts the owner says are the same. The more complete record
// becomes canonical; everything already folded into either follows it.
export async function mergeWorkouts(db: Pool, userName: string, firstId: string, secondId: string) {
  return inTransaction(db, userName, async (client) => {
    const decisions = await loadDecisions(client, userName);
    const mapping = new Map(decisions.map((decision) => [decision.recordId, decision.canonicalId]));
    const roots = [...new Set([resolveCanonical(firstId, mapping), resolveCanonical(secondId, mapping)])];
    if (roots.length < 2) return { ok: true as const };
    const records = await loadRecords(client, userName, roots);
    if (records.length < 2) return { ok: false as const, error: "That workout no longer exists." };
    const [canonical, duplicate] = records.sort(compareCompleteness);

    const members = decisions
      .filter((decision) => decision.canonicalId === duplicate.id || decision.canonicalId === canonical.id)
      .map((decision) => decision.recordId)
      .filter((id) => id !== canonical.id);
    const folded = [...new Set([duplicate.id, ...members])];
    await client.query(
      `
      insert into public.health_workout_merges (user_name, record_key, canonical_key, decided_by)
      select $1, id, $2, 'user' from unnest($3::text[]) as id
      on conflict (user_name, record_key) do update
        set canonical_key = excluded.canonical_key, decided_by = 'user', created_at = now()
      `,
      [userName, canonical.id, folded]
    );
    // The canonical record is pinned too, so auto-detection leaves the group alone.
    await client.query(
      `
      insert into public.health_workout_merges (user_name, record_key, canonical_key, decided_by)
      values ($1, $2, $2, 'user')
      on conflict (user_name, record_key) do update set canonical_key = excluded.canonical_key, decided_by = 'user'
      `,
      [userName, canonical.id]
    );
    await relinkSessions(client, userName);
    return { ok: true as const };
  });
}

// Splits a combined workout back into its recordings, and keeps them apart
// on later syncs. A session stays linked to the canonical record.
export async function separateWorkout(db: Pool, userName: string, canonicalId: string) {
  return inTransaction(db, userName, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `
      select record_key as id from public.health_workout_merges
      where user_name = $1 and canonical_key = $2
      `,
      [userName, canonicalId]
    );
    const ids = [...new Set([canonicalId, ...rows.map((row) => row.id)])];
    await client.query(
      `
      insert into public.health_workout_merges (user_name, record_key, canonical_key, decided_by)
      select $1, id, id, 'user' from unnest($2::text[]) as id
      on conflict (user_name, record_key) do update
        set canonical_key = excluded.canonical_key, decided_by = 'user', created_at = now()
      `,
      [userName, ids]
    );
    return { ok: true as const, separated: ids.length };
  });
}
