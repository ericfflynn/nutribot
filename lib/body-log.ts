// Soreness and pain reports (body_log). Soreness is logged per muscle from the
// Training tab's body map and feeds each muscle's fatigue (lib/workouts.ts);
// pain is for plain body parts (wrist, lower back) and is only kept for now.
import type { Pool } from "pg";
import type { Severity, SorenessReport } from "./workouts";

export async function listSoreness(
  db: Pick<Pool, "query">,
  userName: string,
  startDate: string,
  endDate: string
): Promise<SorenessReport[]> {
  const { rows } = await db.query(
    `
    select id::text as "id", entry_date::text as "date", body_part as "muscle", severity as "severity"
    from public.body_log
    where user_name = $1 and kind = 'sore' and entry_date >= $2::date and entry_date <= $3::date
    order by entry_date desc, created_at desc
    `,
    [userName, startDate, endDate]
  );
  return rows;
}

// One soreness report per muscle per day: a new one replaces that day's.
export async function saveSoreness(db: Pool, userName: string, date: string, muscle: string, severity: Severity) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from public.body_log where user_name = $1 and entry_date = $2::date and body_part = $3 and kind = 'sore'`,
      [userName, date, muscle]
    );
    await client.query(
      `insert into public.body_log (user_name, entry_date, body_part, kind, severity) values ($1, $2::date, $3, 'sore', $4)`,
      [userName, date, muscle, severity]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteBodyReport(db: Pick<Pool, "query">, userName: string, id: string) {
  const { rowCount } = await db.query(`delete from public.body_log where id = $1 and user_name = $2`, [id, userName]);
  return (rowCount ?? 0) > 0;
}
