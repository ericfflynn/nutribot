"use client";

// Training's heart-rate zones card. Picked Nov 10, 2026 as a ladder (mockup
// C1 at https://claude.ai/artifact/6PidsVehLUnoXyuHDydcA4); made concise Nov
// 13, 2026 (https://claude.ai/artifact/3FZGayqyayLU6Yu3ntEn2e): one line per
// zone, peak down to light, with this week's minutes as a bar to the goal and
// the pace. Tapping a zone shows its bpm range and the usual week. Red text
// only for behind pace.
import { useState } from "react";
import { ZONES, ZONE_GOALS, zonePace, type ZoneBounds, type ZoneKey, type ZoneMinutes } from "@/lib/health/zone-core";

function rangeOf(bounds: ZoneBounds, key: ZoneKey) {
  if (key === "light") return `under ${bounds.moderate.min} bpm`;
  if (key === "peak") return `${bounds.peak.min}+ bpm`;
  return `${bounds[key].min}–${bounds[key].max} bpm`;
}

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
  const [open, setOpen] = useState<ZoneKey | null>(null);
  const rows = [...ZONES].reverse();
  return (
    <section className="card" aria-label="Heart-rate zones">
      <div className="card-heading">
        <h2 className="card-title">Heart-rate zones</h2>
        <span className="card-aside">This week, since Monday</span>
      </div>
      <div className="zone-list">
        {rows.map((zone) => {
          const goal = ZONE_GOALS[zone.key];
          const minutes = week[zone.key];
          const usual = average?.[zone.key] ?? null;
          const scale = goal ?? Math.max(minutes, Math.round((usual ?? minutes) * 1.3), 1);
          const pace = goal == null ? null : zonePace(minutes, goal, daysDone);
          const status = !pace ? "no goal" : pace.status === "done" ? "done" : pace.status === "behind" ? `${pace.behind} behind` : "on pace";
          const detail = [bounds ? rangeOf(bounds, zone.key) : null, usual != null ? `usually ${usual} a week` : null].filter(Boolean).join(" · ");
          const isOpen = open === zone.key;
          return (
            <button
              key={zone.key}
              type="button"
              className={`zone-line ${zone.key}`}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : zone.key)}
            >
              <span className="zone-line-row">
                <span className="zone-name">
                  <span className="zone-dot" aria-hidden="true" />
                  {zone.label}
                </span>
                <span className="zone-bar" role="img" aria-label={`${minutes} of ${goal ?? "no goal"} minutes`}>
                  <span className="zone-fill" style={{ width: `${Math.min(100, (minutes / scale) * 100)}%` }} />
                </span>
                <span className="zone-minutes">
                  <strong>{minutes}</strong>
                  <span>{goal != null ? `/${goal}` : " min"}</span>
                </span>
                <span className={`zone-status${pace?.status === "behind" ? " behind" : pace?.status === "done" ? " done" : ""}`}>{status}</span>
              </span>
              {isOpen && detail ? <span className="zone-detail">{detail}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// A workout's minutes per zone as one stacked bar in the same ramp, with the
// numbers under it (Recent workouts cards; option D1 on the same canvas).
export function WorkoutZones({ minutes }: { minutes: ZoneMinutes }) {
  const total = ZONES.reduce((sum, zone) => sum + minutes[zone.key], 0);
  if (!total) return null;
  return (
    <div className="workout-zones">
      <div
        className="workout-zones-bar"
        role="img"
        aria-label={ZONES.map((zone) => `${zone.label} ${minutes[zone.key]}`).join(", ") + " minutes"}
      >
        {ZONES.filter((zone) => minutes[zone.key] > 0).map((zone) => (
          <span key={zone.key} className={zone.key} style={{ flexGrow: minutes[zone.key] }} />
        ))}
      </div>
      <div className="workout-zones-legend">
        {ZONES.filter((zone) => minutes[zone.key] > 0).map((zone) => (
          <span key={zone.key}>
            {zone.label} <strong>{minutes[zone.key]}</strong>
          </span>
        ))}
        <span className="workout-zones-unit">min</span>
      </div>
    </div>
  );
}
