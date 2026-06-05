"use client";

import { useState } from "react";

type MacroTotals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type MacroGoals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type HomeProgressCardProps = {
  userName: string;
  loggedMeals: number;
  today: MacroTotals;
  weekAverage: MacroTotals;
  weekAverageDayCount: number;
  goals: MacroGoals;
};

function MacroRow({
  className,
  label,
  grams,
  target
}: {
  className: string;
  label: string;
  grams: number;
  target: number;
}) {
  const targetPercent = target > 0 ? Math.round((grams / target) * 100) : 0;
  const barPercent = Math.min(100, targetPercent);

  return (
    <div className={`home-macro-row ${className}`}>
      <div className="home-macro-row-main">
        <span>{label}</span>
        <div>
          <strong>
            {Math.round(grams)}g <small>/ {Math.round(target)}g</small>
          </strong>
          <small>{targetPercent}% target</small>
        </div>
      </div>
      <div className="home-macro-track" aria-hidden="true">
        <div style={{ width: `${barPercent}%` }} />
      </div>
    </div>
  );
}

export function HomeProgressCard({
  userName,
  loggedMeals,
  today,
  weekAverage,
  weekAverageDayCount,
  goals
}: HomeProgressCardProps) {
  const [view, setView] = useState<"today" | "week">("today");
  const activeTotals = view === "today" ? today : weekAverage;
  const eyebrow =
    view === "today"
      ? loggedMeals
        ? `${loggedMeals} logged today`
        : "No meals yet"
      : weekAverageDayCount
        ? `${weekAverageDayCount} completed day${weekAverageDayCount === 1 ? "" : "s"} averaged`
        : "No completed days yet";
  const caloriePercent = goals.calories > 0 ? Math.min(100, Math.round((activeTotals.calories / goals.calories) * 100)) : 0;

  return (
    <article className="panel home-progress-card">
      <div className="home-progress-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <strong>{userName}</strong>
        </div>
        <div className="home-period-toggle" aria-label={`${userName} progress period`}>
          <button className={view === "today" ? "active" : ""} type="button" onClick={() => setView("today")}>
            Today
          </button>
          <button className={view === "week" ? "active" : ""} type="button" onClick={() => setView("week")}>
            Week
          </button>
        </div>
      </div>

      <div className="home-calorie-block">
        <div className="home-calorie-meta">
          <span>{view === "today" ? "Calories today" : "Average calories"}</span>
          <strong>
            {Math.round(activeTotals.calories)}
            <small> / {goals.calories}</small>
          </strong>
        </div>
        <div className="progress-track home-calorie-track" aria-hidden="true">
          <div style={{ width: `${caloriePercent}%` }} />
        </div>
      </div>

      <div className="home-macro-block">
        <div>
          <span className="eyebrow">Macros</span>
        </div>
        <div className="home-macro-rows">
          <MacroRow className="protein" label="Protein" grams={activeTotals.protein_g} target={goals.protein_g} />
          <MacroRow className="carbs" label="Carbs" grams={activeTotals.carbs_g} target={goals.carbs_g} />
          <MacroRow className="fat" label="Fat" grams={activeTotals.fat_g} target={goals.fat_g} />
        </div>
      </div>
    </article>
  );
}
