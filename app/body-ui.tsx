// Pieces of the body state (docs/body-state.md) shown on Today: the sick
// line under the day scores, and the trends each score opens.
import type { ReactNode } from "react";
import { ColumnChart, SleepWindowChart, VitalsChart } from "./charts";
import { addDays } from "@/lib/dates";
import { formatClockTime } from "@/lib/habits";
import type { BodyState, Status, Vital } from "@/lib/body-state/types";
import { recoveryBand } from "@/lib/health/scores";
import { fahrenheitDelta } from "@/lib/health/units";
import type { WeekRow } from "@/lib/training-week";
import { ZONES, ZONE_GOALS, zonePace, type ZoneBounds, type ZoneMinutes } from "@/lib/health/zones";
import { callOf } from "@/lib/body-state/brief";
import { workLine, type DailyCall } from "@/lib/body-state/call";
import { INTENSITIES, INTENSITY_RULES, type Intensity } from "@/lib/workouts";

const STATUS_LABELS: Record<Status, string> = { good: "Good", ok: "Ok", watch: "Watch", low: "Low", unknown: "No data" };
const BAND_INK = { green: "#0a7f0a", yellow: "#8a5d00", red: "#b42f2f" } as const;

const lastDays = (date: string, count: number) => Array.from({ length: count }, (_, index) => addDays(date, index - count + 1));
const round = (value: number | null, places = 0) => (value == null ? "–" : (Math.round(value * 10 ** places) / 10 ** places).toString());

// While sick, easing back or showing early signs: one line with its dot.
export function SickLine({ state }: { state: BodyState }) {
  const { illness } = state.physical;
  if (illness.phase === "well") return null;
  return (
    <p className="sick-line">
      <span className={`status-dot ${illness.status}`} aria-label={STATUS_LABELS[illness.status]} />
      {illness.headline}
    </p>
  );
}

// The gap from usual: "↑6", red when it's off.
function Gap({ delta, off }: { delta: number | null; off: boolean }) {
  if (delta == null) return null;
  const rounded = Math.round(delta);
  if (!rounded) return <span className="gap">±0</span>;
  return (
    <span className={`gap${off ? " off" : ""}`}>
      {rounded > 0 ? "↑" : "↓"}
      {Math.abs(rounded)}
    </span>
  );
}

const VITAL_ROWS: { key: keyof Omit<BodyState["physical"]["vitals"], "status" | "headline">; name: string; format: (value: number) => string }[] = [
  { key: "restingHr", name: "Resting HR", format: (value) => `${Math.round(value)}` },
  { key: "hrv", name: "HRV", format: (value) => `${Math.round(value)}` },
  { key: "sleepTemp", name: "Sleep temp", format: fahrenheitDelta },
  { key: "breathing", name: "Breathing", format: (value) => value.toFixed(1) },
  { key: "spo2", name: "SpO2", format: (value) => `${value.toFixed(1)}%` }
];

