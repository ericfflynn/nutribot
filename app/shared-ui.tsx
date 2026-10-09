import Link from "next/link";
import type { ReactNode } from "react";
import { loginAction, logoutAction, saveMacroGoalsAction } from "./actions";
import { getAllowedUsers, type SessionUser } from "@/lib/auth";

export function ProgressMetric({
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

export function Login({ error }: { error?: string }) {
  return (
    <main className="login">
      <section className="panel login-panel">
        <h1>NutriBot</h1>
        <p className="muted">Meals, activity and recovery.</p>
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

const titleDateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC"
});

function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13h4v7H4zM10 8h4v12h-4zM16 4h4v16h-4z" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" />
    </svg>
  );
}

// iOS-style shell: large title, content, and a bottom tab bar.
export function AppShell({
  date,
  active,
  title,
  children
}: {
  user: SessionUser;
  date: string;
  active: "home" | "profile";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="app-titlebar">
        <div>
          <span className="app-date">{titleDateFormat.format(new Date(`${date}T00:00:00Z`))}</span>
          <h1>{title}</h1>
        </div>
        <form action={logoutAction}>
          <button className="text-button" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main className="app-content">{children}</main>
      <nav className="tab-bar" aria-label="Primary">
        <Link
          className={active === "home" ? "active" : ""}
          href="/"
          aria-current={active === "home" ? "page" : undefined}
        >
          <TodayIcon />
          <span>Today</span>
        </Link>
        <Link
          className={active === "profile" ? "active" : ""}
          href="/profile"
          aria-current={active === "profile" ? "page" : undefined}
        >
          <LogIcon />
          <span>Log</span>
        </Link>
      </nav>
    </div>
  );
}

export function GoalsForm({
  goals,
  disabled,
  redirectDate
}: {
  goals: {
    calories: number;
    proteinPct: number;
    carbsPct: number;
    fatPct: number;
  };
  disabled: boolean;
  redirectDate?: string;
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
        {redirectDate ? <input type="hidden" name="redirectDate" value={redirectDate} /> : null}
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
