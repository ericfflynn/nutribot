"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deletePushSubscriptionAction,
  deleteReminderAction,
  dismissRemindersAction,
  saveReminderAction,
  savePushSubscriptionAction,
  snoozeRemindersAction
} from "./actions";
import { WEEKDAY_LABELS, describeDays } from "@/lib/habits";
import type { PushSubscriptionInput } from "@/lib/reminders";
import {
  REMINDER_KINDS,
  REMINDER_KIND_LABELS,
  formatHour,
  type ReminderKind,
  type ReminderRule
} from "@/lib/reminder-rules";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

// Today's status for one reminder, with snooze and dismiss.
function ReminderStatus({ reminder, sentAt, today }: { reminder: ReminderRule; sentAt: string | undefined; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean }>) {
    setBusy(true);
    await action();
    setBusy(false);
    router.refresh();
  }

  if (reminder.skipDate === today) return <small>Done for today</small>;
  if (reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > Date.now()) {
    return (
      <small>
        Snoozed until about {timeFormat.format(new Date(reminder.snoozedUntil))} ·{" "}
        <button type="button" className="text-button" disabled={busy} onClick={() => run(() => dismissRemindersAction([reminder.id]))}>
          Done
        </button>
      </small>
    );
  }
  if (sentAt) {
    return (
      <small>
        Sent {timeFormat.format(new Date(sentAt))} ·{" "}
        <button type="button" className="text-button" disabled={busy} onClick={() => run(() => snoozeRemindersAction([reminder.id], 1))}>
          Snooze 1 hr
        </button>{" "}
        ·{" "}
        <button type="button" className="text-button" disabled={busy} onClick={() => run(() => dismissRemindersAction([reminder.id]))}>
          Done
        </button>
      </small>
    );
  }
  return (
    <small>
      <button type="button" className="text-button" disabled={busy} onClick={() => run(() => dismissRemindersAction([reminder.id]))}>
        Skip today
      </button>
    </small>
  );
}

type HabitOption = { id: string; name: string };

