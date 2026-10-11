import { ChatPromptButton } from "../chat-sheet";
import { CheckinSummary } from "../checkin-card";
import { HabitGrid } from "../habit-logger";
import { RemindersToggle } from "../reminders-toggle";
import { AppShell, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { describeGoal, listHabitLogs, listHabits, scaleGuideLines, type Habit } from "@/lib/habits";
import { RATINGS, listJournalEntries } from "@/lib/journal";
import { vapidPublicKey } from "@/lib/reminders";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

function describeMeasure(habit: Habit) {
  const measure =
    habit.measure === "intensity" ? "Rated light, moderate or heavy" : habit.measure === "count" ? `Counted in ${habit.unit}` : "Minutes";
  const goal = describeGoal(habit);
  return [measure, goal ? `goal: ${goal.toLowerCase()}` : "no goal set"].join(" · ");
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
  const todayEntries = journal.filter((entry) => entry.date === today);

  return (
    <AppShell user={user} date={today} active="habits" title="Habits">
      <CheckinSummary entries={todayEntries} isToday />

      {habits.length ? <HabitGrid habits={habits} days={days} logs={logs} /> : null}

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
