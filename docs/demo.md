# Demo data and screenshots

README screenshots should show the app without anyone's real meals, health metrics, journal entries or habits. `npm run demo:seed` fills a **local** database with a fictional user, "Demo": four weeks of meals, water, sleep and recovery metrics, workouts (lifting with specific muscles, pilates, yoga, runs, and one run Fitbit "recorded twice" so the dedupe shows), habits with streaks and a weekdays-only habit, evening journal entries with mood, optional stress and tags, and two reminders. Everything is generated from a fixed seed, so every run looks the same.

The script refuses any database that isn't on this machine, and the production `DATABASE_URL` in particular. It never touches production.

## One-time setup

The Mac has only the Postgres client tools (`libpq`). Install a local server once:

```bash
brew install postgresql@17
brew services start postgresql@17
createdb nutribot_demo
```

## Seed and run

```bash
export DEMO_DATABASE_URL=postgres://localhost/nutribot_demo
npm run demo:seed
DATABASE_URL=$DEMO_DATABASE_URL APP_USERS=Demo APP_USER_PASSWORDS=Demo:demo npm run dev
```

Log in as **Demo** / **demo**. The seed applies `supabase/schema.sql` first, so the demo database always matches the current schema. Re-running replaces Demo's rows; days are relative to today.

The chat needs `CLAUDE_CODE_OAUTH_TOKEN` and works against the demo database too, but keep chat screenshots to what you type for the fictional user.

## Screenshots

Take them on the iPhone (the app is iPhone-first; see AGENTS.md) from the Home Screen app pointed at the dev server on the LAN, and save them as `docs/screenshots/*.png` under the names README.md uses. Suggested set: Today, Today's timeline, Chat with draft cards, Training (muscles and filters), Habits (grid and Check-in), Journal history with a tag selected.
