// Restartable monthly snapshots of Google Health data into Postgres.
// Ported from nutribot-core/nutribot/health/sync.py and store.py.
import { createHash } from "crypto";
import type { Pool } from "pg";
import { addDays, todayLocalDate } from "../dates";
import { GoogleHealthClient, GoogleHealthError, type HealthDataType } from "./google";

export const HEALTH_SYNC_START = "2026-01-01";
const INSERT_CHUNK = 2000;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// API record name, else the day for daily totals, else a hash of the payload.
function recordKey(point: Record<string, unknown>, payload: string) {
  const name = point.name ?? point.dataPointName;
  if (typeof name === "string" && name) {
    return name;
  }
  const day = (point.civilStartTime as { date?: { year: number; month: number; day: number } } | undefined)?.date;
  if (day) {
    return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
  }
  return createHash("sha256").update(payload).digest("hex");
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function nextMonth(date: string) {
  const value = new Date(`${monthStart(date)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

function minusDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function getCheckpoint(db: Pool, userName: string, kind: HealthDataType) {
  const { rows } = await db.query<{ covered_until: string }>(
    `select covered_until::text from public.health_sync_state where user_name = $1 and data_type = $2`,
    [userName, kind]
  );
  return rows[0]?.covered_until ?? null;
}

// Replaces one month's rows and advances the checkpoint in a single transaction.
async function commitPartition(
  db: Pool,
  params: {
    userName: string;
    kind: HealthDataType;
    month: string;
    end: string;
    records: Map<string, string>;
    // Full runs replace the month snapshot; recent runs upsert and leave the checkpoint alone.
    replace: boolean;
  }
) {
  const client = await db.connect();
  try {
    await client.query("begin");
    // Serializes concurrent runs for the same user and data type.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `health-sync:${params.userName}:${params.kind}`
    ]);
    if (params.replace) {
      await client.query(
        `delete from public.health_records where user_name = $1 and data_type = $2 and partition_month = $3`,
        [params.userName, params.kind, params.month]
      );
    }
    const entries = [...params.records.entries()];
    for (let index = 0; index < entries.length; index += INSERT_CHUNK) {
      const chunk = entries.slice(index, index + INSERT_CHUNK);
      await client.query(
        `
        insert into public.health_records (user_name, data_type, partition_month, record_key, payload)
        select $1, $2, $3, record.key, record.payload::jsonb
        from unnest($4::text[], $5::text[]) as record(key, payload)
        on conflict (user_name, data_type, partition_month, record_key) do update
          set payload = excluded.payload, fetched_at = now()
        `,
        [params.userName, params.kind, params.month, chunk.map(([key]) => key), chunk.map(([, payload]) => payload)]
      );
    }
    if (params.replace) {
      await client.query(
        `
        insert into public.health_sync_state (user_name, data_type, covered_until, last_success_at)
        values ($1, $2, $3::date, now())
        on conflict (user_name, data_type) do update set
          covered_until = greatest(public.health_sync_state.covered_until, excluded.covered_until),
          last_success_at = excluded.last_success_at
        `,
        [params.userName, params.kind, params.end]
      );
    } else {
      await client.query(
        `update public.health_sync_state set last_success_at = now() where user_name = $1 and data_type = $2`,
        [params.userName, params.kind]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export type HealthSyncOptions = {
  userName: string;
  types: HealthDataType[];
  // Exclusive upper bound, YYYY-MM-DD. Normally tomorrow in APP_TIME_ZONE.
  end: string;
  // Replay every month from this date instead of resuming from checkpoints.
  replayFrom?: string;
  // Light run: refetch only the last N days and upsert them. Full runs (the
  // default) replace whole months, which also removes records Fitbit deleted.
  recentDays?: number;
  overlapDays?: number;
  report?: (message: string) => void;
};

export type HealthSyncResult = {
  records: number;
  failedTypes: HealthDataType[];
};

// Other types keep going after a failure; failed types are listed in the result.
export async function syncHealth(
  db: Pool,
  google: GoogleHealthClient,
  options: HealthSyncOptions
): Promise<HealthSyncResult> {
  const report = options.report ?? console.log;
  const overlapDays = options.overlapDays ?? 7;
  const result: HealthSyncResult = { records: 0, failedTypes: [] };

  for (const kind of options.types) {
    try {
      const checkpoint = options.recentDays ? null : await getCheckpoint(db, options.userName, kind);
      const typeEnd = checkpoint && checkpoint > options.end ? checkpoint : options.end;
      const fetchFrom = options.recentDays ? minusDays(options.end, options.recentDays) : null;
      let lower: string;
      if (fetchFrom) {
        lower = fetchFrom;
      } else if (options.replayFrom) {
        lower = options.replayFrom;
      } else if (checkpoint) {
        const resume = minusDays(checkpoint, overlapDays);
        lower = resume > HEALTH_SYNC_START ? resume : HEALTH_SYNC_START;
      } else {
        lower = HEALTH_SYNC_START;
      }
      lower = monthStart(lower);

      while (lower < typeEnd) {
        const month = lower.slice(0, 7);
        const upper = nextMonth(lower) < typeEnd ? nextMonth(lower) : typeEnd;
        const records = new Map<string, string>();
        const from = fetchFrom && fetchFrom > lower ? fetchFrom : lower;
        for await (const points of google.pages(kind, from, upper)) {
          for (const point of points) {
            if (!point || typeof point !== "object" || !Object.keys(point).length) {
              throw new GoogleHealthError("Invalid data point response");
            }
            const payload = canonicalJson(point);
            records.set(recordKey(point, payload), payload);
          }
        }
        await commitPartition(db, {
          userName: options.userName,
          kind,
          month,
          end: upper,
          records,
          replace: !fetchFrom
        });
        result.records += records.size;
        report(`${kind}: ${from} to ${upper} (exclusive), ${records.size} records${fetchFrom ? " upserted" : ""}`);
        lower = upper;
      }
    } catch (error) {
      result.failedTypes.push(kind);
      // Only our own error messages are safe to print; others may contain personal data.
      const message = error instanceof GoogleHealthError ? error.message : error instanceof Error ? error.name : "error";
      report(`${kind}: failed (${message}); rerun to resume`);
    }
  }

  return result;
}

// Runs a sync through today and records it in health_sync_runs.
export async function runHealthSync(
  db: Pool,
  options: Omit<HealthSyncOptions, "end"> & { trigger: "cron" | "manual" }
) {
  const { trigger, ...syncOptions } = options;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.health_sync_runs (user_name, trigger, scope) values ($1, $2, $3) returning id::text`,
    [options.userName, trigger, options.recentDays ? "recent" : "full"]
  );
  const runId = rows[0].id;

  try {
    const result = await syncHealth(db, new GoogleHealthClient(), {
      ...syncOptions,
      end: addDays(todayLocalDate(), 1)
    });
    await db.query(
      `
      update public.health_sync_runs
      set finished_at = now(), status = $2, records = $3, failed_types = $4
      where id = $1
      `,
      [runId, result.failedTypes.length ? "failed" : "succeeded", result.records, result.failedTypes]
    );
    return result;
  } catch (error) {
    // Only our own error messages are safe to store; others may contain personal data.
    const message = error instanceof GoogleHealthError ? error.message : error instanceof Error ? error.name : "error";
    await db.query(
      `update public.health_sync_runs set finished_at = now(), status = 'failed', error = $2 where id = $1`,
      [runId, message]
    );
    throw error;
  }
}
