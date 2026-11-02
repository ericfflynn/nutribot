"use client";

import { useOptimistic, useState } from "react";
import { useFormStatus } from "react-dom";
import { addWaterAction, undoWaterAction } from "./actions";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const BOTTLE_PATH = "M30 6 H50 V20 C50 28 72 30 72 46 V124 Q72 136 60 136 H20 Q8 136 8 124 V46 C8 30 30 28 30 20 Z";

function wavePath(y: number, amplitude: number) {
  let path = `M0 ${y.toFixed(1)}`;
  for (let x = 0; x < 120; x += 20) {
    path += ` q10 ${-amplitude} 20 0`;
  }
  return `${path} V140 H0 Z`;
}

function UndoButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="text-button water-undo" disabled={pending}>
      {pending ? "Undoing…" : "Undo last"}
    </button>
  );
}

// Today's water. A tap shows straight away and saves in the background; the
// page's next render brings the saved total, and a failed save falls back to it.
export function WaterRow({ ounces, goalOz, date }: { ounces: number; goalOz: number; date: string }) {
  const [shown, addShown] = useOptimistic(ounces, (current: number, added: number) => current + added);
  const [failed, setFailed] = useState(false);

  async function add(formData: FormData) {
    setFailed(false);
    addShown(Number(formData.get("oz")));
    try {
      await addWaterAction(formData);
    } catch {
      setFailed(true);
    }
  }

  async function undo(formData: FormData) {
    setFailed(false);
    try {
      await undoWaterAction(formData);
    } catch {
      setFailed(true);
    }
  }

  const level = Math.min(1, shown / goalOz);
  const surface = 134 - 104 * level;
  const left = goalOz - shown;
  return (
    <div className="water-row">
      <svg className="water-bottle" viewBox="0 0 80 140" role="img" aria-label={`Water: ${integer.format(shown)} of ${goalOz} oz`}>
        <defs>
          <clipPath id="bottle-inside">
            <path d={BOTTLE_PATH} />
          </clipPath>
        </defs>
        <path d={BOTTLE_PATH} fill="var(--water-soft)" />
        {level > 0 ? (
          <g clipPath="url(#bottle-inside)">
            <path className="wave-back" d={wavePath(surface - 2, 3)} fill="var(--water)" fillOpacity="0.35" />
            <path className="wave" d={wavePath(surface, 4)} fill="var(--water)" />
          </g>
        ) : null}
        <path d={BOTTLE_PATH} fill="none" stroke="var(--water-ink)" strokeWidth="6" />
      </svg>
      <div className="water-figure">
        <span>
          <strong>{integer.format(shown)}</strong> / {goalOz} oz
        </span>
        <small>{failed ? "Didn't save, try again" : left > 0 ? `${integer.format(left)} oz to go` : "Goal reached"}</small>
        {shown > 0 ? (
          <form action={undo}>
            <input type="hidden" name="entryDate" value={date} />
            <UndoButton />
          </form>
        ) : null}
      </div>
      <form className="water-buttons" action={add}>
        <input type="hidden" name="entryDate" value={date} />
        {[8, 16, 24].map((oz) => (
          <button key={oz} type="submit" name="oz" value={oz} aria-label={`Add ${oz} ounces of water`}>
            +{oz}
          </button>
        ))}
      </form>
    </div>
  );
}
