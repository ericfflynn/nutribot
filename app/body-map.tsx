"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSorenessAction, logSorenessAction } from "./actions";
import { BODY_BACK, BODY_FRONT, BODY_VIEWBOX } from "./body-map-paths";
import { SORENESS_LEVELS, WEEKLY_TARGET_POINTS, sorenessStep, type TrackedMuscle, type WeekBucket } from "@/lib/workouts";

export type MuscleView = {
  muscle: TrackedMuscle;
  bucket: WeekBucket;
  readyIn: number;
  // 0 fresh to 1 very sore (fatigueLevel in lib/workouts.ts).
  fatigue: number;
  // Soreness, 0 fresh to 3 very sore (sorenessOf), and the level the owner
  // set today, if he did.
  level: number;
  today: { id: string; level: number } | null;
  points: number;
  // "Thu, Oct 16 · Push day · hard", newest first.
  sessions: string[];
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
  const label = SORENESS_LEVELS[sorenessStep(view.level)];
  if (!view.readyIn) return label;
  return `${label}, fresh in ${view.readyIn} day${view.readyIn === 1 ? "" : "s"}`;
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

// Front and back figures, each muscle tinted from grey (fresh) to red (very
// sore). Tapping a muscle shows its week and its soreness, which the owner
// can set to how it actually feels.
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
        <span>Very sore</span>
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
  const step = sorenessStep(view.level);

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
      {view.sessions.length ? (
        <ul className="muscle-detail-list">
          {view.sessions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="muscle-detail-points">Not trained this week.</p>
      )}
      <div className="muscle-detail-sore" role="group" aria-label={`How ${view.muscle} feels today`}>
        <span>Feels</span>
        {SORENESS_LEVELS.map((label, level) => (
          <button
            key={label}
            type="button"
            className={`pill-button${step === level ? " on" : ""}`}
            aria-pressed={step === level}
            disabled={busy}
            onClick={() => run(() => logSorenessAction(view.muscle, level))}
          >
            {label}
          </button>
        ))}
      </div>
      {view.today ? (
        <p className="muscle-detail-points">
          You set this today.{" "}
          <button type="button" className="text-button" disabled={busy} onClick={() => run(() => deleteSorenessAction(view.today!.id))}>
            Use workouts instead
          </button>
        </p>
      ) : null}
      {error ? <p className="workout-editor-error">{error}</p> : null}
    </div>
  );
}
