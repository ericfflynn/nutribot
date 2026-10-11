import { ChatPromptButton } from "../chat-sheet";
import { CheckinSummary } from "../checkin-card";
import { RemindersToggle } from "../reminders-toggle";
import { AppShell, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { rollingDateWindow, todayLocalDate } from "@/lib/dates";
import {
  listHabitLogs,
  listHabits,
  scaleGuideLines,
  summarizeHabitDay,
  type Habit,
  type HabitDay
} from "@/lib/habits";
import { RATINGS, listJournalEntries } from "@/lib/journal";
import { vapidPublicKey } from "@/lib/reminders";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const weekdayLetter = new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

// Grid shade 1-3. Intensity habits use their rating; drinks use 1-2, 3-4 and
// 5+; minutes are thirds of the habit's busiest day in the window.
function shade(day: HabitDay, maxMinutes: number) {
  if (day.status !== "used") return 0;
  if (day.habit.measure === "intensity") return Math.min(3, day.level);
  if (day.habit.measure === "count") return day.level >= 5 ? 3 : day.level >= 3 ? 2 : 1;
  return Math.min(3, Math.max(1, Math.ceil((day.level / Math.max(1, maxMinutes)) * 3)));
}

function describeMeasure(habit: Habit) {
  const measure =
    habit.measure === "intensity" ? "Rated light, moderate or heavy" : habit.measure === "count" ? `Counted in ${habit.unit}` : "Minutes";
  const parts = [measure, habit.direction === "limit" ? "less is better" : "more is better"];
  if (habit.cutoff) {
    const [hours, minutes] = habit.cutoff.split(":").map(Number);
    parts.push(`late after ${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours < 12 ? "am" : "pm"}`);
  }
  return parts.join(" · ");
}

export default async function HabitsPage() {
  const user = await getSessionUser();
  if (!user) {
    return <Login />;
  }
  const today = todayLocalDate();
  const db = getPool();
  if (!db) {
    return (
      <AppShell user={user} date={today} active="habits" title="Habits">
        <p className="footnote">Add DATABASE_URL to see your data.</p>
      </AppShell>
    );
  }

  const days = rollingDateWindow(today, WINDOW_DAYS);
  const [habits, logs, journal] = await Promise.all([
    listHabits(db, user.name),
    listHabitLogs(db, user.name, days[0], today),
    listJournalEntries(db, user.name, days[0], today)
  ]);
  const byDay = new Map(days.map((day) => [day, summarizeHabitDay(habits, logs.filter((log) => log.date === day))]));
  const rows = habits.map((habit, index) => {
    const cells = days.map((day) => byDay.get(day)![index]);
    const maxMinutes = habit.measure === "minutes" ? Math.max(0, ...cells.map((cell) => cell.level)) : 0;
    return {
      habit,
      cells: cells.map((cell) => ({ status: cell.status, shade: shade(cell, maxMinutes) })),
      usedDays: cells.filter((cell) => cell.status === "used").length
    };
  });
  const todayEntries = journal.filter((entry) => entry.date === today);

  return (
    <AppShell user={user} date={today} active="habits" title="Habits">
      <CheckinSummary entries={todayEntries} habitDays={byDay.get(today)!} isToday />

      {habits.length ? (
        <section className="card" aria-label="Last 14 days">
          <div className="card-heading">
            <h2 className="card-title">Last {WINDOW_DAYS} days</h2>
            <span className="card-aside">days used</span>
          </div>
          <div className="coverage habit-grid">
            <span />
            <div className="coverage-cells">
              {days.map((day) => (
                <span key={day} className="coverage-dow">
                  {weekdayLetter.format(new Date(`${day}T00:00:00Z`))}
                </span>
              ))}
            </div>
            <span />
            {rows.map((row) => (
              <div className="coverage-row" key={row.habit.id}>
                <span className="coverage-name">{row.habit.name}</span>
                <div className="coverage-cells">
                  {row.cells.map((cell, index) => (
                    <span
                      key={days[index]}
                      className={`coverage-cell habit-${row.habit.direction} ${cell.status === "none" ? "none" : cell.shade ? `level-${cell.shade}` : ""}`}
                    />
                  ))}
                </div>
                <span className="coverage-since">{row.usedDays}</span>
              </div>
            ))}
          </div>
          <div className="coverage-legend" aria-hidden="true">
            <span>
              <i className="coverage-cell habit-limit level-1" /> Light
            </span>
            <span>
              <i className="coverage-cell habit-limit level-3" /> Heavy
            </span>
            <span>
              <i className="coverage-cell none" /> None
            </span>
            <span>
              <i className="coverage-cell" /> Not logged
            </span>
          </div>
        </section>
      ) : null}

      <section className="card" aria-label="Journal">
        <div className="card-heading">
          <h2 className="card-title">Journal</h2>
          <span className="card-aside">{WINDOW_DAYS} days</span>
        </div>
        {journal.length ? (
          <ul className="journal-list">
            {journal.map((entry) => {
              const ratings = RATINGS.filter((name) => entry.ratings[name] != null);
              return (
                <li key={entry.id}>
                  <details>
                    <summary>
                      <span className="journal-when">
                        {formatDay(entry.date)} · {entry.kind}
                      </span>
                      {ratings.length ? (
                        <span className="journal-ratings">
                          {ratings.map((name) => `${name} ${entry.ratings[name]}`).join(" · ")}
                        </span>
                      ) : null}
                      <span className="journal-preview">{entry.body}</span>
                    </summary>
                    <p className="journal-body">{entry.body}</p>
                    {entry.tags.length ? (
                      <div className="draft-chips">
                        {entry.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="footnote">No entries yet. Tell the chat how your day went.</p>
        )}
      </section>

      <section className="card" aria-label="Tracked habits">
        <div className="card-heading">
          <h2 className="card-title">Tracked habits</h2>
          <ChatPromptButton prompt="Start tracking ">Add</ChatPromptButton>
        </div>
        <ul className="habit-list">
          {habits.map((habit) => (
            <li key={habit.id}>
              <strong>{habit.name}</strong>
              <span>{describeMeasure(habit)}</span>
              {habit.scaleGuide ? (
                <ul>
                  {scaleGuideLines(habit.scaleGuide).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="footnote">To change a scale or cutoff, or stop tracking one, tell the chat.</p>
      </section>

      <RemindersToggle publicKey={vapidPublicKey()} />
    </AppShell>
  );
}