function ReminderForm({
  reminder,
  habits,
  onClose
}: {
  reminder: ReminderRule | null;
  habits: HabitOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? "checkin");
  const [habitId, setHabitId] = useState(reminder?.habitId ?? habits[0]?.id ?? "");
  const [hour, setHour] = useState(reminder?.hour ?? 20);
  const [days, setDays] = useState<number[]>(reminder?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [message, setMessage] = useState(reminder?.message ?? "");
  const [enabled, setEnabled] = useState(reminder?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="workout-editor">
      <label className="workout-editor-field">
        <span>Remind me about</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as ReminderKind)}>
          {REMINDER_KINDS.filter((option) => option !== "habit" || habits.length).map((option) => (
            <option key={option} value={option}>
              {REMINDER_KIND_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {kind === "habit" ? (
        <label className="workout-editor-field">
          <span>Habit</span>
          <select value={habitId} onChange={(event) => setHabitId(event.target.value)}>
            {habits.map((habit) => (
              <option key={habit.id} value={habit.id}>
                {habit.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="workout-editor-field">
        <span>Time (sent within the hour)</span>
        <select value={hour} onChange={(event) => setHour(Number(event.target.value))}>
          {Array.from({ length: 24 }, (_, value) => (
            <option key={value} value={value}>
              {formatHour(value)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="workout-editor-groups">
        <legend>Days</legend>
        <div className="muscle-row">
          {WEEKDAY_LABELS.map((label, day) => {
            const on = days.includes(day);
            return (
              <button
                key={label}
                type="button"
                className={on ? "muscle-toggle small on" : "muscle-toggle small"}
                aria-pressed={on}
                onClick={() => setDays((current) => (on ? current.filter((value) => value !== day) : [...current, day]))}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="workout-editor-field">
        <span>{kind === "custom" ? "Message" : "Message (optional; replaces the built-in text)"}</span>
        <input value={message} maxLength={120} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <label className="reminder-enabled">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>On</span>
      </label>
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="workout-editor-actions">
        {reminder ? (
          <button type="button" className="button danger compact" disabled={busy} onClick={() => run(() => deleteReminderAction(reminder.id))}>
            Delete
          </button>
        ) : null}
        <span className="workout-editor-spacer" />
        <button type="button" className="button secondary compact" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button compact"
          disabled={busy}
          onClick={() =>
            run(() =>
              saveReminderAction(reminder?.id ?? null, {
                kind,
                habitId: kind === "habit" ? habitId : null,
                hour,
                days: days.length === 7 ? null : days,
                message: message || null,
                enabled
              })
            )
          }
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function describeReminder(reminder: ReminderRule) {
  const what = reminder.kind === "habit" ? reminder.habitName ?? "Habit" : reminder.kind === "custom" ? reminder.message : REMINDER_KIND_LABELS[reminder.kind];
  return `${formatHour(reminder.hour)} · ${what}`;
}

// The reminders list: when each fires, today's status, and editing.
export function RemindersCard({
  publicKey,
  reminders,
  habits,
  sentToday,
  today
}: {
  publicKey: string | null;
  reminders: ReminderRule[];
  habits: HabitOption[];
  sentToday: Record<string, string>;
  today: string;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <section className="card reminders-card" aria-label="Reminders">
      <div className="card-heading">
        <h2 className="card-title">Reminders</h2>
        {editing ? null : (
          <button type="button" className="pill-button" onClick={() => setEditing("new")}>
            Add
          </button>
        )}
      </div>
      {editing === "new" ? <ReminderForm reminder={null} habits={habits} onClose={() => setEditing(null)} /> : null}
      {reminders.length ? (
        <ul className="reminder-list">
          {reminders.map((reminder) =>
            editing === reminder.id ? (
              <li key={reminder.id}>
                <ReminderForm reminder={reminder} habits={habits} onClose={() => setEditing(null)} />
              </li>
            ) : (
              <li key={reminder.id} className={reminder.enabled ? undefined : "off"}>
                <div>
                  <strong>{describeReminder(reminder)}</strong>
                  <span>
                    {describeDays(reminder.days)}
                    {reminder.enabled ? "" : " · off"}
                  </span>
                  {reminder.enabled ? <ReminderStatus reminder={reminder} sentAt={sentToday[reminder.id]} today={today} /> : null}
                </div>
                <button type="button" className="text-button" onClick={() => setEditing(reminder.id)}>
                  Edit
                </button>
              </li>
            )
          )}
        </ul>
      ) : (
        <p className="footnote">No reminders yet.</p>
      )}
      <p className="footnote">
        Reminders skip anything already logged that day, and everything due at once arrives as one notification.
      </p>
      <PushToggle publicKey={publicKey} />
    </section>
  );
}

// Shown above the chat when a reminder opened it: snooze or dismiss right there.
export function ReminderBanner({ ids }: { ids: string[] }) {
  const [state, setState] = useState<"open" | "busy" | "snoozed" | "done" | "error">("open");

  async function run(action: () => Promise<{ ok: boolean }>, next: "snoozed" | "done") {
    setState("busy");
    const result = await action();
    setState(result.ok ? next : "error");
  }

  if (state === "snoozed") return <div className="reminder-banner">Snoozed. You'll get it again in about an hour.</div>;
  if (state === "done") return <div className="reminder-banner">Done for today.</div>;
  return (
    <div className="reminder-banner">
      <span>{state === "error" ? "Couldn't update the reminder." : "From your reminder"}</span>
      <span>
        <button type="button" className="text-button" disabled={state === "busy"} onClick={() => run(() => snoozeRemindersAction(ids, 1), "snoozed")}>
          Snooze 1 hr
        </button>
        {"  ·  "}
        <button type="button" className="text-button" disabled={state === "busy"} onClick={() => run(() => dismissRemindersAction(ids), "done")}>
          Done for today
        </button>
      </span>
    </div>
  );
}

// This phone's push switch. iPhones only deliver web push to the Home Screen
// app, and only ask for permission after a tap.
function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, [publicKey]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey!)
      });
      const result = await savePushSubscriptionAction(subscription.toJSON() as PushSubscriptionInput);
      if (!result.ok) throw new Error();
      setState("on");
    } catch {
      setError("Couldn't turn reminders on. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Couldn't turn reminders off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const note: Record<State, string> = {
    loading: "",
    unsupported: "Add NutriBot to your Home Screen from Safari to get reminders.",
    denied: "Notifications are off for NutriBot in iPhone Settings.",
    off: "Notifications are off on this phone.",
    on: "Notifications are on for this phone."
  };

  return (
    <div className="reminders-device">
      <div className="card-heading">
        <span>{note[state]}</span>
        {state === "off" ? (
          <button type="button" className="pill-button" onClick={enable} disabled={busy}>
            {busy ? "Turning on…" : "Turn on"}
          </button>
        ) : state === "on" ? (
          <button type="button" className="text-button" onClick={disable} disabled={busy}>
            Turn off
          </button>
        ) : null}
      </div>
      {error ? <p className="chat-error">{error}</p> : null}
    </div>
  );
}
