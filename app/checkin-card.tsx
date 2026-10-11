import Link from "next/link";
import { ChatPromptButton } from "./chat-sheet";
import { localDateTime } from "@/lib/dates";
import { describeHabitDay, type HabitDay } from "@/lib/habits";
import { RATINGS, type JournalEntry } from "@/lib/journal";

// Today's journal ratings and each habit's status. Entries and logs themselves
// are rows in the timeline. The Habits tab passes no habitDays: its logger
// lists them instead.
export function CheckinSummary({
  entries,
  habitDays = [],
  isToday,
  logLink = false
}: {
  entries: JournalEntry[];
  habitDays?: HabitDay[];
  isToday: boolean;
  // Link to the Habits tab's logger.
  logLink?: boolean;
}) {
  // The latest entry that gives a rating wins, so the evening outranks the morning.
  const ratings = RATINGS.map((name) => {
    const values = entries.map((entry) => entry.ratings[name]).filter((value): value is number => value != null);
    return { name, value: values.at(-1) ?? null };
  }).filter((rating) => rating.value != null);
  const evening = Number(localDateTime().slice(11, 13)) >= 17;

  return (
    <section className="card checkin-card" aria-label="Check-in">
      <div className="card-heading">
        <h2 className="card-title">Check-in</h2>
        {isToday ? (
          <ChatPromptButton prompt={evening ? "Evening check-in" : "Morning check-in"}>Check in</ChatPromptButton>
        ) : null}
      </div>
      {ratings.length ? (
        <div className="checkin-ratings">
          {ratings.map((rating) => (
            <div key={rating.name}>
              <strong>{rating.value}</strong>
              <span>{rating.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="footnote">{entries.length ? "No ratings in today's entries." : "No journal entry yet."}</p>
      )}
      {habitDays.length && logLink ? (
        <div className="checkin-habits-head">
          <span>Habits</span>
          <Link href="/habits">Log</Link>
        </div>
      ) : null}
      {habitDays.length ? (
        <ul className="checkin-habits">
          {habitDays.map((day) => (
            <li key={day.habit.id} className={day.status}>
              <span>{day.habit.name}</span>
              <span>{describeHabitDay(day)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
