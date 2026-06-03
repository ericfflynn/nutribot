import Link from "next/link";
import { HomeProgressCard } from "./home-progress-card";
import { AppShell, Login } from "./shared-ui";
import { getAllowedUsers, getSessionUser } from "@/lib/auth";
import { currentWeekToDate, todayLocalDate } from "@/lib/dates";
import { getFallbackMacroGoals, gramsFromPercentGoals } from "@/lib/goals";
import {
  getUserMacroGoals,
  isDatabaseConfigured,
  listEntriesForDate,
  listEntriesForDateRange,
  summarizeEntries
} from "@/lib/supabase";

type PageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

async function getHomeUserSummary(userName: string, entryDate: string, week: { startDate: string; endDate: string; elapsedDays: number }) {
  const databaseReady = isDatabaseConfigured();
  const [entries, weeklyEntries, goals] = databaseReady
    ? await Promise.all([
        listEntriesForDate(userName, entryDate),
        listEntriesForDateRange(userName, week.startDate, week.endDate),
        getUserMacroGoals(userName)
      ])
    : [[], [], getFallbackMacroGoals(userName)];

  const totals = summarizeEntries(entries);
  const weeklyTotals = summarizeEntries(weeklyEntries);
  const weeklyAverages = {
    calories: weeklyTotals.calories / week.elapsedDays,
    protein_g: weeklyTotals.protein_g / week.elapsedDays,
    carbs_g: weeklyTotals.carbs_g / week.elapsedDays,
    fat_g: weeklyTotals.fat_g / week.elapsedDays
  };

  return {
    userName,
    totals,
    weeklyAverages,
    goals,
    gramGoals: gramsFromPercentGoals(goals),
    loggedMeals: entries.length
  };
}

export default async function Home({ searchParams }: PageProps) {
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
  const summaries = await Promise.all(
    getAllowedUsers().map((userName) => getHomeUserSummary(userName, entryDate, week))
  ).catch((error: unknown) => {
    databaseError = error instanceof Error ? error.message : "Database connection failed.";
    return [];
  });

  return (
    <AppShell user={user} date={entryDate} active="home">
      <section className="dashboard">
        <section className="home-intro">
          <div>
            <span className="eyebrow">Home</span>
            <strong>Daily and weekly progress</strong>
            <p className="muted">
              Shared view for everyone using the app. Your logging tools live under Profile.
            </p>
          </div>
          <Link className="button" href="/profile">
            Log my meal
          </Link>
        </section>

        {!databaseReady || databaseError ? (
          <div className="panel entry-form">
            <strong>{databaseError ? "Database connection failed." : "Database is not configured yet."}</strong>
            <p className="muted">
              {databaseError ||
                "Login works locally. Add DATABASE_URL or Supabase API env vars before testing shared progress."}
            </p>
          </div>
        ) : null}

        <section className="user-progress-list">
          {summaries.map((summary) => (
            <HomeProgressCard
              goals={{
                calories: summary.goals.calories,
                protein_g: summary.gramGoals.protein_g,
                carbs_g: summary.gramGoals.carbs_g,
                fat_g: summary.gramGoals.fat_g
              }}
              key={summary.userName}
              loggedMeals={summary.loggedMeals}
              today={summary.totals}
              userName={summary.userName}
              weekAverage={summary.weeklyAverages}
            />
          ))}
        </section>

        <section className="weekly-summary">
          <div>
            <span className="eyebrow">Week</span>
            <strong>Current week window</strong>
            <p className="muted">
              {week.startDate} to {week.endDate} · {week.elapsedDays} elapsed {week.elapsedDays === 1 ? "day" : "days"}
            </p>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
