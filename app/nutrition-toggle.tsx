"use client";

import { useState, type ReactNode } from "react";

// The Nutrition card on Today. Tapping its title opens the week's trends under
// the heading, the way Sleep, Recovery and Strain open from their scores.
export function NutritionCard({ aside, trends, children }: { aside: ReactNode; trends: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card nutrition-card" aria-label="Nutrition">
      <div className="card-heading">
        <button
          type="button"
          className={`card-title card-toggle${open ? " open" : ""}`}
          aria-expanded={open}
          aria-controls="nutrition-trends"
          onClick={() => setOpen(!open)}
        >
          Nutrition
          <svg className="score-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {aside}
      </div>
      {open ? (
        <div id="nutrition-trends" className="nutrition-trends">
          {trends}
        </div>
      ) : null}
      {children}
    </section>
  );
}
