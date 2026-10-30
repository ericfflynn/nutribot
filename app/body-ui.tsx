// Today's body-state card (docs/body-state.md): Physical with the day's
// scores and its areas. Mental and lifestyle stay in the body state (the
// chat and the check-in use them) but aren't shown on Today. Areas open with <details>; the one setting a domain's status
// starts open.
import Link from "next/link";
import type { ReactNode } from "react";
import { ColumnChart, VitalsChart } from "./charts";
import { addDays, todayLocalDate } from "@/lib/dates";
import { callOf } from "@/lib/body-state/brief";
import type { BodyState, Head, Status, Vital } from "@/lib/body-state/types";
import { formatClockTime } from "@/lib/habits";
import { recoveryBand } from "@/lib/health/scores";
import { SEVERITY_LABELS } from "@/lib/illness-days";

const STATUS_LABELS: Record<Status, string> = { good: "Good", ok: "Ok", watch: "Watch", low: "Low", unknown: "No data" };
const shortDay = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

const lastDays = (date: string, count: number) => Array.from({ length: count }, (_, index) => addDays(date, index - count + 1));
const round = (value: number | null, places = 0) => (value == null ? "–" : (Math.round(value * 10 ** places) / 10 ** places).toString());

export function StatusChip({ status }: { status: Status }) {
  return <span className={`status-chip ${status}`}>{STATUS_LABELS[status]}</span>;
}

// One row of the Body card: a status dot, the area, a short value
// ("HR 60 · HRV 52"), and its details when tapped open.
function AreaRow({ name, status, value, open, children }: { name: string; status: Status; value: ReactNode; open: boolean; children: ReactNode }) {
  return (
    <details className="area-row" open={open}>
      <summary>
        <span className={`status-dot ${status}`} aria-label={STATUS_LABELS[status]} />
        <span className="area-name">{name}</span>
        <span className="area-headline">{value}</span>
        <svg className="area-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="area-body">{children}</div>
    </details>
  );
}

