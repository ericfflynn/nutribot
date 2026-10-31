"use client";

import { useState, type ReactNode } from "react";

export type Score = {
  label: string;
  value: string;
  // 0-100 toward the bar's maximum; null when there's no data.
  percent: number | null;
  color: string;
  // Darker step of the color for the label text.
  textColor: string;
  // Smaller lines under the bar.
  notes: string[];
};

function ScoreCell({ score, chevron }: { score: Score; chevron?: boolean }) {
  return (
    <>
      <span className="score-label" style={{ color: score.textColor }}>
        {score.label}
        {chevron ? (
          <svg className="score-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : null}
      </span>
      <strong>{score.value}</strong>
      <div className="score-bar" role="presentation" style={{ background: `color-mix(in srgb, ${score.color} 16%, transparent)` }}>
        {score.percent != null && score.percent > 0 ? <div style={{ width: `${Math.min(100, score.percent)}%`, background: score.color }} /> : null}
      </div>
      {score.notes.map((note) => (
        <span className="score-note" key={note}>
          {note}
        </span>
      ))}
    </>
  );
}

// Sleep, recovery and strain side by side: value, a thin bar toward its
// maximum, then details. Tapping a score opens its trends under the three
// (one at a time); `below` (the sick line) sits under them when there is one.
export function ScoreSummary({ scores, details, below }: { scores: Score[]; details: Record<string, ReactNode>; below?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const panelId = (label: string) => `${label.toLowerCase()}-details`;
  return (
    <section className="card score-summary" aria-label="Day scores">
      {scores.map((score) =>
        details[score.label] ? (
          <button
            key={score.label}
            type="button"
            className={`score-cell score-toggle${open === score.label ? " open" : ""}`}
            aria-expanded={open === score.label}
            aria-controls={panelId(score.label)}
            onClick={() => setOpen(open === score.label ? null : score.label)}
          >
            <ScoreCell score={score} chevron />
          </button>
        ) : (
          <div key={score.label} className="score-cell">
            <ScoreCell score={score} />
          </div>
        )
      )}
      {below ? <div className="score-below">{below}</div> : null}
      {open && details[open] ? (
        <div id={panelId(open)} className="score-open">
          {details[open]}
        </div>
      ) : null}
    </section>
  );
}
