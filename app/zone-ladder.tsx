// Training's heart-rate zones card (picked Nov 10, 2026, mockup C1 at
// https://claude.ai/artifact/6PidsVehLUnoXyuHDydcA4): the zones stacked from
// peak down to light, each with its bpm range on a warm strip that heats up
// going up, this week's minutes as a bar to the goal, a tick at the 4-week
// average, and the pace. Red text only for behind pace.
import { ZONES, ZONE_GOALS, zonePace, type ZoneBounds, type ZoneKey, type ZoneMinutes } from "@/lib/health/zones";

export function ZoneLadder({
  week,
  average,
  bounds,
  daysDone
}: {
  week: ZoneMinutes;
  average: ZoneMinutes | null; // per week over the 4 full weeks before; null without them
  bounds: ZoneBounds | null;
  daysDone: number; // days of this week already over
}) {
  const rows = [...ZONES].reverse();
  const top = (key: ZoneKey) => (bounds ? String(bounds[key].max) : "");
  return (
    <section className="card" aria-label="Heart-rate zones">
      <div className="card-heading">
        <h2 className="card-title">Heart-rate zones</h2>
        <span className="card-aside">This week, since Monday</span>
      </div>
      <div className="zone-ladder">
        {rows.map((zone, index) => {
          const goal = ZONE_GOALS[zone.key];
          const minutes = week[zone.key];
          const usual = average?.[zone.key] ?? null;
          const scale = goal ?? Math.max(minutes, Math.round((usual ?? minutes) * 1.3), 1);
          const pace = goal == null ? null : zonePace(minutes, goal, daysDone);
          const status = goal == null ? "no goal" : pace!.status === "done" ? "done" : pace!.status === "behind" ? `${pace!.behind} behind pace` : "on pace";
          return (
            <div key={zone.key} className={`zone-row ${zone.key}${index === 0 ? " first" : ""}${index === rows.length - 1 ? " last" : ""}`}>
              <span className="zone-bpm">{top(zone.key)}</span>
              <span className="zone-strip" aria-hidden="true" />
              <div className="zone-body">
                <div className="zone-head">
                  <span className="zone-name">
                    <span className="zone-dot" aria-hidden="true" />
                    {zone.label}
                  </span>
                  <span className="zone-minutes">
                    <strong>{minutes}</strong>
                    <span>{goal != null ? ` / ${goal} min` : " min"}</span>
                  </span>
                </div>
                <div className="zone-bar" role="img" aria-label={`${minutes} of ${goal ?? "no goal"} minutes${usual != null ? `, usually ${usual}` : ""}`}>
                  <span className="zone-fill" style={{ width: `${Math.min(100, (minutes / scale) * 100)}%` }} />
                  {usual != null ? <span className="zone-usual" style={{ left: `${Math.min(99, (usual / scale) * 100)}%` }} /> : null}
                </div>
                <span className="zone-note">
                  {usual != null ? `avg ${usual} a week · ` : ""}
                  <span className={pace?.status === "behind" ? "behind" : undefined}>{status}</span>
                </span>
              </div>
            </div>
          );
        })}
        <div className="zone-row floor">
          <span className="zone-bpm">{bounds ? bounds.light.min : ""}</span>
          <span />
          <span className="zone-note">bpm</span>
        </div>
      </div>
    </section>
  );
}
