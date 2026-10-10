"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type StripDay = {
  date: string;
  href: string;
  weekday: string;
  dayOfMonth: number;
  label: string;
  selected: boolean;
  // 0-1 for each dot; null when that day has no data.
  sleep: number | null;
  recovery: number | null;
  recoveryColor: string;
  strain: number | null;
};

function Dot({ value, color }: { value: number | null; color: string }) {
  return value == null ? (
    <span className="day-dot missing" />
  ) : (
    <span className="day-dot" style={{ background: color, opacity: 0.25 + 0.75 * Math.min(1, value) }} />
  );
}

// Horizontally scrolling row of days, newest on the right. The selected day is
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
          className={day.selected ? "selected" : ""}
          aria-current={day.selected ? "date" : undefined}
          aria-label={day.label}
        >
          <span className="day-weekday">{day.weekday}</span>
          <strong>{day.dayOfMonth}</strong>
          <span className="day-dots" aria-hidden="true">
            <Dot value={day.sleep} color="var(--sleep)" />
            <Dot value={day.recovery} color={day.recoveryColor} />
            <Dot value={day.strain} color="var(--strain)" />
          </span>
        </Link>
      ))}
    </nav>
  );
}
