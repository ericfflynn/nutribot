// Pieces of the body state (docs/body-state.md) shown on Today: the sick
// line under the day scores, and the trends each score opens.
import type { ReactNode } from "react";
import { ColumnChart, VitalsChart } from "./charts";
import { addDays, todayLocalDate } from "@/lib/dates";
import { formatClockTime } from "@/lib/habits";
import type { BodyState, Status, Vital } from "@/lib/body-state/types";
import { recoveryBand } from "@/lib/health/scores";
import { fahrenheitDelta } from "@/lib/health/units";

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
            off: rhr.trend7.map((value) => value != null && rhr.usual != null && value - rhr.usual >= 3),
            color: "#3a3a3c"
          },
          {
            key: "hrv",
            label: "HRV",
            unit: "ms",
            values: hrv.trend7.map((value) => (value == null ? null : Math.round(value))),
            usual: hrv.usual,
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

// Sleep's trends: last night by stage, then 7 nights of stages against the 8-hour need.
export function SleepDetails({ state }: { state: BodyState }) {
  const { sleep } = state.physical;
  return (
    <>
      <SleepStages sleep={sleep} />
      {sleep.nights7?.length ? (
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
          ["Short over 3 nights", (sleep.debt3n ?? 0) > 0 ? `${sleep.debt3n} min` : "–"]
        ]}
      />
    </>
  );
}

// Strain's trends: 7 days of day strain against the usual (today still
// counting), hard days in a row and days since a rest day.
export function StrainDetails({ state }: { state: BodyState }) {
  const { load } = state.physical;
  const date = state.meta.date;
  return (
    <>
      {load.trend7?.length ? (
        <ColumnChart
          label="Day strain, last 7 days"
          format="decimal"
          series={[{ key: "strain", label: "Strain", color: "#eb6834" }]}
          reference={load.strain28 == null ? undefined : { value: load.strain28, label: `usual ${round(load.strain28, 1)}` }}
          data={lastDays(date, 7).map((day, index) => ({ day, values: { strain: load.trend7[index] }, partial: day === todayLocalDate() }))}
        />
      ) : null}
      <Facts
        rows={[
          ["Average, last 7 days", load.strain7 == null ? "–" : round(load.strain7, 1)],
          ["Hard days in a row", `${load.hardStreak}`],
          ["Since a rest day", `${load.daysSinceRest} day${load.daysSinceRest === 1 ? "" : "s"}`]
        ]}
      />
    </>
  );
}
