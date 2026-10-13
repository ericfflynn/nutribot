"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateHabitAction } from "./actions";
import { WEEKDAY_LABELS, type Habit } from "@/lib/habits";
import { formatHour } from "@/lib/reminder-rules";

// Habits tab: change a tracked habit in place. Its logs stay attached to it,
// so history and the grid carry over. How it's measured is fixed; a
// different measure is a new habit.
export function HabitEditor({ habit, reminderHour }: { habit: Habit; reminderHour: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function restore() {
    setBusy(true);
    await updateHabitAction(habit.id, { ...habit, active: true });
    setBusy(false);
    router.refresh();
  }

  if (editing) return <HabitForm habit={habit} reminderHour={reminderHour} onClose={() => setEditing(false)} />;
  return (
    <span className="habit-edit-actions">
      {habit.active ? null : (
        <button type="button" className="text-button" disabled={busy} onClick={restore}>
          Track again
        </button>
      )}
      <button type="button" className="text-button" onClick={() => setEditing(true)}>
        Edit
      </button>
    </span>
  );
}

function HabitForm({ habit, reminderHour, onClose }: { habit: Habit; reminderHour: number | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(habit.name);
  const [description, setDescription] = useState(habit.description ?? "");
  const [direction, setDirection] = useState(habit.direction);
  const [goal, setGoal] = useState(habit.goal == null ? "" : String(habit.goal));
  const [unit, setUnit] = useState(habit.unit ?? "");
  const [scaleGuide, setScaleGuide] = useState(habit.scaleGuide ?? "");
  const [cutoff, setCutoff] = useState(habit.cutoff ?? "");
  const [weeknights, setWeeknights] = useState(habit.cutoffWeeknights);
  const [days, setDays] = useState<number[]>(habit.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [reminder, setReminder] = useState(reminderHour == null ? "" : String(reminderHour));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(active = habit.active) {
    setBusy(true);
    setError(null);
    const result = await updateHabitAction(
      habit.id,
      {
        name,
        description: description || null,
        measure: habit.measure,
        unit: unit || null,
        direction,
        scaleGuide: scaleGuide || null,
        goal: goal === "" ? null : Number(goal),
        cutoff: cutoff || null,
        cutoffWeeknights: weeknights,
        days: days.length === 7 ? null : days,
        active
      },
      reminder === "" ? null : Number(reminder)
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    onClose();
    router.refresh();
  }

  const goalLabel =
    habit.measure === "intensity"
      ? "Goal (0 none, 1 light, 2 moderate, 3 heavy)"
      : habit.measure === "minutes"
        ? "Goal (minutes)"
        : `Goal (${unit || "count"})`;

  return (
    <div className="workout-editor habit-editor">
      <label className="workout-editor-field">
        <span>Name</span>
        <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="workout-editor-field">
        <span>Description</span>
        <input
          value={description}
          maxLength={300}
          placeholder="What counts, e.g. any pouch or vape"
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="workout-editor-field">
        <span>Direction</span>
        <select value={direction} onChange={(event) => setDirection(event.target.value as Habit["direction"])}>
          <option value="limit">Limit: less is better</option>
          <option value="build">Build: more is better</option>
        </select>
      </label>
      {habit.measure === "count" ? (
        <label className="workout-editor-field">
          <span>Unit</span>
          <input value={unit} maxLength={20} onChange={(event) => setUnit(event.target.value)} />
        </label>
      ) : null}
      <label className="workout-editor-field">
        <span>{goalLabel}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          max={habit.measure === "intensity" ? 3 : 1440}
          step={habit.measure === "intensity" ? 1 : "any"}
          value={goal}
          placeholder="No goal"
          onChange={(event) => setGoal(event.target.value)}
        />
      </label>
      {habit.measure === "intensity" ? (
        <label className="workout-editor-field">
          <span>Scale (what light, moderate and heavy mean)</span>
          <textarea
            rows={3}
            value={scaleGuide}
            maxLength={600}
            placeholder="1: … 2: … 3: …"
            onChange={(event) => setScaleGuide(event.target.value)}
          />
        </label>
      ) : null}
      <fieldset className="workout-editor-groups">
        <legend>Tracked on</legend>
        <div className="muscle-row">
          {WEEKDAY_LABELS.map((label, day) => {
            const on = days.includes(day);
            return (
              <button
                key={label}
                type="button"
                className={on ? "muscle-toggle small on" : "muscle-toggle small"}
                aria-pressed={on}
                onClick={() => setDays((current) => (on ? current.filter((value) => value !== day) : [...current, day].sort()))}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="habit-times">
        <label>
          <span>Cutoff (optional)</span>
          <input type="time" value={cutoff} onChange={(event) => setCutoff(event.target.value)} />
        </label>
        <label>
          <span>Reminder</span>
          <select value={reminder} onChange={(event) => setReminder(event.target.value)}>
            <option value="">None</option>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {formatHour(hour)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {cutoff ? (
        <label className="reminder-enabled">
          <input type="checkbox" checked={weeknights} onChange={(event) => setWeeknights(event.target.checked)} />
          <span>Cutoff on weeknights only (Sun–Thu)</span>
        </label>
      ) : null}
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="workout-editor-actions">
        <button type="button" className="button secondary compact" disabled={busy} onClick={() => save(!habit.active)}>
          {habit.active ? "Stop tracking" : "Track again"}
        </button>
        <span className="workout-editor-spacer" />
        <button type="button" className="button secondary compact" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button compact" disabled={busy} onClick={() => save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
