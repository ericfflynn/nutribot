import { ChatPromptButton } from "./chat-sheet";
import { localDateTime } from "@/lib/dates";
import { formatHabitAmount, formatMinutes, type HabitDay } from "@/lib/habits";
import { RATINGS, type JournalEntry } from "@/lib/journal";

function clock(time: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(`2000-01-01T${time}:00Z`)
  );
}

// "Light ×2", "2h · until 11:40 PM · 1h 40m late", "None", "Not logged".
function habitStatus(day: HabitDay) {
  if (day.status === "unknown") return "Not logged";
  if (day.status === "none") return "None";
  const parts = [formatHabitAmount(day.habit, day.level) + (day.habit.measure === "intensity" && day.uses > 1 ? ` ×${day.uses}` : "")];
  if (day.habit.cutoff && day.latestEnd) parts.push(`until ${clock(day.latestEnd)}`);
  if (day.lateMinutes) parts.push(`${formatMinutes(day.lateMinutes)} late`);
  return parts.join(" · ");
}

// Today's journal ratings and each habit's status. Entries and logs themselves
// are rows in the timeline.
export function CheckinSummary({
  entries,
  habitDays,
  isToday
}: {
  entries: JournalEntry[];
  habitDays: HabitDay[];
  isToday: boolean;
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
      {habitDays.length ? (
        <ul className="checkin-habits">
          {habitDays.map((day) => (
            <li key={day.habit.id} className={day.status}>
              <span>{day.habit.name}</span>
              <span>{habitStatus(day)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
