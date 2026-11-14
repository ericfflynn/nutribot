"use client";

// Today's weight, at the bottom of the Nutrition card (Nov 13, 2026): the
// latest weigh-in on or before the day, its date and the change since the one
// before. Weigh-ins come every week or two, so tapping opens a line of every
// one rather than a week. One point per weigh-in; days without one aren't
// drawn as zeros.
import { useState } from "react";
import { LineChart } from "./charts";

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

export function WeightRow({ weighIns }: { weighIns: { day: string; pounds: number }[] }) {
  const [open, setOpen] = useState(false);
  const latest = weighIns.at(-1);
  if (!latest) return null;
  const previous = weighIns.at(-2);
  const change = previous ? Math.round((latest.pounds - previous.pounds) * 10) / 10 : null;
  return (
    <div className="weight-row">
      <button type="button" className="weight-row-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="weight-row-label">Weight</span>
        <span className="weight-row-value">
          <strong>{latest.pounds.toFixed(1)}</strong> lb
        </span>
        <span className="weight-row-note">
          {shortDay(latest.day)}
          {change != null && previous ? ` · ${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change).toFixed(1)} since ${shortDay(previous.day)}` : ""}
        </span>
        <svg className={`weight-row-chevron${open ? " open" : ""}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <LineChart
          label={`Weight, ${weighIns.length} weigh-ins since ${shortDay(weighIns[0].day)}`}
          format="pounds"
          series={[{ key: "weight", label: "Weight", color: "#6038b5" }]}
          data={weighIns.map((item) => ({ day: item.day, values: { weight: item.pounds } }))}
        />
      ) : null}
    </div>
  );
}
