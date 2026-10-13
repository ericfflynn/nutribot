"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteWorkoutSessionAction,
  labelWorkoutAction,
  mergeWorkoutsAction,
  separateWorkoutAction,
  updateWorkoutSessionAction
} from "./actions";
import { openChat } from "./chat-sheet";
import { MUSCLE_GROUPS, MUSCLES, groupOf, type MuscleGroup, type MuscleName } from "@/lib/workouts";

// Labels an unlabeled watch workout: describe it in chat (opens with a
// sentence ready to finish), or pick muscles and effort right here.
export function LabelButton({ prompt, workoutId, date }: { prompt: string; workoutId: string; date: string }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [muscles, setMuscles] = useState<MuscleName[]>([]);
  const [effort, setEffort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await labelWorkoutAction(workoutId, date, { muscleGroups: muscles, rpe: effort === "" ? null : Number(effort) });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    setPicking(false);
    router.refresh();
  }

  if (!picking) {
    return (
      <span className="label-actions">
        <button type="button" className="pill-button" onClick={() => setPicking(true)}>
          Pick muscles
        </button>
        <button type="button" className="pill-button" onClick={() => openChat(prompt)}>
          Chat
        </button>
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
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="workout-editor-actions">
        <span className="workout-editor-spacer" />
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => setPicking(false)}>
          Cancel
        </button>
        <button type="button" className="button compact" disabled={busy || !muscles.length} onClick={save}>
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
  muscleGroups,
  rpe
}: {
  id: string;
  name: string;
  muscleGroups: MuscleName[];
  rpe: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [groups, setGroups] = useState<MuscleName[]>(muscleGroups);
  const [effort, setEffort] = useState(rpe == null ? "" : String(rpe));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDraftName(name);
    setGroups(muscleGroups);
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
                muscleGroups: groups,
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
  since: number | null;
  missing: boolean;
  levels: string[]; // a cell class per day: "", "level-1".."level-3"
  muscles: CoverageRow[]; // specific muscles, for an expandable group
};

// The coverage grid. Tapping a group with muscles shows a row per muscle;
// sessions logged as the whole group only shade the group's row.
export function CoverageGrid({ days, rows }: { days: { date: string; letter: string }[]; rows: CoverageRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const line = (row: CoverageRow, sub: boolean) => (
    <div className={sub ? "coverage-row coverage-sub" : "coverage-row"} key={`${sub ? "m" : "g"}-${row.name}`}>
      {!sub && row.muscles.length ? (
        <button
          type="button"
          className={`coverage-name coverage-toggle${row.missing ? " missing" : ""}`}
          aria-expanded={open === row.name}
          onClick={() => setOpen(open === row.name ? null : row.name)}
        >
          {row.name} <span aria-hidden="true">{open === row.name ? "▾" : "▸"}</span>
        </button>
      ) : (
        <span className={`coverage-name${row.missing ? " missing" : ""}`}>{row.name}</span>
      )}
      <div className="coverage-cells">
        {row.levels.map((level, index) => (
          <span key={days[index].date} className={`coverage-cell ${level}`} />
        ))}
      </div>
      <span className={row.missing ? "coverage-since missing" : "coverage-since"}>{row.since == null ? "–" : `${row.since}d`}</span>
    </div>
  );
  return (
    <div className="coverage">
      <span />
      <div className="coverage-cells">
        {days.map((day) => (
          <span key={day.date} className="coverage-dow">
            {day.letter}
          </span>
        ))}
      </div>
      <span className="coverage-since-head">since</span>
      {rows.flatMap((row) => [line(row, false), ...(open === row.name ? row.muscles.map((muscle) => line(muscle, true)) : [])])}
    </div>
  );
}

