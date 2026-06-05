import Link from "next/link";
import { EntryCard } from "../entry-card";
import { HomeProgressCard } from "../home-progress-card";
import { MealLogger } from "../meal-logger";
import { AppShell, GoalsForm, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { isValidLocalDate, rollingDateWindow, todayLocalDate } from "@/lib/dates";
import { gramsFromPercentGoals } from "@/lib/goals";
import {
  getUserMacroGoals,
  isDatabaseConfigured,
  listEntriesForDate,
  listEntriesForDateRange,
  summarizeCompletedLoggedDayAverages,
  summarizeEntries
} from "@/lib/supabase";

type PageProps = {
  searchParams?: Promise<{
    date?: string;
    error?: string;
  }>;
};

function formatDayLabel(entryDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short"
  }).format(new Date(`${entryDate}T00:00:00Z`));
}

function formatDayNumber(entryDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    day: "numeric"
  }).format(new Date(`${entryDate}T00:00:00Z`));
}

function formatDateText(entryDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${entryDate}T00:00:00Z`));
}

function DatePicker({
  dates,
  selectedDate,
  today,
  entriesByDate
}: {
  dates: string[];
  selectedDate: string;
  today: string;
  entriesByDate: Record<string, number>;
}) {
  return (
    <nav className="date-picker panel" aria-label="Meal log dates">
      {dates.map((date) => {
        const isSelected = date === selectedDate;
        const isToday = date === today;
        const mealCount = entriesByDate[date] || 0;

        return (
          <Link
            aria-current={isSelected ? "date" : undefined}
            className={`date-chip ${isSelected ? "active" : ""}`}
            href={`/profile?date=${date}`}
            key={date}
          >
            <span>{isToday ? "Today" : formatDayLabel(date)}</span>
            <strong>{formatDayNumber(date)}</strong>
            <small>{mealCount ? `${mealCount} meal${mealCount === 1 ? "" : "s"}` : "No meals"}</small>
          </Link>
        );
      })}
    </nav>
  );
}

export default async function Profile({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params?.error;
  const user = await getSessionUser();

  if (!user) {
    return <Login error={error} />;
  }

  const today = todayLocalDate();
  const entryDate = params?.date && isValidLocalDate(params.date) ? params.date : today;
  const rollingDates = rollingDateWindow(today, 7);
  const rollingStartDate = rollingDates[0];
  const databaseReady = isDatabaseConfigured();
  let databaseError: string | null = null;
  const [entries, rollingEntries] = databaseReady
    ? await Promise.all([
        listEntriesForDate(user.name, entryDate),
        listEntriesForDateRange(user.name, rollingStartDate, today)
      ]).catch((error: unknown) => {
        databaseError = error instanceof Error ? error.message : "Database connection failed.";
        return [[], []];
      })
    : [[], []];
  const totals = summarizeEntries(entries);
  const rollingSummary = summarizeCompletedLoggedDayAverages(rollingEntries, today);
  const rollingAverages = rollingSummary.averages;
  const entriesByDate = rollingEntries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.entry_date] = (counts[entry.entry_date] || 0) + 1;
    return counts;
  }, {});
  const goals = databaseReady
    ? await getUserMacroGoals(user.name).catch((error: unknown) => {
        databaseError = error instanceof Error ? error.message : "Database connection failed.";
        return {
          calories: 2200,
          proteinPct: 30,
          carbsPct: 40,
          fatPct: 30
        };
      })
    : {
        calories: 2200,
        proteinPct: 30,
        carbsPct: 40,
        fatPct: 30
      };
  const gramGoals = gramsFromPercentGoals(goals);

  return (
    <AppShell user={user} date={entryDate} active="profile">
      <section className="dashboard">
        <section className="profile-summary">
          <div>
            <span className="eyebrow">Profile</span>
            <strong>{formatDateText(entryDate)}</strong>
            <p className="muted">
              Rolling 7 days · {rollingStartDate} to {today}
            </p>
          </div>
          <DatePicker dates={rollingDates} selectedDate={entryDate} today={today} entriesByDate={entriesByDate} />
          <HomeProgressCard
            goals={{
              calories: goals.calories,
              protein_g: gramGoals.protein_g,
              carbs_g: gramGoals.carbs_g,
              fat_g: gramGoals.fat_g
            }}
            loggedMeals={entries.length}
            today={totals}
            userName={user.name}
            weekAverage={rollingAverages}
            weekAverageDayCount={rollingSummary.dayCount}
          />
        </section>

        <GoalsForm goals={goals} disabled={!databaseReady || Boolean(databaseError)} redirectDate={entryDate} />

        {!databaseReady || databaseError ? (
          <div className="panel entry-form">
            <strong>{databaseError ? "Database connection failed." : "Database is not configured yet."}</strong>
            <p className="muted">
              {databaseError ||
                "Login works locally. Add DATABASE_URL or Supabase API env vars before testing meal logging."}
            </p>
          </div>
        ) : null}

        <MealLogger disabled={!databaseReady || Boolean(databaseError)} entryDate={entryDate} error={error} />

        <section className="history">
          <div>
            <span className="eyebrow">Meal history</span>
            <strong>{formatDateText(entryDate)}</strong>
          </div>
          <div className="entry-list">
            {entries.length === 0 ? (
              <div className="panel empty">No meals logged for this day.</div>
            ) : (
              entries.map((entry) => <EntryCard entry={entry} key={entry.id} selectedDate={entryDate} />)
            )}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
