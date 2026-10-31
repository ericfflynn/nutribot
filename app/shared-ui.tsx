import Link from "next/link";
import type { ReactNode } from "react";
import { loginAction, logoutAction, saveGoalsAction } from "./actions";
import type { Goals } from "@/lib/goals";
import { ChatSheet } from "./chat-sheet";
import { HealthAutoSync } from "./refresh-button";
import { getAllowedUsers, type SessionUser } from "@/lib/auth";
import { todayLocalDate } from "@/lib/dates";
import { formatClockTime } from "@/lib/habits";

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

function TrainingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 10h2V8h2v8H4v-2H2zM18 8h2v2h2v4h-2v2h-2zM7 6h3v12H7zM14 6h3v12h-3zM10 11h4v2h-4z" />
    </svg>
  );
}

function HabitsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm4.3 6.3L10.5 14l-2.8-2.8-1.4 1.4 4.2 4.2 7.2-7.1z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

const TABS = [
  { key: "home", href: "/", label: "Today", icon: <TodayIcon /> },
  { key: "training", href: "/training", label: "Training", icon: <TrainingIcon /> },
  { key: "habits", href: "/habits", label: "Habits", icon: <HabitsIcon /> },
  { key: "chat", href: "/chat", label: "Chat", icon: <ChatIcon /> }
] as const;

export type TabKey = (typeof TABS)[number]["key"];

// iOS-style shell: large title, content, and a bottom tab bar.
export function AppShell({
  user,
  date,
  active,
  title,
  headerAction,
  children
}: {
  user: SessionUser;
  date: string;
  active: TabKey;
  title: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={active === "chat" ? "app app-chat" : "app"}>
      <header className="app-titlebar">
        <div>
          <span className="app-date">{titleDateFormat.format(new Date(`${date}T00:00:00Z`))}</span>
          <h1>{title}</h1>
        </div>
        <div className="app-titlebar-actions">
          {user.name === process.env.GOOGLE_HEALTH_USER ? <HealthAutoSync /> : null}
          {headerAction}
          <form action={logoutAction}>
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="app-content">{children}</main>
      {/* The Chat tab is the thread itself; elsewhere the floating button opens it. */}
      {active === "chat" ? null : <ChatSheet date={date} today={todayLocalDate()} />}
      <nav className="tab-bar" aria-label="Primary">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            className={active === tab.key ? "active" : ""}
            href={tab.href}
            aria-current={active === tab.key ? "page" : undefined}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function GoalsForm({ goals, redirectDate }: { goals: Goals; redirectDate?: string }) {
  return (
    <details className="panel goals-disclosure">
      <summary>
        <div>
          <span className="eyebrow">Goals</span>
          <strong>Daily targets</strong>
        </div>
        <span className="goal-summary">
          {goals.calories} cal · Protein {goals.proteinPct}% · Carbs {goals.carbsPct}% · Fat {goals.fatPct}% · Water{" "}
          {goals.waterOz} oz · Caffeine {goals.caffeineLimitMg} mg, none after {formatClockTime(goals.caffeineCutoff)} · Added sugar{" "}
          {goals.addedSugarLimitG} g
        </span>
      </summary>
      <form className="goals-form" action={saveGoalsAction}>
        {redirectDate ? <input type="hidden" name="redirectDate" value={redirectDate} /> : null}
        <label>
          <span>Calories</span>
          <input name="calories" type="number" min="1" step="1" defaultValue={goals.calories} />
        </label>
        <label>
          <span>Protein %</span>
          <input name="proteinPct" type="number" min="0" step="1" defaultValue={goals.proteinPct} />
        </label>
        <label>
          <span>Carbs %</span>
          <input name="carbsPct" type="number" min="0" step="1" defaultValue={goals.carbsPct} />
        </label>
        <label>
          <span>Fat %</span>
          <input name="fatPct" type="number" min="0" step="1" defaultValue={goals.fatPct} />
        </label>
        <label>
          <span>Water oz</span>
          <input name="waterOz" type="number" min="1" step="1" defaultValue={goals.waterOz} />
        </label>
        <label>
          <span>Caffeine mg</span>
          <input name="caffeineLimitMg" type="number" min="0" step="1" defaultValue={goals.caffeineLimitMg} />
        </label>
        <label>
          <span>No caffeine after</span>
          <input name="caffeineCutoff" type="time" defaultValue={goals.caffeineCutoff} />
        </label>
        <label>
          <span>Added sugar g</span>
          <input name="addedSugarLimitG" type="number" min="0" step="1" defaultValue={goals.addedSugarLimitG} />
        </label>
        <button className="button secondary" type="submit">
          Save goals
        </button>
      </form>
    </details>
  );
}
