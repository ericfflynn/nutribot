"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteHabitLogAction, logHabitAction } from "./actions";
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

const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const OUTCOME_LABELS: Record<HabitOutcome, string> = {
  unknown: "not logged",
  met: "goal met",
  "miss-1": "a little over",
  "miss-2": "over",
  "miss-3": "way over",
  used: "can't tell"
};

// The Habits tab's 14-day grid, colored by how each day went against the
// habit's goal. Tapping a square opens that day's logger below the grid;
// tapping a name opens today. The chat logs the same rows.
export function HabitGrid({ habits, days, logs }: { habits: Habit[]; days: string[]; logs: HabitLog[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ habitId: string; date: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = days[days.length - 1];

  const byDay = new Map(days.map((date) => [date, summarizeHabitDay(habits, date, logs.filter((log) => log.date === date))]));
  const rows = habits.map((habit, index) => {
    const cells = days.map((date) => {
      const day = byDay.get(date)![index];
      return { date, day, outcome: habitOutcome(day) };
    });
    const logged = cells.filter((cell) => cell.outcome !== "unknown");
    return { habit, cells, met: logged.filter((cell) => cell.outcome === "met").length, logged: logged.length };
  });

  const selectedHabit = selected ? habits.find((habit) => habit.id === selected.habitId) : undefined;
  const selectedDay = selected && selectedHabit ? byDay.get(selected.date)?.[habits.indexOf(selectedHabit)] : undefined;
  const toggle = (habitId: string, date: string) =>
    setSelected((current) => (current?.habitId === habitId && current.date === date ? null : { habitId, date }));

  return (
    <section className="card habit-grid-card" aria-label="Habits, last 14 days">
      <div className="card-heading">
        <h2 className="card-title">Habits</h2>
        <span className="card-aside">goal met / days logged</span>
      </div>
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