function DomainHead({ name, head }: { name: string; head: Head }) {
  return (
    <div className="domain-head">
      <div>
        <h2 className="card-title">{name}</h2>
        <span>{head.headline}</span>
      </div>
      <StatusChip status={head.status} />
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
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

// Last night by stage: one bar, then each stage's minutes and share.
const STAGES = [
  { key: "deep", label: "Deep", color: "#1f4f8f" },
  { key: "rem", label: "REM", color: "#2a78d6" },
  { key: "light", label: "Light", color: "#9cc3ee" },
  { key: "awake", label: "Awake", color: "#d1d1d6" }
] as const;

function hm(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
}

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

// Days since each day type was worked, against the 7-day mark.
function DaysSince({ groups }: { groups: Record<string, number | null> }) {
  const names: [string, string][] = [
    ["push", "Push"],
    ["pull", "Pull"],
    ["legs", "Legs"],
    ["core", "Core"]
  ];
  return (
    <div className="days-since" role="list">
      {names.map(([key, name]) => {
        const days = groups[key];
        const width = days == null ? 100 : Math.min(100, (days / 10) * 100);
        return (
          <div key={key} role="listitem">
            <span>{name}</span>
            <div className="days-since-track" aria-hidden="true">
              <span className={days == null || days >= 7 ? "over" : undefined} style={{ width: `${width}%` }} />
              <i style={{ left: "70%" }} />
            </div>
            <strong>{days == null ? "30+" : days} d</strong>
          </div>
        );
      })}
      <small>Line: 7 days, when a day type is due for the week.</small>
    </div>
  );
}

const VITAL_ROWS: { key: keyof Omit<BodyState["physical"]["vitals"], "status" | "headline">; name: string; format: (value: number) => string }[] = [
  { key: "restingHr", name: "Resting HR", format: (value) => `${Math.round(value)}` },
  { key: "hrv", name: "HRV", format: (value) => `${Math.round(value)}` },
  { key: "sleepTemp", name: "Sleep temp", format: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}°` },
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

export type DayScore = { label: string; value: string; note: string; color: string };

const WORST_FIRST: Status[] = ["low", "watch", "ok", "good", "unknown"];
const worstStatus = (a: Status, b: Status) => (WORST_FIRST.indexOf(a) <= WORST_FIRST.indexOf(b) ? a : b);

const BAND_INK = { green: "#0a7f0a", yellow: "#8a5d00", red: "#b42f2f" } as const;

// The gap from usual: "↑6", red when it's off.
function Gap({ delta, off }: { delta: number | null; off: boolean }) {
  if (delta == null) return null;
  const rounded = Math.round(delta);
  if (!rounded) return <span className="gap">±0</span>;
  return <span className={`gap${off ? " off" : ""}`}>{rounded > 0 ? "↑" : "↓"}{Math.abs(rounded)}</span>;
}

// A number, red when it's off its usual.
function Num({ value, off }: { value: string; off: boolean }) {
  return <strong className={off ? "num-off" : undefined}>{value}</strong>;
}

const ILLNESS_VALUE = { sick: "", recovering: "Easing back", early_signs: "Early signs", well: "" } as const;

// The Body card: the day's four numbers, then each area as a short value
// that opens, fuel among them, and water at the bottom. The area setting the
// status starts open, and so does fuel on today.
export function BodyCard({
  state,
  scores,
  fuel,
  water
}: {
  state: BodyState;
  scores: DayScore[];
  fuel: { status: Status; value: string; open: boolean; details: ReactNode };
  water: ReactNode;
}) {
  const { physical } = state;
  const date = state.meta.date;
  const driving = (area: Head) => (physical.status === "low" || physical.status === "watch") && area.headline === physical.headline;
  const { sleep, recovery, vitals, illness, load, training } = physical;
  const showIllness = illness.phase !== "well" || illness.explainedBy.length > 0;
  const illnessValue =
    illness.phase === "sick" && illness.told
      ? `${SEVERITY_LABELS[illness.told.severity]} · day ${illness.told.day}`
      : illness.phase === "well"
        ? `Likely ${illness.explainedBy[0]}`
        : ILLNESS_VALUE[illness.phase];
  const rhr = vitals.restingHr;
  const hrv = vitals.hrv;
  return (
    <section className="card body-card" aria-label="Body">
      <DomainHead name="Body" head={physical} />
      <div className="body-scores four">
        {scores.map((score) => (
          <div key={score.label}>
            <span style={{ color: score.color }}>{score.label}</span>
            <strong>{score.value}</strong>
            <small>{score.note}</small>
          </div>
        ))}
      </div>
      <div className="area-list">
        {showIllness ? (
          <AreaRow name="Illness" status={illness.status} value={illnessValue} open={driving(illness)}>
            <Facts
              rows={[
                ...(illness.phaseSince ? ([["Since", shortDay.format(new Date(`${illness.phaseSince}T00:00:00Z`))]] as [string, ReactNode][]) : []),
                ...(illness.told?.symptoms.length ? ([["Symptoms", illness.told.symptoms.join(", ")]] as [string, ReactNode][]) : []),
                ...(illness.told ? ([["From", illness.told.source === "journal" ? "Your journal" : "What you logged"]] as [string, ReactNode][]) : []),
                ...(illness.explainedBy.length ? ([["Likely", illness.explainedBy.join(", ")]] as [string, ReactNode][]) : [])
              ]}
            />
          </AreaRow>
        ) : null}
        {/* Recovery is computed from HRV and resting HR, so they share a row;
            in the body state they stay separate areas. */}
        <AreaRow
          name="Recovery"
          status={worstStatus(recovery.status, vitals.status)}
          value={
            <>
              {recovery.score == null ? "–" : recovery.score} · HR <Num value={round(rhr.value)} off={rhr.streak > 0} />{" "}
              <Gap delta={rhr.delta} off={rhr.streak > 0} /> · HRV <Num value={round(hrv.value)} off={hrv.streak > 0} />{" "}
              <Gap delta={hrv.delta} off={hrv.streak > 0} />
            </>
          }
          open={driving(recovery) || driving(vitals)}
        >
          <div className="body-scores headline">
            <div>
              <span style={{ color: recovery.band ? BAND_INK[recovery.band] : "var(--muted)" }}>Recovery</span>
              <strong>{recovery.score ?? "–"}</strong>
              <small>{recovery.band ? recovery.band[0].toUpperCase() + recovery.band.slice(1) : "No data"}{recovery.lowStreak >= 3 ? ` · ${recovery.lowStreak} days low` : ""}</small>
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
        </AreaRow>
        <AreaRow name="Fuel" status={fuel.status} value={fuel.value} open={fuel.open}>
          {fuel.details}
        </AreaRow>
        <AreaRow
          name="Sleep"
          status={sleep.status}
          value={sleep.bedtime && sleep.wakeTime ? `${formatClockTime(sleep.bedtime)} – ${formatClockTime(sleep.wakeTime)}` : sleep.minutes == null ? "–" : `${sleep.pct}%`}
          open={driving(sleep)}
        >
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
          {(sleep.debt3n ?? 0) > 0 ? <Facts rows={[["Short over 3 nights", `${sleep.debt3n} min`]]} /> : null}
        </AreaRow>
        <AreaRow name="Load" status={load.status} value={load.strain7 == null ? "–" : `${round(load.strain7, 1)} a day`} open={driving(load)}>
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
              ["Hard days in a row", `${load.hardStreak}`],
              ["Since a rest day", `${load.daysSinceRest} days`]
            ]}
          />
        </AreaRow>
        <AreaRow name="Training" status={training.status} value={callOf(state).replace(/^a /, "").replace(/^./, (letter) => letter.toUpperCase())} open={false}>
          <DaysSince groups={training.groups} />
          <Link className="area-link" href="/training">
            Open Training
          </Link>
        </AreaRow>
      </div>
      {water}
    </section>
  );
}
