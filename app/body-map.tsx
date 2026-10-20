"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSorenessAction, logSorenessAction } from "./actions";
import { BODY_BACK, BODY_FRONT, BODY_VIEWBOX } from "./body-map-paths";
import { SEVERITIES, WEEKLY_TARGET_POINTS, type Severity, type TrackedMuscle, type WeekBucket } from "@/lib/workouts";

export type MuscleView = {
  muscle: TrackedMuscle;
  bucket: WeekBucket;
  readyIn: number;
  // 0 fresh to 1 fully fatigued (fatigueLevel in lib/workouts.ts).
  fatigue: number;
  points: number;
  // "Thu, Oct 16 · Push day · hard", newest first.
  sessions: string[];
  // Soreness still counting, newest first; `today` reports can be replaced.
  sore: { id: string; severity: Severity; when: string; today: boolean }[];
};

const BUCKET_LABELS: Record<WeekBucket, string> = { due: "Due", recovering: "Recovering", covered: "Covered" };

// Fresh muscles are the body's grey; any fatigue is red, from light (a day
// to go) to deep (a hard session today). Mixing grey into red reads as pink.
const GREY = "rgb(212 212 218)";
const LIGHT_RED = [246, 178, 166];
const RED = [208, 32, 24];
function fillOf(fatigue: number) {
  if (fatigue <= 0) return GREY;
  const mix = LIGHT_RED.map((value, index) => Math.round(value + (RED[index] - value) * fatigue));
  return `rgb(${mix.join(" ")})`;
}

function fatigueLabel(view: MuscleView) {
  if (!view.readyIn) return "Fresh";
  return `${view.fatigue >= 0.6 ? "Fatigued" : "Recovering"}, ready in ${view.readyIn} day${view.readyIn === 1 ? "" : "s"}`;
}

function Figure({
  side,
  fatigueOf,
  selected,
  onPick
}: {
  side: "front" | "back";
  fatigueOf: (muscle: TrackedMuscle) => number;
  selected: TrackedMuscle | null;
  onPick: (muscle: TrackedMuscle) => void;
}) {
  const regions = side === "front" ? BODY_FRONT : BODY_BACK;
  return (
    <figure className="body-figure">
      <svg viewBox={BODY_VIEWBOX[side]} role="group" aria-label={side === "front" ? "Front" : "Back"}>
        {regions.map((region) => {
          const muscle = region.muscle;
          const className = muscle
            ? `body-muscle${selected === muscle ? " selected" : ""}`
            : region.slug === "hair"
              ? "body-hair"
              : "body-part";
          return (
            <g
              key={region.slug}
              className={className}
              fill={muscle ? fillOf(fatigueOf(muscle)) : undefined}
              onClick={muscle ? () => onPick(muscle) : undefined}
            >
              {region.paths.map((d, index) => (
                <path key={index} d={d} />
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption>{side === "front" ? "Front" : "Back"}</figcaption>
    </figure>
  );
}

// Front and back figures, each muscle tinted from grey (fresh) to red
// (fatigued: just trained hard, or sore). Tapping a muscle shows its week
// against the 4-point target, and can report it sore today.
export function BodyMap({ muscles }: { muscles: MuscleView[] }) {
  const [selected, setSelected] = useState<TrackedMuscle | null>(null);
  const byMuscle = new Map(muscles.map((view) => [view.muscle, view]));
  const fatigueOf = (muscle: TrackedMuscle) => byMuscle.get(muscle)?.fatigue ?? 0;
  const pick = (muscle: TrackedMuscle) => setSelected(selected === muscle ? null : muscle);
  const view = selected ? byMuscle.get(selected) : undefined;

  return (
    <div className="body-map">
      <div className="body-figures">
        <Figure side="front" fatigueOf={fatigueOf} selected={selected} onPick={pick} />
        <Figure side="back" fatigueOf={fatigueOf} selected={selected} onPick={pick} />
      </div>
      <div className="body-map-legend" aria-hidden="true">
        <span>Fresh</span>
        <i className="body-scale" style={{ background: `linear-gradient(90deg, ${fillOf(0)} 0 18%, ${fillOf(0.2)} 18%, ${fillOf(1)})` }} />
        <span>Fatigued</span>
      </div>
      {view ? (
        <MuscleDetail key={view.muscle} view={view} onClose={() => setSelected(null)} />
      ) : (
        <p className="body-map-hint">Tap a muscle for its week.</p>
      )}
      {/* The same as a list, for screen readers. */}
      <ul className="visually-hidden">
        {muscles.map((item) => (
          <li key={item.muscle}>
            {item.muscle}: {fatigueLabel(item)}; {item.points} of {WEEKLY_TARGET_POINTS} points, {BUCKET_LABELS[item.bucket].toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MuscleDetail({ view, onClose }: { view: MuscleView; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todays = view.sore.find((report) => report.today);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error ?? "Couldn't save that.");
  }

  return (
    <div className="muscle-detail">
      <div className="muscle-detail-head">
        <strong>{view.muscle}</strong>
        <span className={`muscle-state ${view.bucket}`}>
          {view.points}/{WEEKLY_TARGET_POINTS} · {BUCKET_LABELS[view.bucket]}
        </span>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close">
          Done
        </button>
      </div>
      <p className="muscle-detail-points">{fatigueLabel(view)}</p>
      {view.sessions.length || view.sore.length ? (
        <ul className="muscle-detail-list">
          {view.sore.map((report) => (
            <li key={report.id}>
              <span>
                Sore ({report.severity}) {report.when}
              </span>
              <button type="button" className="text-button" disabled={busy} onClick={() => run(() => deleteSorenessAction(report.id))}>
                Remove
              </button>
            </li>
          ))}
          {view.sessions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="muscle-detail-points">Not trained this week.</p>
      )}
      <div className="muscle-detail-sore" role="group" aria-label={`${view.muscle} soreness today`}>
        <span>Sore today</span>
        {SEVERITIES.map((severity) => (
          <button
            key={severity}
            type="button"
            className={`pill-button${todays?.severity === severity ? " on" : ""}`}
            aria-pressed={todays?.severity === severity}
            disabled={busy}
            onClick={() =>
              run(() => (todays?.severity === severity ? deleteSorenessAction(todays.id) : logSorenessAction(view.muscle, severity)))
            }
          >
            {severity === "mild" ? "Mild" : "Bad"}
          </button>
        ))}
      </div>
      {error ? <p className="workout-editor-error">{error}</p> : null}
    </div>
  );
}
