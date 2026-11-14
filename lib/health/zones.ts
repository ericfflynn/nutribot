// Zone bands from the watch. The zones, goals and pace live in zone-core.ts so
// client components can use them without the database.
import { getPool } from "../supabase";
import { ZONES, type ZoneBounds, type ZoneKey } from "./zone-core";

export * from "./zone-core";

// The zone bands on the latest day on or before `date` that has them.
export async function getZoneBounds(userName: string, date: string): Promise<ZoneBounds | null> {
  const db = getPool();
  if (!db) return null;
  const { rows } = await db.query(
    `
    select payload->'dailyHeartRateZones'->'heartRateZones' as zones
    from public.health_records r
    cross join lateral (
      select make_date(
        (r.payload->'dailyHeartRateZones'->'date'->>'year')::int,
        (r.payload->'dailyHeartRateZones'->'date'->>'month')::int,
        (r.payload->'dailyHeartRateZones'->'date'->>'day')::int
      ) as day
    ) d
    where r.user_name = $1 and r.data_type = 'daily-heart-rate-zones' and d.day <= $2::date
    order by d.day desc
    limit 1
    `,
    [userName, date]
  );
  const zones = rows[0]?.zones as { heartRateZoneType: string; minBeatsPerMinute: string; maxBeatsPerMinute: string }[] | undefined;
  if (!zones) return null;
  const bounds: Partial<ZoneBounds> = {};
  for (const zone of zones) {
    const key = zone.heartRateZoneType.toLowerCase() as ZoneKey;
    if (ZONES.some((item) => item.key === key)) {
      bounds[key] = { min: Number(zone.minBeatsPerMinute), max: Number(zone.maxBeatsPerMinute) };
    }
  }
  return ZONES.every((item) => bounds[item.key]) ? (bounds as ZoneBounds) : null;
}
