"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteSorenessAction, logSorenessAction } from "./actions";
import { SEVERITIES, WEEKLY_TARGET_POINTS, type Severity, type TrackedMuscle, type WeekBucket } from "@/lib/workouts";

export type MuscleView = {
  muscle: TrackedMuscle;
  bucket: WeekBucket;
  readyIn: number;
  points: number;
  // "Thu, Oct 16 · Push day · hard", newest first.
  sessions: string[];
  // Soreness still counting, newest first; `today` reports can be replaced.
  sore: { id: string; severity: Severity; when: string; today: boolean }[];
};

const BUCKET_LABELS: Record<WeekBucket, string> = { due: "Due", recovering: "Recovering", covered: "Covered" };

// The map's shade: covered, recovering, or due (darker the further short).
function shadeOf(view: MuscleView | undefined) {
  if (!view) return "due due-low";
  if (view.bucket !== "due") return view.bucket;
  return view.points <= 1 ? "due due-low" : "due due-high";
}

// Shapes for one figure, 120 wide. `pair` shapes are drawn on the left and
// mirrored to the right. Schematic, not anatomical: each tracked muscle gets
// one clear tap target in roughly the right place.
type Shape = { muscle: TrackedMuscle; pair: boolean; draw: (props: object) => ReactNode };
const ellipse = (cx: number, cy: number, rx: number, ry: number, rotate = 0) =>
  function Ellipse(props: object) {
    return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined} {...props} />;
  };
const path = (d: string) =>
  function Path(props: object) {
    return <path d={d} {...props} />;
  };
const rect = (x: number, y: number, width: number, height: number) =>
  function Rect(props: object) {
    return <rect x={x} y={y} width={width} height={height} rx={3} {...props} />;
  };

const FRONT: Shape[] = [
  { muscle: "Chest", pair: true, draw: path("M59 42 L44 43 Q39 50 42 60 Q48 66 59 64 Z") },
  { muscle: "Side Delts", pair: true, draw: ellipse(32, 46, 4.5, 7.5, 12) },
  { muscle: "Front Delts", pair: true, draw: ellipse(38, 46, 4.5, 7, 8) },
  { muscle: "Biceps", pair: true, draw: ellipse(31.5, 66, 4.8, 11, 6) },
  { muscle: "Forearms", pair: true, draw: ellipse(27.2, 106, 4.2, 13, 5) },
  { muscle: "Upper Abs", pair: true, draw: rect(52, 68, 7.5, 19) },
  { muscle: "Lower Abs", pair: true, draw: rect(52.5, 89, 7, 20) },
  { muscle: "Obliques", pair: true, draw: path("M44 70 Q48 69 50 72 L50 104 Q46 102 44 96 Q42 84 44 70 Z") },
  { muscle: "Quads", pair: true, draw: ellipse(50.5, 149, 8.5, 25, 3) }
];

const BACK: Shape[] = [
  { muscle: "Upper Back", pair: true, draw: path("M59 51 L53 47 L49 56 L52 71 L59 75 Z") },
  { muscle: "Traps", pair: false, draw: path("M60 27 L52 33 L42 39 L52 42 L60 49 L68 42 L78 39 L68 33 Z") },
  { muscle: "Side Delts", pair: true, draw: ellipse(32, 46, 4.5, 7.5, 12) },
  { muscle: "Rear Delts", pair: true, draw: ellipse(38, 47, 4.5, 7, 8) },
  { muscle: "Lats", pair: true, draw: path("M47 58 Q42 63 42 75 Q44 88 53 97 L55 94 Q54 83 49 72 Z") },
  { muscle: "Lower Back", pair: false, draw: rect(54, 92, 12, 20) },
  { muscle: "Triceps", pair: true, draw: ellipse(31.5, 66, 4.8, 11, 6) },
  { muscle: "Forearms", pair: true, draw: ellipse(27.2, 106, 4.2, 13, 5) },
  { muscle: "Glutes", pair: true, draw: ellipse(51, 124, 9, 10) },
  { muscle: "Hamstrings", pair: true, draw: ellipse(50, 157, 8, 21, 3) },
  { muscle: "Calves", pair: true, draw: ellipse(48, 203, 6.5, 17) }
];

