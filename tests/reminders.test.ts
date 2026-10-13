// Reminder scheduling and completion awareness (lib/reminder-rules.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotification, isDue, reminderLine, type DayState, type ReminderRule } from "../lib/reminder-rules";

const base: ReminderRule = {
  id: "r1",
  kind: "checkin",
  habitId: null,
  habitName: null,
  hour: 20,
  days: null,
  message: null,
  enabled: true,
  snoozedUntil: null,
  skipDate: null
};

const NOW = Date.parse("2026-10-12T00:30:00Z");
const context = { date: "2026-10-11", hour: 20, weekday: 0, now: NOW, sentToday: new Set<string>() };

const nothingLogged: DayState = {
  journaled: false,
  loggedHabitIds: new Set(),
  unloggedHabits: [{ id: "h1", name: "Nicotine" }]
};
const allDone: DayState = { journaled: true, loggedHabitIds: new Set(["h1"]), unloggedHabits: [] };

test("due in its hour on its days, once a day", () => {
  assert.ok(isDue(base, context));
  assert.ok(!isDue(base, { ...context, hour: 19 }));
  assert.ok(!isDue({ ...base, days: [1, 2, 3] }, context));
  assert.ok(!isDue(base, { ...context, sentToday: new Set(["r1"]) }));
  assert.ok(!isDue({ ...base, enabled: false }, context));
});

test("a dismissed reminder stays quiet that day, even when snoozed", () => {
  assert.ok(!isDue({ ...base, skipDate: "2026-10-11", snoozedUntil: "2026-10-11T00:00:00Z" }, context));
});

test("a snooze fires on the first run after it ends, whatever the hour", () => {
  const snoozed = { ...base, snoozedUntil: new Date(NOW - 60_000).toISOString() };
  assert.ok(isDue(snoozed, { ...context, hour: 21, sentToday: new Set(["r1"]) }));
  const notYet = { ...base, snoozedUntil: new Date(NOW + 60_000).toISOString() };
  assert.ok(!isDue(notYet, { ...context, hour: 21, sentToday: new Set(["r1"]) }));
});

test("reminders for things already logged stay quiet", () => {
  assert.equal(reminderLine(base, allDone), null);
  assert.equal(reminderLine({ ...base, kind: "journal" }, allDone), null);
  assert.equal(reminderLine({ ...base, kind: "habits" }, allDone), null);
  assert.equal(reminderLine({ ...base, kind: "habit", habitId: "h1", habitName: "Nicotine" }, allDone), null);
  assert.ok(reminderLine({ ...base, kind: "custom", message: "Xbox off" }, allDone));
});

test("a check-in names the habits still unlogged", () => {
  const line = reminderLine(base, { ...nothingLogged, journaled: true });
  assert.match(line!.body, /Nicotine/);
  assert.doesNotMatch(line!.body, /How was today/);
});

test("everything due at once is one notification", () => {
  const due = [
    { ...base, id: "a", kind: "custom" as const, message: "8 pm: Xbox off" },
    { ...base, id: "b" },
    { ...base, id: "c", kind: "journal" as const }
  ];
  const notification = buildNotification(due, nothingLogged)!;
  assert.equal(notification.title, "8 pm: Xbox off");
  assert.deepEqual(notification.reminderIds, ["a", "b", "c"]);
  assert.match(notification.url, /reminders=a%2Cb%2Cc/);
  assert.equal(buildNotification([{ ...base, kind: "journal" }], allDone), null);
});
