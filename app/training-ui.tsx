"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteWorkoutSessionAction,
  ignoreWorkoutAction,
  labelWorkoutAction,
  mergeWorkoutsAction,
  separateWorkoutAction,
  updateWorkoutSessionAction
} from "./actions";
import { openChat } from "./chat-sheet";
import {
  INTENSITIES,
  INTENSITY_RULES,
  MUSCLE_GROUPS,
  MUSCLES,
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABELS,
  currentMuscles,
  groupOf,
  intensityFromRpe,
  type Intensity,
  type MuscleGroup,
  type MuscleIntensity,
  type MuscleName,
  type WorkoutType
} from "@/lib/workouts";

// The editor's type picker, for real fixes ("that was a run"). Labeling
// doesn't ask: the muscles decide whether a workout counts as strength,
// mobility or both. A mix of everything is "Mixed / other".
const TYPE_OPTION_LABELS: Partial<Record<WorkoutType, string>> = {
  other: "Mixed / other",
  class: "Class (spin, aerobics)"
};

function TypeSelect({ value, onChange }: { value: WorkoutType; onChange: (next: WorkoutType) => void }) {
  return (
    <label className="workout-editor-field">
      <span>Type</span>
      <select value={value} onChange={(event) => onChange(event.target.value as WorkoutType)}>
        {WORKOUT_TYPES.map((type) => (
          <option key={type} value={type}>
            {TYPE_OPTION_LABELS[type] ?? WORKOUT_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
    </label>
  );
}

// Labels an unlabeled watch workout: describe it in chat (opens with a
// sentence ready to finish), or pick muscles (optional) and effort right
// here. The type is what the watch's type most likely is (`defaultType`);
// the editor can change it later.
export function LabelButton({
  prompt,
  workoutId,
  date,
  defaultType
}: {
  prompt: string;
  workoutId: string;
  date: string;
  defaultType: WorkoutType;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [muscles, setMuscles] = useState<MuscleName[]>([]);
  const [intensity, setIntensity] = useState<MuscleIntensity>({});
  const [effort, setEffort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await labelWorkoutAction(workoutId, date, {
      workoutType: defaultType,
      muscleGroups: muscles,
      muscleIntensity: intensity,
      rpe: effort === "" ? null : Number(effort)
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    setPicking(false);
    router.refresh();
  }

  async function ignore() {
    setBusy(true);
    const result = await ignoreWorkoutAction(workoutId, date, true);
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error ?? "Couldn't ignore that.");
  }

  if (!picking) {
    return (
      <span className="label-actions">
        <button type="button" className="pill-button" onClick={() => setPicking(true)}>
          Label
        </button>
        <button type="button" className="pill-button" onClick={() => openChat(prompt)}>
          Chat
        </button>
        <button type="button" className="text-button label-ignore" disabled={busy} onClick={ignore}>
          Ignore
        </button>
        {error ? <span className="workout-editor-error">{error}</span> : null}
      </span>
    );
  }
  return (
    <div className="workout-editor label-picker">
      <MusclePicker value={muscles} onChange={setMuscles} />
      <label className="workout-editor-field">
        <span>RPE</span>
        <select value={effort} onChange={(event) => setEffort(event.target.value)}>
          <option value="">Not set</option>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <IntensityPicker names={muscles} rpe={effort === "" ? null : Number(effort)} value={intensity} onChange={setIntensity} />
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="workout-editor-actions">
        <span className="workout-editor-spacer" />
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => setPicking(false)}>
          Cancel
        </button>
        <button type="button" className="button compact" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// Group first, then muscles. Tapping a group selects the whole group and
// shows its muscles; picking muscles narrows it, and unpicking the last one
// goes back to the whole group. Tapping the group again clears it.
export function MusclePicker({ value, onChange }: { value: MuscleName[]; onChange: (next: MuscleName[]) => void }) {
  const active = (group: MuscleGroup) => value.some((name) => groupOf(name) === group);

  function toggleGroup(group: MuscleGroup) {
    onChange(active(group) ? value.filter((name) => groupOf(name) !== group) : [...value, group]);
  }

  function toggleMuscle(muscle: MuscleName) {
    const group = groupOf(muscle);
    if (value.includes(muscle)) {
      const rest = value.filter((name) => name !== muscle);
      onChange(rest.some((name) => groupOf(name) === group) ? rest : [...rest, group]);
    } else {
      onChange([...value.filter((name) => name !== group), muscle]);
    }
  }

  const open = MUSCLE_GROUPS.filter((group) => active(group) && MUSCLES[group].length);

  return (
    <fieldset className="workout-editor-groups">
      <legend>Muscles</legend>
      <div className="muscle-row">
        {MUSCLE_GROUPS.map((group) => {
          const on = active(group);
          return (
            <button
              key={group}
              type="button"
              className={on ? "muscle-toggle on" : "muscle-toggle"}
              aria-pressed={on}
              onClick={() => toggleGroup(group)}
            >
              {group}
            </button>
          );
        })}
      </div>
      {open.map((group) => (
        <div key={group} className="muscle-subgroup">
          <span>{value.includes(group) ? `${group}: whole group, or pick` : `${group}:`}</span>
          <div className="muscle-row">
            {MUSCLES[group].map((muscle: MuscleName) => {
              const on = value.includes(muscle);
              return (
                <button
                  key={muscle}
                  type="button"
                  className={on ? "muscle-toggle small on" : "muscle-toggle small"}
                  aria-pressed={on}
                  onClick={() => toggleMuscle(muscle)}
                >
                  {muscle}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

// Light, medium or hard for each picked group or muscle. The highlighted one
// is what counts; until one is tapped it follows the RPE. Tapping the picked
// one again goes back to the RPE.
export function IntensityPicker({
  names,
  rpe,
  value,
  onChange
}: {
  names: MuscleName[];
  rpe: number | null;
  value: MuscleIntensity;
  onChange: (next: MuscleIntensity) => void;
}) {
  if (!names.length) return null;
  const fromRpe = intensityFromRpe(rpe);

  function pick(name: MuscleName, intensity: Intensity) {
    const next = { ...value };
    if (next[name] === intensity) delete next[name];
    else next[name] = intensity;
    onChange(next);
  }

  return (
    <fieldset className="workout-editor-groups">
      <legend>Intensity</legend>
      {names.map((name) => {
        const current = value[name] ?? fromRpe;
        return (
          <div key={name} className="intensity-row">
            <span>
              {name}
              {value[name] ? null : <small> from RPE</small>}
            </span>
            <div className="intensity-options" role="group" aria-label={`${name} intensity`}>
              {INTENSITIES.map((intensity) => (
                <button
                  key={intensity}
                  type="button"
                  className={`intensity-option level-${INTENSITIES.indexOf(intensity) + 1}${current === intensity ? " on" : ""}`}
                  aria-pressed={current === intensity}
                  onClick={() => pick(name, intensity)}
                >
                  {INTENSITY_RULES[intensity].label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

// An ignored watch workout, listed under "Show ignored": put it back.
export function RestoreButton({ workoutId, date }: { workoutId: string; date: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await ignoreWorkoutAction(workoutId, date, false);
        setBusy(false);
        if (result.ok) router.refresh();
      }}
    >
      Restore
    </button>
  );
}

// Duplicate watch recordings: split a combined workout, or merge one that
// overlaps another.
export function MergeControls({
  id,
  mergedCount,
  overlaps
}: {
  id: string;
  mergedCount: number;
  overlaps: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.error || "Something went wrong.");
    else router.refresh();
  }

  if (!mergedCount && !overlaps.length) return null;
  return (
    <div className="merge-controls">
      {mergedCount ? (
        <div>
          <span>Combined from {mergedCount + 1} watch recordings</span>
          <button type="button" className="text-button" disabled={busy} onClick={() => run(() => separateWorkoutAction(id))}>
            Separate
          </button>
        </div>
      ) : null}
      {overlaps.map((overlap) => (
        <div key={overlap.id}>
          <span>Overlaps {overlap.label}</span>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => run(() => mergeWorkoutsAction(id, overlap.id))}
          >
            Merge
          </button>
        </div>
      ))}
      {error ? <p className="workout-editor-error">{error}</p> : null}
    </div>
  );
}

export function WorkoutEditor({
  id,
  name,
  workoutType,
  muscleGroups,
  muscleIntensity,
  rpe
}: {
  id: string;
  name: string;
  workoutType: WorkoutType;
  muscleGroups: MuscleName[];
  muscleIntensity: MuscleIntensity;
  rpe: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftType, setDraftType] = useState<WorkoutType>(workoutType);
  // Old names (Mid Chest, Abs) open as what they count as now.
  const current = currentMuscles(muscleGroups, muscleIntensity);
  const [groups, setGroups] = useState<MuscleName[]>(current.muscleGroups);
  const [intensity, setIntensity] = useState<MuscleIntensity>(current.muscleIntensity);
  const [effort, setEffort] = useState(rpe == null ? "" : String(rpe));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDraftName(name);
    setDraftType(workoutType);
    setGroups(current.muscleGroups);
    setIntensity(current.muscleIntensity);
    setEffort(rpe == null ? "" : String(rpe));
    setConfirmDelete(false);
    setError(null);
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Something went wrong.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-button workout-edit-toggle"
        onClick={() => {
          reset();
          setEditing(true);
        }}
      >
        Edit
      </button>
    );
  }

  return (
    <div className="workout-editor">
      <label className="workout-editor-field">
        <span>Name</span>
        <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
      </label>
      <TypeSelect value={draftType} onChange={setDraftType} />
      <MusclePicker value={groups} onChange={setGroups} />
      <label className="workout-editor-field">
        <span>RPE</span>
        <select value={effort} onChange={(event) => setEffort(event.target.value)}>
          <option value="">Not set</option>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <IntensityPicker names={groups} rpe={effort === "" ? null : Number(effort)} value={intensity} onChange={setIntensity} />
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="workout-editor-actions">
        <button
          type="button"
          className="button danger compact"
          disabled={busy}
          onClick={() => (confirmDelete ? run(() => deleteWorkoutSessionAction(id)) : setConfirmDelete(true))}
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </button>
        <span className="workout-editor-spacer" />
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="button compact"
          disabled={busy}
          onClick={() =>
            run(() =>
              updateWorkoutSessionAction(id, {
                name: draftName,
                workoutType: draftType,
                muscleGroups: groups,
                muscleIntensity: intensity,
                rpe: effort === "" ? null : Number(effort)
              })
            )
          }
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export type CoverageRow = {
  name: string;
  aside: string; // the points column: "3/4", or days for an activity
  done: boolean; // at the weekly target
  levels: string[]; // a cell class per day: "", "level-1".."level-3", "activity"
  muscles: CoverageRow[]; // specific muscles, for an expandable group
};

export type WeekPage = {
  key: string;
  label: string;
  range: string;
  days: { date: string; letter: string }[];
  strength: CoverageRow[];
  activities: CoverageRow[];
};

// The week grid. Tapping a group with muscles shows a row per muscle;
// sessions logged as the whole group only shade the group row.
export function CoverageGrid({
  days,
  rows,
  open,
  onToggle
}: {
  days: { date: string; letter: string }[];
  rows: CoverageRow[];
  open: string | null;
  onToggle: (name: string) => void;
}) {
  const line = (row: CoverageRow, sub: boolean) => (
    <div className={sub ? "coverage-row coverage-sub" : "coverage-row"} key={`${sub ? "m" : "g"}-${row.name}`}>
      {!sub && row.muscles.length ? (
        <button type="button" className="coverage-name coverage-toggle" aria-expanded={open === row.name} onClick={() => onToggle(row.name)}>
          {row.name} <span aria-hidden="true">{open === row.name ? "▾" : "▸"}</span>
        </button>
      ) : (
        <span className="coverage-name">{row.name}</span>
      )}
      <div className="coverage-cells">
        {row.levels.map((level, index) => (
          <span key={days[index].date} className={`coverage-cell ${level}`} />
        ))}
      </div>
      <span className={row.done ? "coverage-points done" : "coverage-points"}>{row.aside}</span>
    </div>
  );
  return (
    <>
      {rows.flatMap((row) => [line(row, false), ...(open === row.name ? row.muscles.map((muscle) => line(muscle, true)) : [])])}
    </>
  );
}

// Rolling weeks, newest first; swipe right for earlier ones. Which group is
// expanded carries across pages.
export function WeekPages({ pages }: { pages: WeekPage[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (name: string) => setOpen(open === name ? null : name);
  return (
    <div className="week-pages">
      {pages.map((page, index) => (
        <div key={page.key} className="week-page" aria-label={`${page.label}, ${page.range}`}>
          <div className="card-heading">
            <h2 className="card-title">{page.label}</h2>
            <span className="card-aside">
              {index < pages.length - 1 ? <span aria-hidden="true">‹ </span> : null}
              {page.range}
            </span>
          </div>
          <div className="coverage">
            <span />
            <div className="coverage-cells">
              {page.days.map((day) => (
                <span key={day.date} className="coverage-dow">
                  {day.letter}
                </span>
              ))}
            </div>
            <span className="coverage-since-head">pts</span>
            <CoverageGrid days={page.days} rows={page.strength} open={open} onToggle={toggle} />
            <span className="coverage-divider" />
            <CoverageGrid days={page.days} rows={page.activities} open={open} onToggle={toggle} />
          </div>
          <div className="coverage-legend" aria-hidden="true">
            <span>
              <i className="coverage-cell level-1" /> Light
            </span>
            <span>
              <i className="coverage-cell level-2" /> Medium
            </span>
            <span>
              <i className="coverage-cell level-3" /> Hard
            </span>
            <span>
              <i className="coverage-cell activity" /> Activity
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