// The body behind the muscles: head, torso, arms and legs.
function Silhouette() {
  const limbs = (
    <>
      <path d="M34 44 L29 86" strokeWidth={11} />
      <path d="M29 86 L25 128" strokeWidth={9} />
      <path d="M50 118 L48 180" strokeWidth={20} />
      <path d="M48 180 L47 238" strokeWidth={13} />
    </>
  );
  return (
    <g className="body-silhouette">
      <circle cx={60} cy={16} r={10} />
      <rect x={55} y={24} width={10} height={10} rx={3} />
      <path d="M40 38 Q60 33 80 38 L83 60 Q80 90 76 118 L44 118 Q40 90 37 60 Z" />
      <path d="M44 112 L76 112 L78 128 L60 134 L42 128 Z" />
      <g className="body-limbs">
        {limbs}
        <g transform="translate(120 0) scale(-1 1)">{limbs}</g>
      </g>
      <circle cx={24} cy={134} r={5} />
      <circle cx={96} cy={134} r={5} />
      <ellipse cx={46} cy={244} rx={7} ry={4} />
      <ellipse cx={74} cy={244} rx={7} ry={4} />
    </g>
  );
}

function Figure({
  shapes,
  x,
  label,
  stateOf,
  selected,
  onPick
}: {
  shapes: Shape[];
  x: number;
  label: string;
  stateOf: (muscle: TrackedMuscle) => string;
  selected: TrackedMuscle | null;
  onPick: (muscle: TrackedMuscle) => void;
}) {
  const props = (muscle: TrackedMuscle) => ({
    className: `body-muscle ${stateOf(muscle)}${selected === muscle ? " selected" : ""}`,
    onClick: () => onPick(muscle)
  });
  return (
    <g transform={`translate(${x} 0)`}>
      <Silhouette />
      {shapes.map((shape) => (
        <g key={shape.muscle}>
          {shape.draw(props(shape.muscle))}
          {shape.pair ? <g transform="translate(120 0) scale(-1 1)">{shape.draw(props(shape.muscle))}</g> : null}
        </g>
      ))}
      <text x={60} y={262} className="body-map-caption">
        {label}
      </text>
    </g>
  );
}

// Front and back figures shaded by the weekly target: due (ready and short of
// 4 points), recovering (short but not ready) or covered. Tapping a muscle
// shows its week, and can report it sore today.
export function BodyMap({ muscles }: { muscles: MuscleView[] }) {
  const [selected, setSelected] = useState<TrackedMuscle | null>(null);
  const byMuscle = new Map(muscles.map((view) => [view.muscle, view]));
  const stateOf = (muscle: TrackedMuscle) => shadeOf(byMuscle.get(muscle));
  const pick = (muscle: TrackedMuscle) => setSelected(selected === muscle ? null : muscle);
  const view = selected ? byMuscle.get(selected) : undefined;
  const count = (bucket: WeekBucket) => muscles.filter((item) => item.bucket === bucket).length;

  return (
    <div className="body-map">
      <svg viewBox="0 0 260 270" role="group" aria-label="Muscles by weekly volume">
        <Figure shapes={FRONT} x={4} label="Front" stateOf={stateOf} selected={selected} onPick={pick} />
        <Figure shapes={BACK} x={136} label="Back" stateOf={stateOf} selected={selected} onPick={pick} />
      </svg>
      <div className="body-map-legend">
        <span>
          <i className="body-swatch due due-low" /> Due {count("due")}
        </span>
        <span>
          <i className="body-swatch recovering" /> Recovering {count("recovering")}
        </span>
        <span>
          <i className="body-swatch covered" /> Covered {count("covered")}
        </span>
      </div>
      {view ? (
        <MuscleDetail key={view.muscle} view={view} onClose={() => setSelected(null)} />
      ) : (
        <p className="body-map-hint">Tap a muscle for its week.</p>
      )}
      {/* The same state as a list, for screen readers. */}
      <ul className="visually-hidden">
        {muscles.map((item) => (
          <li key={item.muscle}>
            {item.muscle}: {BUCKET_LABELS[item.bucket]}, {item.points} of {WEEKLY_TARGET_POINTS} points
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
        <span className={`muscle-state ${shadeOf(view)}`}>{BUCKET_LABELS[view.bucket]}</span>
        <span className="muscle-detail-ready">
          {view.readyIn ? `ready in ${view.readyIn} day${view.readyIn === 1 ? "" : "s"}` : "ready"}
        </span>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close">
          Done
        </button>
      </div>
      <p className="muscle-detail-points">
        {view.points}/{WEEKLY_TARGET_POINTS} points this week
      </p>
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