function VitalsTable({ vitals }: { vitals: BodyState["physical"]["vitals"] }) {
  return (
    <table className="vitals-table">
      <thead>
        <tr>
          <th scope="col">Signal</th>
          <th scope="col">Today</th>
          <th scope="col">Usual</th>
          <th scope="col">Streak</th>
        </tr>
      </thead>
      <tbody>
        {VITAL_ROWS.map(({ key, name, format }) => {
          const vital: Vital = vitals[key];
          return (
            <tr key={key} className={vital.streak ? "off" : undefined}>
              <th scope="row">{name}</th>
              <td>{vital.value == null ? "–" : format(vital.value)}</td>
              <td>{vital.usual == null ? "–" : format(vital.usual)}</td>
              <td>{vital.streak ? `${vital.streak} day${vital.streak === 1 ? "" : "s"}` : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="area-facts">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Recovery's trends: today's three numbers, 7 days of recovery in its band
// colors, resting HR and HRV against usual, and the other vitals.
export function RecoveryDetails({ state }: { state: BodyState }) {
  const { recovery, vitals } = state.physical;
  const date = state.meta.date;
  const rhr = vitals.restingHr;
  const hrv = vitals.hrv;
  return (
    <>
      <div className="body-scores headline">
        <div>
          <span style={{ color: recovery.band ? BAND_INK[recovery.band] : "var(--muted)" }}>Recovery</span>
          <strong>{recovery.score ?? "–"}</strong>
          <small>
            {recovery.band ? recovery.band[0].toUpperCase() + recovery.band.slice(1) : "No data"}
            {recovery.lowStreak >= 3 ? ` · ${recovery.lowStreak} days low` : ""}
          </small>
        </div>
        <div>
          <span>Resting HR</span>
          <strong className={rhr.streak > 0 ? "num-off" : undefined}>{round(rhr.value)}</strong>
          <small>
            <Gap delta={rhr.delta} off={rhr.streak > 0} /> usual {round(rhr.usual)}
          </small>
        </div>
        <div>
          <span>HRV</span>
          <strong className={hrv.streak > 0 ? "num-off" : undefined}>{round(hrv.value)}</strong>
          <small>
            <Gap delta={hrv.delta} off={hrv.streak > 0} /> usual {round(hrv.usual)}
          </small>
        </div>
      </div>
      <ColumnChart
        label="Recovery, last 7 days"
        format="integer"
        series={[
          { key: "green", label: "Green", color: "#0ca30c" },
          { key: "yellow", label: "Yellow", color: "#fab219" },
          { key: "red", label: "Red", color: "#d03b3b" }
        ]}
        data={lastDays(date, 7).map((day, index) => {
          const score = recovery.trend7[index];
          const band = score == null ? null : recoveryBand(score);
          return { day, values: { green: band === "green" ? score : null, yellow: band === "yellow" ? score : null, red: band === "red" ? score : null } };
        })}
      />
      <VitalsChart
        days={lastDays(date, 7)}
        label="Resting heart rate and HRV, last 7 days"
        panels={[
          {
            key: "rhr",
            label: "Resting HR",
            unit: "bpm",
            values: rhr.trend7,
            usual: rhr.usual,
            // Within 3 bpm of usual; 3 or more above is red.
            band: rhr.usual == null ? null : [rhr.usual - 3, rhr.usual + 3],
            off: rhr.trend7.map((value) => value != null && rhr.usual != null && value - rhr.usual >= 3),
            color: "#3a3a3c"
          },
          {
            key: "hrv",
            label: "HRV",
            unit: "ms",
            values: hrv.trend7.map((value) => (value == null ? null : Math.round(value))),
            usual: hrv.usual,
            // Within 20% of usual; 20% or more below is red.
            band: hrv.usual == null ? null : [hrv.usual * 0.8, hrv.usual * 1.2],
            off: hrv.trend7.map((value) => value != null && hrv.usual != null && value <= hrv.usual * 0.8),
            color: "#3a3a3c"
          }
        ]}
      />
      <VitalsTable vitals={vitals} />
      <Facts rows={[["vs the week before", recovery.vsPrior7 == null ? "–" : `${recovery.vsPrior7 > 0 ? "+" : ""}${recovery.vsPrior7}`]]} />
    </>
  );
}

// Last night by stage: one bar, then each stage's time and share.
const STAGES = [
  { key: "deep", label: "Deep", color: "#1f4f8f" },
  { key: "rem", label: "REM", color: "#2a78d6" },
  { key: "light", label: "Light", color: "#9cc3ee" },
  { key: "awake", label: "Awake", color: "#d1d1d6" }
] as const;

const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

function SleepStages({ sleep }: { sleep: BodyState["physical"]["sleep"] }) {
  const minutes = { deep: sleep.deepMinutes, rem: sleep.remMinutes, light: sleep.lightMinutes, awake: sleep.awakeMinutes };
  const total = STAGES.reduce((sum, stage) => sum + (minutes[stage.key] ?? 0), 0);
  if (!total) return null;
  return (
    <div className="stage-chart">
      <div className="stage-bar" role="img" aria-label={STAGES.map((stage) => `${stage.label} ${minutes[stage.key] ?? 0} minutes`).join(", ")}>
        {STAGES.map((stage) =>
          minutes[stage.key] ? <span key={stage.key} style={{ width: `${((minutes[stage.key] ?? 0) / total) * 100}%`, background: stage.color }} /> : null
        )}
      </div>
      <div className="stage-legend">
        {STAGES.map((stage) => (
          <div key={stage.key}>
            <span>
              <i style={{ background: stage.color }} aria-hidden="true" />
              {stage.label}
            </span>
            <strong>{minutes[stage.key] == null ? "–" : hm(minutes[stage.key]!)}</strong>
            <small>{minutes[stage.key] == null ? "" : `${Math.round(((minutes[stage.key] ?? 0) / total) * 100)}%`}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// Tonight's need and what raised it: "8:24 (8:00 + 0:24 strain)".
function needLine(need: NonNullable<BodyState["physical"]["sleep"]["need"]>) {
  const extras = [
    need.strain ? `${hm(need.strain)} strain` : null,
    need.debt ? `${hm(need.debt)} debt` : null,
    need.illness ? `${hm(need.illness)} sick` : null
  ].filter(Boolean);
  return extras.length ? `${hm(need.minutes)} (${hm(need.baseline)} + ${extras.join(" + ")})` : hm(need.minutes);
}

// Sleep's trends: last night by stage, then 7 nights of bed and wake times over
// the usual night (stored states from before Oct 31, 2026 show stages instead).
export function SleepDetails({ state }: { state: BodyState }) {
  const { sleep } = state.physical;
  return (
    <>
      <SleepStages sleep={sleep} />
      {sleep.nights7?.some((night) => night.bedtime !== undefined) ? (
        <SleepWindowChart
          label="Bed and wake times, last 7 nights"
          color={STAGES[1].color}
          nights={sleep.nights7.map((night) => ({ date: night.date, bedtime: night.bedtime ?? null, wakeTime: night.wakeTime ?? null, minutes: night.minutes }))}
          usual={sleep.usualBedtime && sleep.usualWakeTime ? { bedtime: sleep.usualBedtime, wakeTime: sleep.usualWakeTime } : null}
        />
      ) : sleep.nights7?.length ? (
        <ColumnChart
          label="Sleep by stage, last 7 nights"
          format="hours"
          series={[
            { key: "deep", label: "Deep", color: STAGES[0].color },
            { key: "rem", label: "REM", color: STAGES[1].color },
            { key: "light", label: "Light", color: STAGES[2].color }
          ]}
          reference={{ value: 8, label: "need 8 h" }}
          data={sleep.nights7.map((night) => ({
            day: night.date,
            values: {
              deep: night.deep == null ? null : night.deep / 60,
              rem: night.rem == null ? null : night.rem / 60,
              light: night.light == null ? null : night.light / 60
            }
          }))}
        />
      ) : null}
      <Facts
        rows={[
          ["In bed", sleep.bedtime && sleep.wakeTime ? `${formatClockTime(sleep.bedtime)} – ${formatClockTime(sleep.wakeTime)}` : "–"],
          ["Short over 3 nights", (sleep.debt3n ?? 0) > 0 ? `${sleep.debt3n} min` : "–"],
          ["Sleep score", sleep.score == null ? "–" : `${sleep.score}%`],
          ["Need", sleep.need ? needLine(sleep.need) : "–"],
          ["Duration vs need", sleep.pct == null ? "–" : `${sleep.pct}%`],
          ["Consistency, 7 nights", sleep.consistency7n == null ? "–" : `${sleep.consistency7n}%`]
        ]}
      />
    </>
  );
}

// Strain's trends: 7 days of day strain against the usual (today still
// counting), hard days in a row and days since a rest day.
// Strain's trends: the day (what was done, or what's up next when nothing is
// yet), then the calendar week's workout minutes per heart-rate zone against
// goals, with the pace.
// The week's training breakdown lives on Training.
export function StrainDetails({
  state,
  done,
  isToday,
  zones,
  call = null
}: {
  state: BodyState;
  done: WeekRow["items"]; // the day's workouts
  isToday: boolean;
  // Claude's call for the day, when it's made; the rules' pick otherwise.
  call?: DailyCall | null;
  // Workout minutes per zone this calendar week through the day, and how many
  // of the week's days are over (for the pace).
  zones: { minutes: ZoneMinutes; bounds: ZoneBounds | null; daysDone: number };
}) {
  const pick = state.physical.training.suggested;
  return (
    <>
      <div className="strain-day">
        {done.length ? (
          <>
            <small>{isToday ? "Done today" : "Done"}</small>
            <ul>
              {done.map((item, index) => (
                <li key={index}>
                  <span>{item.title}</span>
                  {item.tag ? <small className={item.hard ? "hard" : undefined}>{item.tag}</small> : null}
                </li>
              ))}
            </ul>
          </>
        ) : isToday ? (
          <>
            <small>Up next</small>
            {call ? (
              <>
                <strong>{call.headline}</strong>
                {call.work.length ? <span>{workLine(call.work)}</span> : null}
              </>
            ) : (
              <>
                <strong>{callOf(state).replace(/^./, (letter) => letter.toUpperCase())}</strong>
                {pick.name && pick.work.length ? <span>{workText(pick.work)}</span> : null}
                {pick.note ? <span>{pick.note}</span> : null}
              </>
            )}
          </>
        ) : (
          <>
            <small>Done</small>
            <strong>Rest day</strong>
          </>
        )}
      </div>
      <div className="zone-tiles" aria-label="Workout minutes by heart-rate zone this week">
        {ZONES.map((zone) => {
          const goal = ZONE_GOALS[zone.key];
          const minutes = zones.minutes[zone.key];
          const pace = goal == null ? null : zonePace(minutes, goal, zones.daysDone);
          return (
            <div key={zone.key} className="split-tile">
              <strong className={pace?.status === "behind" ? "short" : undefined}>
                {minutes}
                {goal != null ? <span className="zone-goal">/{goal}</span> : null}
              </strong>
              <span>{zone.label}</span>
              {zones.bounds ? (
                <small>
                  {zone.key === "light"
                    ? `<${zones.bounds.moderate.min}`
                    : zone.key === "peak"
                      ? `${zones.bounds.peak.min}+`
                      : `${zones.bounds[zone.key].min}–${zones.bounds[zone.key].max}`}
                </small>
              ) : null}
              {pace ? (
                <small className={`zone-pace ${pace.status}`}>
                  {pace.status === "done" ? "Done" : pace.status === "on_pace" ? "On pace" : `${pace.behind} behind`}
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="zone-tiles-note">Workout minutes by heart-rate zone this week, Monday to Sunday</p>
    </>
  );
}

// "Hard: Chest, Triceps · Medium: Front Delts"
function workText(work: { muscle: string; intensity: Intensity }[]) {
  return [...INTENSITIES]
    .reverse()
    .map((intensity) => ({ intensity, muscles: work.filter((item) => item.intensity === intensity).map((item) => item.muscle) }))
    .filter((group) => group.muscles.length)
    .map((group) => `${INTENSITY_RULES[group.intensity].label}: ${group.muscles.join(", ")}`)
    .join(" · ");
}
