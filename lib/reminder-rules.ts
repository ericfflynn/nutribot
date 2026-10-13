// Which reminders are due and what they say. Pure, no database or push: the
// cron route (lib/reminders.ts) loads the state and sends. Plan:
// docs/journal-habits-plan.md#reminders.
//
// Reminders are rows the owner edits. Each fires at most once a day in its
// local hour, plus once more after a snooze. A reminder for something already
// logged today stays quiet, and everything due in the same run goes out as
// one notification.

export const REMINDER_KINDS = ["checkin", "journal", "habits", "habit", "custom"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  checkin: "Check-in",
  journal: "Journal",
  habits: "Unlogged habits",
  habit: "One habit",
  custom: "Custom message"
};

export type ReminderRule = {
  id: string;
  kind: ReminderKind;
  habitId: string | null;
  habitName: string | null;
  hour: number; // local hour, 0-23; Vercel Cron fires anywhere in it
  days: number[] | null; // 0 Sunday-6 Saturday; null for every day
  message: string | null; // custom text; also overrides the built-in body
  enabled: boolean;
  snoozedUntil: string | null; // ISO timestamp
  skipDate: string | null; // dismissed for this local date
};

// What's logged today, so reminders for done things stay quiet.
export type DayState = {
  journaled: boolean;
  loggedHabitIds: Set<string>;
  // Active habits tracked today (their frequency) with nothing logged yet.
  unloggedHabits: { id: string; name: string }[];
};

export type Notification = { title: string; body: string; url: string; reminderIds: string[] };

export type DueContext = {
  date: string; // local YYYY-MM-DD
  hour: number; // local hour now
  weekday: number; // 0 Sunday-6 Saturday
  now: number; // epoch ms
  sentToday: Set<string>; // reminder ids already sent today
};

// "8 PM"
export function formatHour(hour: number) {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}

// Due now: its hour on one of its days and not sent yet today, or a snooze
// that has run out. A reminder dismissed today never fires again that day.
export function isDue(reminder: ReminderRule, context: DueContext) {
  if (!reminder.enabled || reminder.skipDate === context.date) return false;
  if (reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) <= context.now) return true;
  const onDay = !reminder.days || reminder.days.includes(context.weekday);
  return onDay && reminder.hour === context.hour && !context.sentToday.has(reminder.id);
}

function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One reminder's line, or null when what it asks for is already done.
export function reminderLine(reminder: ReminderRule, state: DayState): { title: string; body: string } | null {
  const unlogged = state.unloggedHabits.map((habit) => habit.name);
  switch (reminder.kind) {
    case "custom":
      return reminder.message ? { title: reminder.message, body: "" } : null;
    case "journal":
      if (state.journaled) return null;
      return { title: "How was today?", body: reminder.message || "Take a minute to journal." };
    case "habits":
      if (!unlogged.length) return null;
      return { title: "Habits", body: reminder.message || `Not logged yet: ${joinNames(unlogged)}.` };
    case "habit":
      if (!reminder.habitId || state.loggedHabitIds.has(reminder.habitId)) return null;
      return { title: reminder.habitName ?? "Habit", body: reminder.message || `Log ${reminder.habitName ?? "it"} for today?` };
    case "checkin": {
      if (state.journaled && !unlogged.length) return null;
      const parts = [
        state.journaled ? null : "How was today?",
        unlogged.length ? `Not logged yet: ${joinNames(unlogged)}.` : null
      ].filter(Boolean);
      return { title: "Check-in", body: reminder.message || parts.join(" ") };
    }
  }
}

const CHECKIN_PROMPT = "Evening check-in";

// Everything due in one run, folded into a single notification. Null when
// nothing needs saying.
export function buildNotification(due: ReminderRule[], state: DayState): Notification | null {
  const lines = due
    .map((reminder) => ({ reminder, line: reminderLine(reminder, state) }))
    .filter((item): item is { reminder: ReminderRule; line: { title: string; body: string } } => item.line != null);
  if (!lines.length) return null;
  const ids = lines.map((item) => item.reminder.id);
  const [first, ...rest] = lines;
  const body = [first.line.body, ...rest.map((item) => [item.line.title, item.line.body].filter(Boolean).join(": "))]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({ prompt: CHECKIN_PROMPT, reminders: ids.join(",") });
  return { title: first.line.title, body, url: `/chat?${params.toString()}`, reminderIds: ids };
}
