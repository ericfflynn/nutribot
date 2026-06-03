import { EntryCard } from "../entry-card";
import { HomeProgressCard } from "../home-progress-card";
import { MealLogger } from "../meal-logger";
import { AppShell, GoalsForm, Login } from "../shared-ui";
import { getSessionUser } from "@/lib/auth";
import { currentWeekToDate, todayLocalDate } from "@/lib/dates";
import { gramsFromPercentGoals } from "@/lib/goals";
import {
  getUserMacroGoals,
  isDatabaseConfigured,
  listEntriesForDate,
  listEntriesForDateRange,
  listRecentEntries,
  summarizeEntries
} from "@/lib/supabase";

type PageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function Profile({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params?.error;
  const user = await getSessionUser();

  if (!user) {
    return <Login error={error} />;
  }

  const entryDate = todayLocalDate();
  const week = currentWeekToDate(entryDate);
  const databaseReady = isDatabaseConfigured();
  let databaseError: string | null = null;
  const [entries, weeklyEntries, recentEntries] = databaseReady
    ? await Promise.all([
        listEntriesForDate(user.name, entryDate),
        listEntriesForDateRange(user.name, week.startDate, week.endDate),
        listRecentEntries(user.name)
      ]).catch((error: unknown) => {
        databaseError = error instanceof Error ? error.message : "Database connection failed.";
        return [[], [], []];
      })
    : [[], [], []];
  const totals = summarizeEntries(entries);
  const weeklyTotals = summarizeEntries(weeklyEntries);
  const weeklyAverages = {
    calories: weeklyTotals.calories / week.elapsedDays,
    protein_g: weeklyTotals.protein_g / week.elapsedDays,
    carbs_g: weeklyTotals.carbs_g / week.elapsedDays,
    fat_g: weeklyTotals.fat_g / week.elapsedDays
  };
  const historyEntries = [
    ...entries,
    ...recentEntries.filter((recentEntry) => !entries.some((entry) => entry.id === recentEntry.id))
  ];
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
            <strong>Your progress</strong>
            <p className="muted">
              {week.startDate} to {week.endDate} · {week.elapsedDays} elapsed {week.elapsedDays === 1 ? "day" : "days"}
            </p>
          </div>
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
            weekAverage={weeklyAverages}
          />
        </section>

        <GoalsForm goals={goals} disabled={!databaseReady || Boolean(databaseError)} />

        {!databaseReady || databaseError ? (
          <div className="panel entry-form">
            <strong>{databaseError ? "Database connection failed." : "Database is not configured yet."}</strong>
            <p className="muted">
              {databaseError ||
                "Login works locally. Add DATABASE_URL or Supabase API env vars before testing meal logging."}
            </p>
          </div>
        ) : null}

        <MealLogger disabled={!databaseReady || Boolean(databaseError)} error={error} />

        <section className="history">
          <div>
            <span className="eyebrow">Meal history</span>
            <strong>Today and recent meals</strong>
          </div>
          <div className="entry-list">
            {historyEntries.length === 0 ? (
              <div className="panel empty">No meals logged yet.</div>
            ) : (
              historyEntries.map((entry) => <EntryCard entry={entry} key={entry.id} />)
            )}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
