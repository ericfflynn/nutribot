# Demo data and screenshots

README screenshots should show the app without anyone's real meals, health metrics, journal entries or habits. `npm run demo:seed` creates a fictional user, **demo**: four weeks of meals, water, sleep and recovery metrics, workouts (lifting with specific muscles, pilates, yoga, runs, and one run Fitbit "recorded twice" so the dedupe shows), habits with streaks and a weekdays-only habit, evening journal entries with mood, optional stress and tags, and two reminders. Everything is generated from a fixed seed; days are relative to today.

Decided October 12, 2026: demo lives in the main database beside the owner. Every table is scoped by `user_name`, so demo's rows never show for the owner, aren't matched to his Fitbit workouts, aren't synced (the health sync only runs for `GOOGLE_HEALTH_USER`), and get no reminders (demo has no phone subscribed). The script only deletes and writes rows whose `user_name` is `demo`, and they are in the local backups like everything else.

## Seed

```bash
npm run db:backup
npm run demo:seed -- --main
```

Re-running replaces demo's rows. `DEMO_DATABASE_URL=... npm run demo:seed` seeds a separate database instead (it applies `supabase/schema.sql` first).

## Log in as demo

`.env.local` lists `demo` in `APP_USERS` and `APP_USER_PASSWORDS`, so the local dev server accepts it. Production (Vercel) doesn't: demo is a local login only. Run `npm run dev -- -H 0.0.0.0`, open the LAN address on the iPhone, and log in as **demo**.

## Screenshots

The current set (October 12, 2026) was taken at iPhone size (390×844 at 3x, light mode) in headless Chrome, logged in as demo, after a short demo chat (dinner plus a workout, then an evening check-in) so the chat shots have draft cards. Save new ones as `docs/screenshots/*.png` under the names README.md uses, and only ever as demo.

## Removing demo

After `npm run db:backup`, delete the rows whose `user_name` is `demo` from each table that has that column (`habit_logs` before `habits`, since logs reference habits).
