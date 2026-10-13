# Demo data and screenshots

README screenshots should show the app without anyone's real meals, health metrics, journal entries or habits. `npm run demo:seed` creates a fictional user, **Demo**: four weeks of meals, water, sleep and recovery metrics, workouts (lifting with specific muscles, pilates, yoga, runs, and one run Fitbit "recorded twice" so the dedupe shows), habits with streaks and a weekdays-only habit, evening journal entries with mood, optional stress and tags, and two reminders. Everything is generated from a fixed seed; days are relative to today.

Decided October 12, 2026: Demo lives in the main database beside the owner. Every table is scoped by `user_name`, so Demo's rows never show for the owner, aren't matched to his Fitbit workouts, aren't synced (the health sync only runs for `GOOGLE_HEALTH_USER`), and get no reminders (Demo has no phone subscribed). The script only deletes and writes rows whose `user_name` is Demo, and they are in the local backups like everything else.

## Seed

```bash
npm run db:backup
npm run demo:seed -- --main
```

Re-running replaces Demo's rows. `DEMO_DATABASE_URL=... npm run demo:seed` seeds a separate database instead (it applies `supabase/schema.sql` first).

## Log in as Demo

Demo isn't a production login. Run the dev server with Demo added for this session only, which leaves Vercel's settings alone:

```bash
APP_USERS="Eric,Demo" APP_USER_PASSWORDS="Eric:<your password>,Demo:demo" npm run dev -- -H 0.0.0.0
```

Then open the LAN address on the iPhone and log in as **Demo** / **demo**.

## Screenshots

Take them on the iPhone (the app is iPhone-first) and save them as `docs/screenshots/*.png` under the names README.md uses. Suggested set: Today, Today's timeline, Chat with draft cards, Training (Next up, Activity, coverage), Habits (grid and Check-in), Journal history with a tag selected. Keep chat screenshots to what you type for the fictional user.

## Removing Demo

After `npm run db:backup`, delete the rows whose `user_name` is `Demo` from each table that has that column (`habit_logs` before `habits`, since logs reference habits).
