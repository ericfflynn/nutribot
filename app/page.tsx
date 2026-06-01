import { loginAction, logoutAction, saveMacroGoalsAction } from "./actions";
import { EntryCard } from "./entry-card";
import { MealLogger } from "./meal-logger";
import { getAllowedUsers, getSessionUser } from "@/lib/auth";
import { currentWeekToDate, todayLocalDate } from "@/lib/dates";
import { gramsFromPercentGoals, macroCalorieSplit } from "@/lib/goals";
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

function ProgressMetric({
  label,
  value,
  target,
  suffix = ""
}: {
  label: string;
  value: number;
  target: number;
  suffix?: string;
}) {
  const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="panel metric progress-metric">
      <span>{label}</span>
      <strong>
        {Math.round(value)}
        {suffix}
        <small> / {Math.round(target)}{suffix}</small>
      </strong>
      <div className="progress-track" aria-hidden="true">
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Login({ error }: { error?: string }) {
  return (
    <main className="login">
      <section className="panel login-panel">
        <h1>NutriBot Macros</h1>
        <p className="muted">Private meal logging for the two people using this app.</p>
        <form className="form-grid" action={loginAction}>
          <div className="field">
            <label htmlFor="name">User</label>
            <select id="name" name="name" required>
              {getAllowedUsers().map((user) => (
                <option key={user} value={user}>
                  {user}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required />
          </div>
          <button className="button" type="submit">
            Sign in
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}

function GoalsForm({
  goals,
  disabled
}: {
  goals: {
    calories: number;
    proteinPct: number;
    carbsPct: number;
    fatPct: number;
  };
  disabled: boolean;
}) {
  return (
    <details className="panel goals-disclosure">
      <summary>
        <div>
          <span className="eyebrow">Goals</span>
          <strong>Daily targets</strong>
        </div>
        <span className="goal-summary">
          {goals.calories} cal · Protein {goals.proteinPct}% · Carbs {goals.carbsPct}% · Fat {goals.fatPct}%
        </span>
      </summary>
      <form className="goals-form" action={saveMacroGoalsAction}>
        <label>
          <span>Calories</span>
          <input name="calories" type="number" min="1" step="1" defaultValue={goals.calories} disabled={disabled} />
        </label>
        <label>
          <span>Protein %</span>
          <input name="proteinPct" type="number" min="0" step="1" defaultValue={goals.proteinPct} disabled={disabled} />
        </label>
        <label>
          <span>Carbs %</span>
          <input name="carbsPct" type="number" min="0" step="1" defaultValue={goals.carbsPct} disabled={disabled} />
        </label>
        <label>
          <span>Fat %</span>
          <input name="fatPct" type="number" min="0" step="1" defaultValue={goals.fatPct} disabled={disabled} />
        </label>
        <button className="button secondary" type="submit" disabled={disabled}>
          Save goals
        </button>
      </form>
    </details>
  );
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
  const actualSplit = macroCalorieSplit(totals);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>NutriBot Macros</h1>
          <span>
            {user.name} · {entryDate}
          </span>
        </div>
        <form action={logoutAction}>
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section className="dashboard">
        <section className="daily-summary">
          <div>
            <span className="eyebrow">Today</span>
            <strong>Daily totals vs goal</strong>
          </div>
          <div className="summary-grid">
            <ProgressMetric label="Calories" value={totals.calories} target={goals.calories} />
            <ProgressMetric label="Protein" value={totals.protein_g} target={gramGoals.protein_g} suffix="g" />
            <ProgressMetric label="Carbs" value={totals.carbs_g} target={gramGoals.carbs_g} suffix="g" />
            <ProgressMetric label="Fat" value={totals.fat_g} target={gramGoals.fat_g} suffix="g" />
          </div>
        </section>

        <section className="weekly-summary">
          <div>
            <span className="eyebrow">Weekly summary</span>
            <strong>Current week average vs goal</strong>
            <p className="muted">
              {week.startDate} to {week.endDate} · {week.elapsedDays} elapsed {week.elapsedDays === 1 ? "day" : "days"}
            </p>
          </div>
          <div className="summary-grid">
            <ProgressMetric label="Calories" value={weeklyAverages.calories} target={goals.calories} />
            <ProgressMetric label="Protein" value={weeklyAverages.protein_g} target={gramGoals.protein_g} suffix="g" />
            <ProgressMetric label="Carbs" value={weeklyAverages.carbs_g} target={gramGoals.carbs_g} suffix="g" />
            <ProgressMetric label="Fat" value={weeklyAverages.fat_g} target={gramGoals.fat_g} suffix="g" />
          </div>
        </section>

        <div className="panel split-panel">
          <div>
            <span className="eyebrow">Macro balance</span>
            <strong>Today vs target</strong>
          </div>
          <div className="balance-grid">
            <div>
              <span>Protein</span>
              <strong>{actualSplit.proteinPct}%</strong>
              <small>target {goals.proteinPct}%</small>
            </div>
            <div>
              <span>Fat</span>
              <strong>{actualSplit.fatPct}%</strong>
              <small>target {goals.fatPct}%</small>
            </div>
            <div>
              <span>Carbs</span>
              <strong>{actualSplit.carbsPct}%</strong>
              <small>target {goals.carbsPct}%</small>
            </div>
          </div>
        </div>

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
    </main>
  );
}
