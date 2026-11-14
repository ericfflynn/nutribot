"use client";

// Training's Next up (picked Nov 13, 2026, option A at
// https://claude.ai/artifact/3FZGayqyayLU6Yu3ntEn2e): the headline, the work
// as pills by intensity, the rest of the week, and the coach note, Claude's
// plan for each open injury and the reasons behind a "Why this plan"
// dropdown. The week's split sits at the bottom. Arrows page back through
// past days' calls (with what was done) and ahead through the days planned
// to Sunday.
import { useState } from "react";

export type NextUpTier = { label: string; tone: "hard" | "medium" | "light" | "finish"; muscles: string[] };

export type NextUpPage = {
  key: string;
  kind: "past" | "current" | "planned";
  label: string; // "Next up · today", "Wed, Nov 11", "Sat · planned"
  headline: string;
  // A line under the headline (rest days, a planned day's note).
  summary: string | null;
  tiers: NextUpTier[];
  // Short lines that change the plan, kept visible (changed today, held back).
  flags: string[];
  // The rest of the week through Sunday, from Claude's call.
  week: { day: string; plan: string }[];
  // Past days: what was done ("Leg day · Walk"); null on other pages.
  done: string[] | null;
  // Claude's note, reasons and plan per injury; for the rules, their notes.
  why: { note: string | null; reasons: string[]; ailments: { name: string; plan: string }[] } | null;
};

export function NextUp({
  pages,
  start,
  split
}: {
  pages: NextUpPage[];
  start: number;
  split: { kind: string; label: string; count: number; target: number }[];
}) {
  const [index, setIndex] = useState(start);
  const page = pages[index];
  return (
    <section className="card next-up" aria-label="Next up">
      <div className="next-up-nav">
        <button type="button" className="next-up-arrow" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Earlier day">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M9 3L5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className={`next-up-label ${page.kind}`}>{page.label}</span>
        <button
          type="button"
          className="next-up-arrow"
          disabled={index === pages.length - 1}
          onClick={() => setIndex(index + 1)}
          aria-label="Later day"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <h2 className={page.kind === "planned" ? "next-up-headline planned" : "next-up-headline"}>{page.headline}</h2>
      {page.summary ? <p className="next-up-summary">{page.summary}</p> : null}
      {page.tiers.length ? (
        <div className="next-up-tiers">
          {page.tiers.map((tier) => (
            <div key={tier.label} className="next-up-tier">
              <span className={tier.tone === "finish" ? "next-up-tier-label muted" : "next-up-tier-label"}>{tier.label}</span>
              {tier.muscles.map((muscle) => (
                <span key={muscle} className={`next-up-pill ${tier.tone}`}>
                  {muscle}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {page.done ? (
        <p className="next-up-done">
          <span>Did</span> {page.done.length ? page.done.join(" · ") : "Nothing logged"}
        </p>
      ) : null}
      {page.flags.map((flag) => (
        <p key={flag} className="next-up-flag">
          {flag}
        </p>
      ))}
      {page.week.length ? (
        <div className="next-up-week" aria-label="Rest of the week">
          {page.week.map((item) => (
            <div key={item.day}>
              <span>{item.day}</span>
              <span>{item.plan}</span>
            </div>
          ))}
        </div>
      ) : null}
      {page.why ? (
        <details key={page.key} className="next-up-why">
          <summary>
            <span>Why this plan</span>
            <svg className="next-up-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="next-up-why-body">
            {page.why.note ? <p>{page.why.note}</p> : null}
            {page.why.ailments.map((item) => (
              <p key={item.name} className="next-up-why-ailment">
                <strong>{item.name}</strong> {item.plan}
              </p>
            ))}
            {page.why.reasons.length ? (
              <ul>
                {page.why.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}
      {page.kind === "current" && split.length ? (
        <div className="next-up-split" aria-label="This week since Monday">
          {split.map((entry) => (
            <div key={entry.kind}>
              <strong className={entry.count < entry.target ? "short" : undefined}>
                {entry.count}/{entry.target}
              </strong>
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
