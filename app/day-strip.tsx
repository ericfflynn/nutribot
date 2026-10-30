"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Status } from "@/lib/body-state/types";

export type StripDay = {
  date: string;
  href: string;
  weekday: string;
  dayOfMonth: number;
  label: string;
  selected: boolean;
  // The day's physical status from the body state, which shades it.
  status: Status;
};

// Horizontally scrolling row of days, newest on the right, each shaded by its
// physical status (docs/body-state.md). The selected day is
// scrolled into view on load; the leading arrow jumps further back.
export function DayStrip({ days, earlierHref }: { days: StripDay[]; earlierHref: string }) {
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => {
    const container = scroller.current;
    const selected = container?.querySelector<HTMLElement>("[aria-current]");
    if (container && selected) {
      container.scrollLeft = selected.offsetLeft - container.clientWidth / 2 + selected.clientWidth / 2;
    }
  }, [days]);

  return (
    <nav className="day-strip" aria-label="Choose a day" ref={scroller}>
      <Link className="day-strip-earlier" href={earlierHref} aria-label="Earlier days">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </Link>
      {days.map((day) => (
        <Link
          key={day.date}
          href={day.href}
          className={`status-${day.status}${day.selected ? " selected" : ""}`}
          aria-current={day.selected ? "date" : undefined}
          aria-label={day.label}
        >
          <span className="day-weekday">{day.weekday}</span>
          <strong>{day.dayOfMonth}</strong>
        </Link>
      ))}
    </nav>
  );
}
