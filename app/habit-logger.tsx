"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteHabitLogAction, logHabitAction } from "./actions";
import {
  INTENSITY_LABELS,
  describeHabitDay,
  formatClockTime,
  formatHabitAmount,
  summarizeHabitDay,
  type Habit,
  type HabitLog
} from "@/lib/habits";

// Minutes between two "HH:MM" times, past midnight when the end is earlier.
function minutesBetween(start: string, end: string) {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const diff = toMinutes(end) - toMinutes(start);
  return diff >= 0 ? diff : diff + 24 * 60;
}

function HabitPanel({
  habit,
  date,
  logs,
  onDone
}: {
  habit: Habit;
  date: string;
  logs: HabitLog[];
  onDone: (error?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState("");
  const [count, setCount] = useState(1);
  const [minutes, setMinutes] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");

  async function save(amount: number) {
    setBusy(true);
    const result = await logHabitAction({
      habitId: habit.id,
      date,
      amount,
      details: amount > 0 ? details || null : null,
      startedAt: amount > 0 && startedAt ? startedAt : null,
      endedAt: amount > 0 && endedAt ? endedAt : null
    });
    setBusy(false);
    if (result.ok) {
      setDetails("");
      setMinutes("");
      setStartedAt("");
      setEndedAt("");
    }
    onDone(result.error);
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await deleteHabitLogAction(id);
    setBusy(false);
    onDone(result.error);
  }

  // Minutes typed, or worked out from the times.
  const timedMinutes = startedAt && endedAt ? minutesBetween(startedAt, endedAt) : null;
  const minuteAmount = minutes ? Number(minutes) : timedMinutes;

  return (
    <div className="habit-panel">
      {logs.length ? (
        <ul className="habit-panel-logs">
          {logs.map((log) => (
            <li key={log.id}>
              <span>
                {formatHabitAmount(habit, log.amount)}
                {log.startedAt && log.endedAt ? ` · ${formatClockTime(log.startedAt)}–${formatClockTime(log.endedAt)}` : ""}
                {log.details ? <small>{log.details}</small> : null}
              </span>
              <button type="button" className="text-button danger" onClick={() => remove(log.id)} disabled={busy} aria-label="Remove">
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        className="habit-note"
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder={habit.measure === "intensity" ? "Note, e.g. 1 Zyn on the course" : "Note (optional)"}
        maxLength={300}
      />

      {habit.measure === "intensity" ? (
        <div className="habit-choices">
          {[0, 1, 2, 3].map((level) => (
            <button key={level} type="button" className="pill-button" onClick={() => save(level)} disabled={busy}>
              {INTENSITY_LABELS[level]}
            </button>
          ))}
        </div>
      ) : habit.measure === "count" ? (
        <div className="habit-choices">
          <div className="habit-stepper">
            <button type="button" onClick={() => setCount((value) => Math.max(1, value - 1))} aria-label="Fewer">
              −
            </button>
            <strong>
              {count} {habit.unit}
            </strong>
            <button type="button" onClick={() => setCount((value) => value + 1)} aria-label="More">
              +
            </button>
          </div>
          <button type="button" className="pill-button primary" onClick={() => save(count)} disabled={busy}>
            Add
          </button>
          <button type="button" className="pill-button" onClick={() => save(0)} disabled={busy}>
            None
          </button>
        </div>
      ) : (
        <>
          {habit.cutoff ? (
            <div className="habit-times">
              <label>
                <span>From</span>
                <input type="time" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
              </label>
              <label>
                <span>Until</span>
                <input type="time" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
              </label>
            </div>
          ) : null}
          <div className="habit-choices">
            <label className="habit-minutes">
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="1440"
                value={minutes}
                placeholder={timedMinutes != null ? String(timedMinutes) : "0"}
                onChange={(event) => setMinutes(event.target.value)}
              />
              <span>min</span>
            </label>
            <button
              type="button"
              className="pill-button primary"
              onClick={() => save(minuteAmount!)}
              disabled={busy || !minuteAmount || minuteAmount <= 0}
            >
              Add
            </button>
            <button type="button" className="pill-button" onClick={() => save(0)} disabled={busy}>
              None
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// The Habits tab's manual logger: each habit's status for today or yesterday,
// and a quick entry panel per habit. The chat logs the same rows.
export function HabitLogger({
  habits,
  logs,
  today,
  yesterday
}: {
  habits: Habit[];
  // Logs for today and yesterday.
  logs: HabitLog[];
  today: string;
  yesterday: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dayLogs = logs.filter((log) => log.date === date);
  const days = summarizeHabitDay(habits, dayLogs);

  return (
    <section className="card habit-logger" aria-label="Log habits" id="log">
      <div className="card-heading">
        <h2 className="card-title">Habits</h2>
        <div className="segmented" role="group" aria-label="Day">
          {[
            { value: today, label: "Today" },
            { value: yesterday, label: "Yesterday" }
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={date === option.value ? "active" : ""}
              aria-pressed={date === option.value}
              onClick={() => setDate(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="habit-logger-list">
        {days.map((day) => (
          <li key={day.habit.id} className={day.status}>
            <button
              type="button"
              className="habit-logger-row"
              aria-expanded={open === day.habit.id}
              onClick={() => setOpen((current) => (current === day.habit.id ? null : day.habit.id))}
            >
              <span>{day.habit.name}</span>
              <span>{describeHabitDay(day)}</span>
            </button>
            {open === day.habit.id ? (
              <HabitPanel
                key={date}
                habit={day.habit}
                date={date}
                logs={dayLogs.filter((log) => log.habitId === day.habit.id)}
                onDone={(message) => {
                  setError(message ?? null);
                  router.refresh();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="chat-error">{error}</p> : null}
    </section>
  );
}
