"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addMacroEntryAction,
  parseMealForReviewAction,
  reviseMealForReviewAction,
  type MealReviewState
} from "./actions";
import { adjustCalories, adjustMacroValue, initialAdjustedMacros } from "@/lib/macro-adjust";

function isGenericEstimateNote(note: string) {
  const lower = note.toLowerCase();
  return (
    lower.includes("typical serving") ||
    lower.includes("actual values may vary") ||
    lower.includes("estimated values") ||
    lower.includes("estimates based")
  );
}

function ItemMacroBreakdown({
  items
}: {
  items: unknown[];
}) {
  const normalized = items
    .map((item) => {
      if (typeof item === "string") {
        return {
          name: item,
          calories: 0,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 0,
          assumption: ""
        };
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return {
          name: String(obj.name || "Item"),
          calories: Number(obj.calories || 0),
          protein_g: Number(obj.protein_g || 0),
          carbs_g: Number(obj.carbs_g || 0),
          fat_g: Number(obj.fat_g || 0),
          assumption: String(obj.assumption || "")
        };
      }
      return null;
    })
    .filter((item): item is {
      name: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      assumption: string;
    } => Boolean(item));

  if (!normalized.length) {
    return null;
  }

  const total = normalized.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein_g: sum.protein_g + item.protein_g,
      carbs_g: sum.carbs_g + item.carbs_g,
      fat_g: sum.fat_g + item.fat_g
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  return (
    <div className="item-breakdown">
      <div className="item-table-row item-table-head">
        <span>Item</span>
        <span>Protein</span>
        <span>Fat</span>
        <span>Carbs</span>
        <span>Calories</span>
      </div>
      {normalized.map((item, index) => (
        <div className="item-table-row" key={`${item.name}-${index}`}>
          <div>
            <strong>{item.name}</strong>
            {item.assumption ? <span>{item.assumption}</span> : null}
          </div>
          <span>{Math.round(item.protein_g)}g</span>
          <span>{Math.round(item.fat_g)}g</span>
          <span>{Math.round(item.carbs_g)}g</span>
          <span>{Math.round(item.calories)}</span>
        </div>
      ))}
      <div className="item-table-row item-total">
        <div>
          <strong>Total</strong>
        </div>
        <span>{Math.round(total.protein_g)}g</span>
        <span>{Math.round(total.fat_g)}g</span>
        <span>{Math.round(total.carbs_g)}g</span>
        <span>{Math.round(total.calories)}</span>
      </div>
    </div>
  );
}

const initialState: MealReviewState = {
  rawText: "",
  parsed: null,
  feedback: null,
  error: null
};

function ParseButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={disabled || pending}>
      {pending ? (
        <span className="button-wait">
          <span className="spinner" aria-hidden="true" />
          Estimating
        </span>
      ) : (
        "Estimate macros"
      )}
    </button>
  );
}

function ReviseButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button secondary" type="submit" disabled={pending}>
      {pending ? (
        <span className="button-wait">
          <span className="spinner dark" aria-hidden="true" />
          Revising
        </span>
      ) : (
        "Revise"
      )}
    </button>
  );
}

function AcceptButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? "Saving" : "Accept and save"}
    </button>
  );
}

