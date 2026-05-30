"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteMacroEntryAction, updateMacroEntryAction } from "./actions";
import { adjustCalories, adjustMacroValue, initialAdjustedMacros } from "@/lib/macro-adjust";
import type { MacroEntry } from "@/lib/supabase";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? "Saving" : "Save"}
    </button>
  );
}

function DeleteButton({
  confirming,
  onClick
}: {
  confirming: boolean;
  onClick: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button className="button danger" type={confirming ? "submit" : "button"} disabled={pending} onClick={onClick}>
      {pending ? "Deleting" : confirming ? "Confirm delete" : "Delete"}
    </button>
  );
}

export function EntryCard({ entry }: { entry: MacroEntry }) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editedMacros, setEditedMacros] = useState(() => initialAdjustedMacros(entry));
  const createdAt = new Date(entry.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  function resetEditedMacros() {
    setEditedMacros(initialAdjustedMacros(entry));
  }

  function updateMacro(name: "protein_g" | "carbs_g" | "fat_g", value: string) {
    setEditedMacros((current) => adjustMacroValue(current, name, value));
  }

  function updateCalories(value: string) {
    setEditedMacros((current) => adjustCalories(current, value));
  }

  if (isEditing) {
    return (
      <article className="panel entry">
        <form className="edit-entry-form" action={updateMacroEntryAction}>
          <input type="hidden" name="id" value={entry.id} />
          <div className="entry-head">
            <div>
              <span className="eyebrow">Edit meal</span>
              <strong>{createdAt}</strong>
            </div>
            <button
              className="button secondary compact"
              type="button"
              onClick={() => {
                resetEditedMacros();
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
          <label className="field">
            <span>Meal</span>
            <textarea name="rawText" required defaultValue={entry.raw_text} />
          </label>
          <div className="macro-edit-grid">
            <label className="field">
              <span>Calories</span>
              <input
                name="calories"
                type="number"
                min="0"
                step="10"
                required
                value={editedMacros.calories}
                onChange={(event) => updateCalories(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Protein</span>
              <input
                name="protein_g"
                type="number"
                min="0"
                step="1"
                required
                value={editedMacros.protein_g}
                onChange={(event) => updateMacro("protein_g", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Carbs</span>
              <input
                name="carbs_g"
                type="number"
                min="0"
                step="1"
                required
                value={editedMacros.carbs_g}
                onChange={(event) => updateMacro("carbs_g", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Fat</span>
              <input
                name="fat_g"
                type="number"
                min="0"
                step="1"
                required
                value={editedMacros.fat_g}
                onChange={(event) => updateMacro("fat_g", event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Notes</span>
            <input name="notes" defaultValue={entry.notes || ""} />
          </label>
          <div className="entry-actions">
            <SaveButton />
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                resetEditedMacros();
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article className="panel entry">
      <div className="entry-head">
        <p className="entry-text">{entry.raw_text}</p>
        <span className="muted">{createdAt}</span>
      </div>
      <div className="macro-row">
        <span className="pill">{Math.round(entry.calories)} cal</span>
        <span className="pill">{Math.round(entry.protein_g)}g protein</span>
        <span className="pill">{Math.round(entry.carbs_g)}g carbs</span>
        <span className="pill">{Math.round(entry.fat_g)}g fat</span>
        <span className="pill">{Math.round(entry.confidence * 100)}% confidence</span>
      </div>
      {entry.items.length ? (
        <div className="saved-items">
          {entry.items.map((item, index) => (
            <span key={`${entry.id}-${item.name}-${index}`}>
              {item.name}: {Math.round(item.calories)} calories
            </span>
          ))}
        </div>
      ) : null}
      {entry.notes ? <p className="muted">{entry.notes}</p> : null}
      <div className="entry-actions">
        <button
          className="button secondary compact"
          type="button"
          onClick={() => {
            resetEditedMacros();
            setIsEditing(true);
          }}
        >
          Edit
        </button>
        <form action={deleteMacroEntryAction}>
          <input type="hidden" name="id" value={entry.id} />
          <DeleteButton
            confirming={confirmingDelete}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
              }
            }}
          />
        </form>
        {confirmingDelete ? (
          <button className="button secondary compact" type="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        ) : null}
      </div>
    </article>
  );
}
