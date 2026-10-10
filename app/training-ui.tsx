"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteWorkoutSessionAction, updateWorkoutSessionAction } from "./actions";
import { openChat } from "./chat-sheet";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/workouts";

// Opens chat with a sentence about this Fitbit workout, ready to finish.
export function LabelButton({ prompt }: { prompt: string }) {
  return (
    <button type="button" className="pill-button" onClick={() => openChat(prompt)}>
      Label
    </button>
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
  muscleGroups: MuscleGroup[];
  rpe: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [groups, setGroups] = useState<MuscleGroup[]>(muscleGroups);
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
      <fieldset className="workout-editor-groups">
        <legend>Muscle groups</legend>
        {MUSCLE_GROUPS.map((group) => {
          const on = groups.includes(group);
          return (
            <button
              key={group}
              type="button"
              className={on ? "muscle-toggle on" : "muscle-toggle"}
              aria-pressed={on}
              onClick={() => setGroups((current) => (on ? current.filter((g) => g !== group) : [...current, group]))}
            >
              {group}
            </button>
          );
        })}
      </fieldset>
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