export function MealLogger({
  disabled,
  error
}: {
  disabled: boolean;
  error?: string;
}) {
  const [state, parseAction] = useActionState(parseMealForReviewAction, initialState);
  const [revisedState, reviseAction] = useActionState(reviseMealForReviewAction, initialState);
  const activeState = revisedState.parsed || revisedState.error ? revisedState : state;
  const parsed = activeState.parsed;
  const rawText = activeState.rawText || state.rawText;
  const [editedMacros, setEditedMacros] = useState(() =>
    initialAdjustedMacros({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })
  );

  useEffect(() => {
    if (!parsed) {
      return;
    }

    setEditedMacros(initialAdjustedMacros(parsed));
  }, [parsed]);

  const adjustedParsed = useMemo(() => {
    if (!parsed) {
      return null;
    }

    return {
      ...parsed,
      calories: editedMacros.calories,
      protein_g: editedMacros.protein_g,
      carbs_g: editedMacros.carbs_g,
      fat_g: editedMacros.fat_g,
      notes:
        parsed.notes && !isGenericEstimateNote(parsed.notes)
          ? parsed.notes
          : "Manual total adjustment before saving."
    };
  }, [editedMacros, parsed]);

  function updateMacro(name: "protein_g" | "carbs_g" | "fat_g", value: string) {
    setEditedMacros((current) => adjustMacroValue(current, name, value));
  }

  function updateCalories(value: string) {
    setEditedMacros((current) => adjustCalories(current, value));
  }

  return (
    <section className="meal-log-stack">
      <form className="panel entry-form form-grid" action={parseAction}>
        <div className="field">
          <label htmlFor="rawText">Meal</label>
          <textarea
            id="rawText"
            name="rawText"
            placeholder="Two eggs, sourdough toast with butter, Greek yogurt with berries"
            required
            defaultValue={rawText}
          />
        </div>
        <ParseButton disabled={disabled} />
        {error || activeState.error ? <p className="error">{error || activeState.error}</p> : null}
      </form>

      {parsed ? (
        <article className="panel review-card">
          <div className="review-head">
            <div>
              <span className="eyebrow">AI estimate</span>
              <h2>Review before saving</h2>
            </div>
            <span className="pill">{Math.round(parsed.confidence * 100)}% confidence</span>
          </div>

          <p className="entry-text">{rawText}</p>
          {activeState.feedback ? (
            <div className="feedback-applied">
              <span>Correction applied</span>
              <p>{activeState.feedback}</p>
            </div>
          ) : null}
          <div className="review-adjust-grid">
            <label>
              <span>Calories</span>
              <input
                type="number"
                min="0"
                step="10"
                value={editedMacros.calories}
                onChange={(event) => updateCalories(event.target.value)}
              />
            </label>
            <label>
              <span>Protein</span>
              <input
                type="number"
                min="0"
                step="1"
                value={editedMacros.protein_g}
                onChange={(event) => updateMacro("protein_g", event.target.value)}
              />
            </label>
            <label>
              <span>Carbs</span>
              <input
                type="number"
                min="0"
                step="1"
                value={editedMacros.carbs_g}
                onChange={(event) => updateMacro("carbs_g", event.target.value)}
              />
            </label>
            <label>
              <span>Fat</span>
              <input
                type="number"
                min="0"
                step="1"
                value={editedMacros.fat_g}
                onChange={(event) => updateMacro("fat_g", event.target.value)}
              />
            </label>
          </div>
          <div className="review-adjust-note">
            <span>Editing macros recalculates calories. Editing calories scales macros proportionally.</span>
            <button
              className="button secondary compact"
              type="button"
              onClick={() =>
                setEditedMacros(initialAdjustedMacros(parsed))
              }
            >
              Reset
            </button>
          </div>
          <ItemMacroBreakdown items={parsed.items} />
          {parsed.notes && !isGenericEstimateNote(parsed.notes) ? <p className="muted">{parsed.notes}</p> : null}
          {parsed.accuracy_suggestion ? (
            <div className="clarify-box">
              <span>{parsed.confidence < 0.75 ? "Clarification would help" : "Accuracy tip"}</span>
              <p>{parsed.accuracy_suggestion}</p>
            </div>
          ) : null}

          <div className="review-actions">
            <form action={addMacroEntryAction}>
              <input type="hidden" name="rawText" value={rawText} />
              <input type="hidden" name="parsed" value={JSON.stringify(adjustedParsed || parsed)} />
              <AcceptButton />
            </form>

            <form className="revise-form" action={reviseAction}>
              <input type="hidden" name="rawText" value={rawText} />
              <div className="field">
                <label htmlFor="feedback">Correction</label>
                <input
                  id="feedback"
                  name="feedback"
                  placeholder="Add portion size, missing item, or correction"
                  required
                />
              </div>
              <ReviseButton />
            </form>
          </div>
        </article>
      ) : null}
    </section>
  );
}
