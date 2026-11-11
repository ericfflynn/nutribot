"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteHabitLogAction, logHabitAction, setHabitDayAction, updateHabitLogAction } from "./actions";
import {
  INTENSITY_LABELS,
  describeGoal,
  describeHabitDay,
  formatClockTime,
  formatHabitAmount,
  habitOutcome,
  summarizeHabitDay,
  type Habit,
  type HabitLog,
  type HabitOutcome
} from "@/lib/habits";

// Minutes between two "HH:MM" times, past midnight when the end is earlier.
function minutesBetween(start: string, end: string) {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const diff = toMinutes(end) - toMinutes(start);
  return diff >= 0 ? diff : diff + 24 * 60;
}

// Fixes one logged entry in place: amount, day, note and times.
function LogEditor({
  habit,
  log,
  today,
  onDone,
  onCancel
}: {
  habit: Habit;
  log: HabitLog;
  today: string;
  onDone: (error?: string) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(log.date);
  const [amount, setAmount] = useState(String(log.amount));
  const [details, setDetails] = useState(log.details ?? "");
  const [startedAt, setStartedAt] = useState(log.startedAt ?? "");
  const [endedAt, setEndedAt] = useState(log.endedAt ?? "");

  async function save() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter an amount of 0 or more.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await updateHabitLogAction(log.id, habit.id, {
      date,
      amount: value,
      details: details || null,
      startedAt: startedAt || null,
      endedAt: endedAt || null
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    onDone();
  }

  return (
    <div className="habit-log-editor">
      <div className="habit-times">
        <label>
          <span>Day</span>
          <input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          <span>{habit.measure === "intensity" ? "Level" : habit.measure === "count" ? habit.unit ?? "Count" : "Minutes"}</span>
          {habit.measure === "intensity" ? (
            <select value={amount} onChange={(event) => setAmount(event.target.value)}>
              {INTENSITY_LABELS.map((label, level) => (
                <option key={label} value={level}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="1440"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </label>
      </div>
      {Number(amount) > 0 ? (
        <>
          <input
            className="habit-note"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="Note (optional)"
            maxLength={300}
          />
          {habit.cutoff || log.startedAt || log.endedAt ? (
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
        </>
      ) : null}
      {error ? <p className="workout-editor-error">{error}</p> : null}
      <div className="habit-choices">
        <button type="button" className="pill-button primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="pill-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function HabitPanel({
  habit,
  date,
  today,
  logs,
  onDone
}: {
  habit: Habit;
  date: string;
  today: string;
  logs: HabitLog[];
  onDone: (error?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
          {logs.map((log) =>
            editingId === log.id ? (
              <li key={log.id}>
                <LogEditor
                  habit={habit}
                  log={log}
                  today={today}
                  onCancel={() => setEditingId(null)}
                  onDone={() => {
                    setEditingId(null);
                    onDone();
                  }}
                />
              </li>
            ) : (
              <li key={log.id}>
                <span>
                  {formatHabitAmount(habit, log.amount)}
                  {log.startedAt && log.endedAt ? ` · ${formatClockTime(log.startedAt)}–${formatClockTime(log.endedAt)}` : ""}
                  {log.details ? <small>{log.details}</small> : null}
                </span>
                <span className="habit-log-actions">
                  <button type="button" className="text-button" onClick={() => setEditingId(log.id)} disabled={busy}>
                    Edit
                  </button>
                  <button type="button" className="text-button danger" onClick={() => remove(log.id)} disabled={busy} aria-label="Remove">
                    ✕
                  </button>
                </span>
              </li>
            )
          )}
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

const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const OUTCOME_LABELS: Record<HabitOutcome, string> = {
  unknown: "not logged",
  off: "not tracked that day",
  met: "goal met",
  "miss-1": "a little over",
  "miss-2": "over",
  "miss-3": "way over",
  used: "can't tell"
};

// "5 days · best 16", green on the best yet, red at 0.
function HabitStreak({ streak }: { streak?: { current: number; best: number } }) {
  if (!streak) return null;
  const atBest = streak.current > 0 && streak.current >= streak.best;
  return (
    <small className={`habit-streak${atBest ? " best" : streak.current ? "" : " broken"}`}>
      <strong>{streak.current}</strong> {streak.current === 1 ? "day" : "days"}
      <span>{atBest ? " · best yet" : ` · best ${streak.best}`}</span>
    </small>
  );
}

// One-tap amounts for Log today: none, then a few amounts on the habit's
// own scale (around its goal).
function quickOptions(habit: Habit): { amount: number; label: string }[] {
  if (habit.measure === "intensity") return [0, 1, 2, 3].map((amount) => ({ amount, label: amount ? INTENSITY_LABELS[amount] : "None" }));
  if (habit.measure === "count") return [0, 1, 2, 3].map((amount) => ({ amount, label: amount ? String(amount) : "None" }));
  const goal = habit.goal && habit.goal > 0 ? habit.goal : null;
  const steps = habit.direction === "build" ? [goal ?? 15, (goal ?? 15) * 2, (goal ?? 15) * 4] : [(goal ?? 60) / 2, goal ?? 60, (goal ?? 60) * 2];
  const label = (minutes: number) => (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.round(minutes)} m`);
  return [{ amount: 0, label: "None" }, ...[...new Set(steps.map(Math.round))].map((amount) => ({ amount, label: label(amount) }))];
}

// Habits tab, top: today's amount for each habit in one tap (the owner,
// Nov 10, 2026: logging in the grid was clunky). Tapping the picked one
// clears the day. Times and details: today's square in the grid, or chat.
export function LogToday({ habits, logs, today }: { habits: Habit[]; logs: HabitLog[]; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = summarizeHabitDay(habits, today, logs.filter((log) => log.date === today));
  const logged = days.filter((day) => day.status !== "unknown").length;

  async function pick(habit: Habit, amount: number | null) {
    setBusy(habit.id);
    setError(null);
    const result = await setHabitDayAction(habit.id, today, amount);
    setBusy(null);
    if (!result.ok) setError(result.error ?? "Couldn't save that.");
    router.refresh();
  }

  return (
    <section className="card log-today" aria-label="Log today">
      <div className="card-heading">
        <h2 className="card-title">Log today</h2>
        <span className="card-aside">
          {logged} of {habits.length} logged
        </span>
      </div>
      {habits.map((habit, index) => {
        const day = days[index];
        const current = day.status === "unknown" ? null : day.status === "none" ? 0 : day.level;
        const options = quickOptions(habit);
        const other = current != null && !options.some((option) => option.amount === current);
        return (
          <div key={habit.id} className="log-today-row">
            <span className="log-today-name">
              {habit.name}
              {describeGoal(habit) ? <small>{describeGoal(habit)}</small> : null}
              {other ? <small>· logged {formatHabitAmount(habit, current!)}</small> : null}
            </span>
            <div className="log-today-options">
              {options.map((option) => {
                const on = current === option.amount;
                return (
                  <button
                    key={option.amount}
                    type="button"
                    className={on ? "on" : undefined}
                    aria-pressed={on}
                    disabled={busy === habit.id}
                    onClick={() => pick(habit, on ? null : option.amount)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {error ? <p className="chat-error">{error}</p> : null}
      <p className="footnote">Tap again to clear. For times or details, tap today in the grid below, or tell the chat.</p>
    </section>
  );
}

const PAGE_DAYS = 7;
const rangeFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The Habits tab's week grid (mockup B, Nov 10, 2026): 7 days at a time,
// newest week first with earlier weeks a tap back, colored by how each day
// went against the habit's goal, each habit with its streak. Tapping a
// square opens that day's logger below the grid. The chat logs the same rows.
export function HabitGrid({
  habits,
  days: allDays,
  logs,
  streaks
}: {
  habits: Habit[];
  days: string[]; // oldest first, ending today
  logs: HabitLog[];
  streaks: Record<string, { current: number; best: number }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ habitId: string; date: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const today = allDays[allDays.length - 1];
  const pages = Math.max(1, Math.ceil(allDays.length / PAGE_DAYS));
  const endAt = allDays.length - page * PAGE_DAYS;
  const days = allDays.slice(Math.max(0, endAt - PAGE_DAYS), endAt);
  const before = allDays.slice(Math.max(0, endAt - 2 * PAGE_DAYS), Math.max(0, endAt - PAGE_DAYS));

  const byDay = new Map(allDays.map((date) => [date, summarizeHabitDay(habits, date, logs.filter((log) => log.date === date))]));
  const tally = (dates: string[]) => {
    let met = 0;
    let logged = 0;
    for (const date of dates) {
      for (const day of byDay.get(date) ?? []) {
        const outcome = habitOutcome(day);
        if (outcome === "unknown" || outcome === "off") continue;
        logged += 1;
        if (outcome === "met") met += 1;
      }
    }
    return { met, logged };
  };
  const week = tally(days);
  const prior = tally(before);
  const pct = (part: { met: number; logged: number }) => (part.logged ? Math.round((part.met / part.logged) * 100) : null);
  const change =
    pct(week) == null || pct(prior) == null || pct(week) === pct(prior)
      ? null
      : `${pct(week)! < pct(prior)! ? "down" : "up"} from ${pct(prior)}% the week before`;
  const rows = habits.map((habit, index) => {
    const cells = days.map((date) => {
      const day = byDay.get(date)![index];
      return { date, day, outcome: habitOutcome(day) };
    });
    const logged = cells.filter((cell) => cell.outcome !== "unknown" && cell.outcome !== "off");
    return { habit, cells, met: logged.filter((cell) => cell.outcome === "met").length, logged: logged.length };
  });

  const selectedHabit = selected ? habits.find((habit) => habit.id === selected.habitId) : undefined;
  const selectedDay = selected && selectedHabit ? byDay.get(selected.date)?.[habits.indexOf(selectedHabit)] : undefined;
  const toggle = (habitId: string, date: string) =>
    setSelected((current) => (current?.habitId === habitId && current.date === date ? null : { habitId, date }));
  const title = page === 0 ? "Last 7 days" : `${rangeFormat.format(new Date(`${days[0]}T00:00:00Z`))} – ${rangeFormat.format(new Date(`${days[days.length - 1]}T00:00:00Z`))}`;

  return (
    <section className="card habit-grid-card" aria-label="Habits by day">
      <div className="card-heading">
        <h2 className="card-title">{title}</h2>
        <span className="habit-pager">
          <button type="button" className="text-button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Earlier week">
            ‹
          </button>
          <button type="button" className="text-button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Later week">
            ›
          </button>
        </span>
      </div>
      {week.logged ? (
        <p className="habit-week-summary">
          <strong>{week.met}</strong> of {week.logged} habit-days met
          {change ? <span className={change.startsWith("down") ? "down" : "up"}>{change}</span> : null}
        </p>
      ) : null}
      <div className="coverage habit-grid">
        <span />
        <div className="coverage-cells">
          {days.map((date) => (
            <span key={date} className="coverage-dow">
              {weekdayLetter.format(new Date(`${date}T00:00:00Z`))}
            </span>
          ))}
        </div>
        <span />
        {rows.map((row) => (
          <div className="coverage-row" key={row.habit.id}>
            <button type="button" className="coverage-name habit-name" onClick={() => toggle(row.habit.id, today)}>
              {row.habit.name}
              <HabitStreak streak={streaks[row.habit.id]} />
            </button>
            <div className="coverage-cells">
              {row.cells.map((cell) => {
                const isSelected = selected?.habitId === row.habit.id && selected.date === cell.date;
                return (
                  <button
                    key={cell.date}
                    type="button"
                    className={`coverage-cell habit-cell ${cell.outcome}${isSelected ? " selected" : ""}`}
                    aria-label={`${row.habit.name}, ${dayFormat.format(new Date(`${cell.date}T00:00:00Z`))}: ${describeHabitDay(cell.day)}, ${OUTCOME_LABELS[cell.outcome]}`}
                    aria-pressed={isSelected}
                    onClick={() => toggle(row.habit.id, cell.date)}
                  />
                );
              })}
            </div>
            <span className="coverage-since">{row.logged ? `${row.met}/${row.logged}` : "–"}</span>
          </div>
        ))}
      </div>
      <div className="coverage-legend" aria-hidden="true">
        <span>
          <i className="coverage-cell met" /> Met
        </span>
        <span>
          <i className="coverage-cell miss-1" />
          <i className="coverage-cell miss-2" />
          <i className="coverage-cell miss-3" /> Missed
        </span>
        <span>
          <i className="coverage-cell used" /> Can't tell
        </span>
        <span>
          <i className="coverage-cell" /> Not logged
        </span>
      </div>

      {selected && selectedHabit && selectedDay ? (
        <div className="habit-selected">
          <div className="habit-selected-head">
            <div>
              <strong>{selectedHabit.name}</strong>
              <span>
                {selected.date === today ? "Today" : dayFormat.format(new Date(`${selected.date}T00:00:00Z`))} ·{" "}
                {describeHabitDay(selectedDay)}
              </span>
              {describeGoal(selectedHabit) ? <small>Goal: {describeGoal(selectedHabit)}</small> : null}
            </div>
            <button type="button" className="text-button" onClick={() => setSelected(null)}>
              Done
            </button>
          </div>
          <HabitPanel
            key={`${selected.habitId}-${selected.date}`}
            habit={selectedHabit}
            date={selected.date}
            today={today}
            logs={logs.filter((log) => log.habitId === selected.habitId && log.date === selected.date)}
            onDone={(message) => {
              setError(message ?? null);
              router.refresh();
            }}
          />
        </div>
      ) : (
        <p className="footnote">Tap a square to log or fix that day; tap a name for today.</p>
      )}
      {error ? <p className="chat-error">{error}</p> : null}
    </section>
  );
}
