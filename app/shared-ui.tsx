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

export function AppShell({
  user,
  date,
  active,
  children
}: {
  user: SessionUser;
  date: string;
  active: "home" | "profile";
  children: ReactNode;
}) {
  return (
    <main className="shell">
      <header className="topbar app-header">
        <div className="brand">
          <h1>NutriBot Macros</h1>
          <span>
            {user.name} · {date}
          </span>
        </div>
        <nav className="app-nav" aria-label="Primary">
          <Link className={`nav-link ${active === "home" ? "active" : ""}`} href="/">
            Home
          </Link>
          <Link className={`nav-link ${active === "profile" ? "active" : ""}`} href="/profile">
            Profile
          </Link>
        </nav>
        <form action={logoutAction}>
          <button className="button secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </main>
  );
}

export function GoalsForm({
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
