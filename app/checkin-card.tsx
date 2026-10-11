import { ChatPromptButton } from "./chat-sheet";
import { localDateTime } from "@/lib/dates";
import { RATINGS, type JournalEntry } from "@/lib/journal";

// Today's journal ratings. The entries themselves are rows in the timeline.
export function CheckinSummary({ entries, isToday }: { entries: JournalEntry[]; isToday: boolean }) {
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
    </section>
  );
}
