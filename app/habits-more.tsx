"use client";

// The Habits tab's bottom row (Nov 10, 2026): habit settings, reminders and
// the journal behind one button each, so progress and logging lead the tab.
import { useState, type ReactNode } from "react";

export function HabitsMore({ sections }: { sections: { id: string; label: string; content: ReactNode }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = sections.find((section) => section.id === open);
  return (
    <>
      <div className="habits-more" role="group" aria-label="More">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={open === section.id ? "on" : undefined}
            aria-expanded={open === section.id}
            onClick={() => setOpen(open === section.id ? null : section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
      {shown ? shown.content : null}
    </>
  );
}
