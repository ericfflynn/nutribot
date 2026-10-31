# Demo data and screenshots

README screenshots should show the app without anyone's real meals, health metrics, journal entries or habits. `npm run demo:seed` creates a fictional user, **demo**, with six weeks of data shaped so the body state has a story to tell:

- **Watch data:** steps, zone minutes, sleep with stages, resting HR, HRV, breathing, SpO2, sleep temperature and VO2 max, on a slow trend. Sundays are quiet rest days.
- **A cold, 17 to 13 days ago:** the watch shows early signs the evening before (resting HR, temperature and breathing up, HRV down), then two sick days and a mild one logged as sick days with symptoms, then easing back. No workouts while sick, and soup-and-tea meals.
- **Weekend drinks** (the Alcohol habit, with orange and red bands) that show up in the next morning's resting HR, HRV, temperature and a late, short night.
- **Meals with caffeine and added sugar:** morning coffee most days, and an afternoon cold brew or evening chocolate now and then, past the 2 PM cutoff.
- **Workouts:** push, pull, pilates, legs and yoga in rotation with per-muscle intensity, a Saturday run that the watch records twice (so the dedupe shows), and a soreness mark on the hamstrings after the last leg day.
- **Journal and habits:** evening entries with mood, optional stress and tags (including the cold), four habits (one weekdays-only, one with a cutoff), and two reminders.
- **Body states:** every day built and stored at the end, as the backfill does for the owner.

Everything is generated from a fixed seed; days are relative to today, and today only has the meals eaten so far.

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

The current set (October 31, 2026) was taken at iPhone size (390×844 at 3x, light mode) with headless Chrome driven over the DevTools protocol, logged in as demo with a signed session cookie, Next.js's dev badge hidden. Before the shots, two chat turns were sent as demo ("Why was my recovery so bad a couple weeks ago, and how am I looking now?" and "Burrito bowl and a cold brew for lunch") so the chat shows a body-state answer and a meal card. The sick-day shot is Today on the first sick day (`/?date=`, 16 days ago), and the timeline shot is two days ago. Save new ones as `docs/screenshots/*.png` under the names README.md uses, and only ever as demo.

## Removing demo

After `npm run db:backup`, delete the rows whose `user_name` is `demo` from each table that has that column (`habit_logs` before `habits`, since logs reference habits).
