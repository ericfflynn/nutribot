import { ChatPromptButton } from "../chat-sheet";
import { CheckinSummary } from "../checkin-card";
import { HabitEditor } from "../habit-editor";
import { HabitGrid } from "../habit-logger";
import { JournalHistory } from "../journal-ui";
import { RemindersCard } from "../reminders-toggle";
import { AppShell, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { addDays, rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { describeDays, describeGoal, listHabitLogs, listHabits, scaleGuideLines, type Habit } from "@/lib/habits";
import { listJournalEntries } from "@/lib/journal";
import { listReminders, remindersSentOn, vapidPublicKey } from "@/lib/reminders";
import { getPool } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// Room for the health sync that opening the app may run (autoSyncHealthAction).
export const maxDuration = 60;

const WINDOW_DAYS = 14;
// Journal entries loaded for tag filters and patterns.
const JOURNAL_DAYS = 90;

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

function describeMeasure(habit: Habit) {
  const measure =
    habit.measure === "intensity" ? "Rated light, moderate or heavy" : habit.measure === "count" ? `Counted in ${habit.unit}` : "Minutes";
  const goal = describeGoal(habit);
  return [measure, goal ? `goal: ${goal.toLowerCase()}` : "no goal set", habit.days ? describeDays(habit.days) : null]
    .filter(Boolean)
    .join(" · ");
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
  const [allHabits, logs, journal, reminders, sent] = await Promise.all([
    listHabits(db, user.name, true),
    listHabitLogs(db, user.name, days[0], today),
    listJournalEntries(db, user.name, addDays(today, -(JOURNAL_DAYS - 1)), today),
    listReminders(db, user.name),
    remindersSentOn(db, user.name, today)
  ]);
  const habits = allHabits.filter((habit) => habit.active);
  const archived = allHabits.filter((habit) => !habit.active);
  const todayEntries = journal.filter((entry) => entry.date === today);
  const habitReminder = new Map(
    reminders.filter((reminder) => reminder.kind === "habit").map((reminder) => [reminder.habitId, reminder.hour])
  );

  return (
    <AppShell user={user} date={today} active="habits" title="Habits">
      <CheckinSummary entries={todayEntries} isToday />

      {habits.length ? <HabitGrid habits={habits} days={days} logs={logs} /> : null}

      <JournalHistory entries={journal} recentFrom={days[0]} rangeDays={JOURNAL_DAYS} />

      <section className="card" aria-label="Tracked habits">
        <div className="card-heading">
          <h2 className="card-title">Tracked habits</h2>
          <ChatPromptButton prompt="Start tracking ">Add</ChatPromptButton>
        </div>
        <ul className="habit-list">
          {habits.map((habit) => (
            <li key={habit.id}>
              <div className="habit-list-head">
                <strong>{habit.name}</strong>
                <HabitEditor
                  key={JSON.stringify([habit, habitReminder.get(habit.id)])}
                  habit={habit}
                  reminderHour={habitReminder.get(habit.id) ?? null}
                />
              </div>
              {habit.description ? <span>{habit.description}</span> : null}
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
        {archived.length ? (
          <details className="habit-archived">
            <summary>Stopped tracking ({archived.length})</summary>
            <ul className="habit-list">
              {archived.map((habit) => (
                <li key={habit.id}>
                  <div className="habit-list-head">
                    <strong>{habit.name}</strong>
                    <HabitEditor key={JSON.stringify(habit)} habit={habit} reminderHour={null} />
                  </div>
                  <span>{describeMeasure(habit)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="footnote">Edits keep each habit's history. You can also tell the chat what to change.</p>
      </section>

      <RemindersCard
        publicKey={vapidPublicKey()}
        reminders={reminders}
        habits={habits.map((habit) => ({ id: habit.id, name: habit.name }))}
        sentToday={Object.fromEntries(sent)}
        today={today}
      />
    </AppShell>
  );
}
