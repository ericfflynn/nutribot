create table if not exists public.macro_entries (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  entry_date date not null,
  raw_text text not null,
  calories numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  items jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0.6,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists macro_entries_user_date_idx
  on public.macro_entries (user_name, entry_date desc, created_at desc);

create table if not exists public.user_macro_goals (
  user_name text primary key,
  calories numeric not null,
  protein_pct numeric not null,
  carbs_pct numeric not null,
  fat_pct numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Daily water target, set with the other goals.
alter table public.user_macro_goals
  add column if not exists water_oz numeric not null default 100 check (water_oz > 0);

-- Water intake: one row per drink, summed per local day.
create table if not exists public.water_entries (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  entry_date date not null,
  amount_oz numeric not null check (amount_oz > 0 and amount_oz <= 64),
  created_at timestamptz not null default now()
);

create index if not exists water_entries_user_date_idx
  on public.water_entries (user_name, entry_date);

alter table public.macro_entries enable row level security;
alter table public.user_macro_goals enable row level security;
alter table public.water_entries enable row level security;

-- The app writes from server-side code only. Do not expose DATABASE_URL in browser code.

-- Google Health raw store: Fitbit daily totals, daily metrics and workouts, with
-- payloads kept as returned by the API. Each (user_name, data_type,
-- partition_month) is replaced as a whole snapshot.
create table if not exists public.health_records (
  user_name text not null,
  data_type text not null,
  partition_month text not null,
  record_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (user_name, data_type, partition_month, record_key)
);

create table if not exists public.health_sync_state (
  user_name text not null,
  data_type text not null,
  covered_until date not null,
  last_success_at timestamptz not null,
  primary key (user_name, data_type)
);

-- One row per sync run, scheduled or manual.
create table if not exists public.health_sync_runs (
  id bigint generated always as identity primary key,
  user_name text not null,
  trigger text not null check (trigger in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  records integer,
  failed_types text[] not null default '{}',
  error text
);

-- 'full' replaces whole months; 'recent' upserts the last few days.
alter table public.health_sync_runs
  add column if not exists scope text not null default 'full' check (scope in ('full', 'recent'));

alter table public.health_records enable row level security;
alter table public.health_sync_state enable row level security;
alter table public.health_sync_runs enable row level security;

-- Readable views over health_records. Views store nothing; they unpack payloads on read.
create or replace function public.health_civil_date(value jsonb) returns date
  language sql immutable as $$
  select make_date((value->>'year')::int, (value->>'month')::int, (value->>'day')::int)
$$;

-- UTC timestamp plus the recorded UTC offset ("-14400s"), as local wall-clock time.
create or replace function public.health_local_time(utc text, utc_offset text) returns timestamp
  language sql immutable as $$
  select (utc::timestamptz at time zone 'UTC') + make_interval(secs => rtrim(utc_offset, 's')::int)
$$;

create or replace view public.health_daily with (security_invoker = true) as
with
  totals as (
    select
      user_name,
      public.health_civil_date(payload->'civilStartTime'->'date') as day,
      max((payload->'steps'->>'countSum')::int) filter (where data_type = 'daily-steps') as steps,
      max((payload->'distance'->>'millimetersSum')::numeric) filter (where data_type = 'daily-distance') as distance_mm,
      max((payload->'activeEnergyBurned'->>'kcalSum')::numeric) filter (where data_type = 'daily-active-energy') as active_kcal,
      max((payload->'totalCalories'->>'kcalSum')::numeric) filter (where data_type = 'daily-total-calories') as total_kcal,
      max((payload->'activeZoneMinutes'->>'sumInFatBurnHeartZone')::int) filter (where data_type = 'daily-active-zone-minutes') as zone_minutes_fat_burn,
      max((payload->'activeZoneMinutes'->>'sumInCardioHeartZone')::int) filter (where data_type = 'daily-active-zone-minutes') as zone_minutes_cardio,
      max((payload->'activeZoneMinutes'->>'sumInPeakHeartZone')::int) filter (where data_type = 'daily-active-zone-minutes') as zone_minutes_peak
    from public.health_records
    where data_type in ('daily-steps', 'daily-distance', 'daily-active-energy', 'daily-total-calories', 'daily-active-zone-minutes')
    group by 1, 2
  ),
  active_minutes as (
    select
      r.user_name,
      public.health_civil_date(r.payload->'civilStartTime'->'date') as day,
      sum((level->>'activeMinutesSum')::int) filter (where level->>'activityLevel' = 'LIGHT') as active_minutes_light,
      sum((level->>'activeMinutesSum')::int) filter (where level->>'activityLevel' = 'MODERATE') as active_minutes_moderate,
      sum((level->>'activeMinutesSum')::int) filter (where level->>'activityLevel' = 'VIGOROUS') as active_minutes_vigorous
    from public.health_records r,
      jsonb_array_elements(r.payload->'activeMinutes'->'activeMinutesRollupByActivityLevel') level
    where r.data_type = 'daily-active-minutes'
    group by 1, 2
  ),
  metrics as (
    select
      user_name,
      public.health_civil_date(coalesce(
        payload->'dailyRestingHeartRate'->'date',
        payload->'dailyHeartRateVariability'->'date',
        payload->'dailyOxygenSaturation'->'date',
        payload->'dailyRespiratoryRate'->'date',
        payload->'dailyVo2Max'->'date',
        payload->'dailySleepTemperatureDerivations'->'date'
      )) as day,
      max((payload->'dailyRestingHeartRate'->>'beatsPerMinute')::int) as resting_hr,
      max((payload->'dailyHeartRateVariability'->>'averageHeartRateVariabilityMilliseconds')::numeric) as hrv_ms,
      max((payload->'dailyOxygenSaturation'->>'averagePercentage')::numeric) as spo2_pct,
      max((payload->'dailyRespiratoryRate'->>'breathsPerMinute')::numeric) as breaths_per_min,
      max((payload->'dailyVo2Max'->>'vo2Max')::numeric) as vo2_max,
      max((payload->'dailySleepTemperatureDerivations'->>'nightlyTemperatureCelsius')::numeric
        - (payload->'dailySleepTemperatureDerivations'->>'baselineTemperatureCelsius')::numeric) as sleep_temp_vs_baseline_c
    from public.health_records
    where data_type in ('daily-resting-heart-rate', 'daily-heart-rate-variability', 'daily-oxygen-saturation',
      'daily-respiratory-rate', 'daily-vo2-max', 'daily-sleep-temperature-derivations')
    group by 1, 2
  ),
  -- Main sleep per night, dated by the local wake-up day.
  sleep as (
    select distinct on (user_name, day)
      user_name,
      day,
      bedtime,
      wake_time,
      (summary->>'minutesAsleep')::int as sleep_minutes,
      (summary->>'minutesAwake')::int as awake_minutes,
      (select (s->>'minutes')::int from jsonb_array_elements(summary->'stagesSummary') s where s->>'type' = 'DEEP') as deep_minutes,
      (select (s->>'minutes')::int from jsonb_array_elements(summary->'stagesSummary') s where s->>'type' = 'REM') as rem_minutes,
      (select (s->>'minutes')::int from jsonb_array_elements(summary->'stagesSummary') s where s->>'type' = 'LIGHT') as light_minutes
    from (
      select
        user_name,
        payload->'sleep'->'summary' as summary,
        public.health_local_time(payload->'sleep'->'interval'->>'startTime', payload->'sleep'->'interval'->>'startUtcOffset') as bedtime,
        public.health_local_time(payload->'sleep'->'interval'->>'endTime', payload->'sleep'->'interval'->>'endUtcOffset') as wake_time,
        public.health_local_time(payload->'sleep'->'interval'->>'endTime', payload->'sleep'->'interval'->>'endUtcOffset')::date as day,
        coalesce((payload->'sleep'->'metadata'->>'mainSleep')::boolean, false) as main_sleep
      from public.health_records
      where data_type = 'sleep'
    ) nights
    order by user_name, day, main_sleep desc, sleep_minutes desc nulls last
  ),
  days as (
    select user_name, day from totals
    union select user_name, day from active_minutes
    union select user_name, day from metrics
    union select user_name, day from sleep
  )
select
  d.user_name,
  d.day,
  t.steps,
  round(t.distance_mm / 1609344, 2) as distance_miles,
  round(t.active_kcal) as active_kcal,
  round(t.total_kcal) as total_kcal,
  a.active_minutes_light,
  a.active_minutes_moderate,
  a.active_minutes_vigorous,
  t.zone_minutes_fat_burn,
  t.zone_minutes_cardio,
  t.zone_minutes_peak,
  m.resting_hr,
  m.hrv_ms,
  s.bedtime,
  s.wake_time,
  s.sleep_minutes,
  s.deep_minutes,
  s.rem_minutes,
  s.light_minutes,
  s.awake_minutes,
  m.spo2_pct,
  m.breaths_per_min,
  round(m.vo2_max, 1) as vo2_max,
  round(m.sleep_temp_vs_baseline_c, 2) as sleep_temp_vs_baseline_c
from days d
left join totals t using (user_name, day)
left join active_minutes a using (user_name, day)
left join metrics m using (user_name, day)
left join sleep s using (user_name, day);

-- One row per Fitbit exercise record, duplicates included. Read
-- health_workouts instead, which folds duplicates (lib/health/dedupe.ts).
create or replace view public.health_workout_records with (security_invoker = true) as
select
  user_name,
  record_key as id,
  public.health_local_time(e->'interval'->>'startTime', e->'interval'->>'startUtcOffset')::date as day,
  public.health_local_time(e->'interval'->>'startTime', e->'interval'->>'startUtcOffset') as started_at,
  public.health_local_time(e->'interval'->>'endTime', e->'interval'->>'endUtcOffset') as ended_at,
  e->>'exerciseType' as type,
  e->>'displayName' as name,
  round(rtrim(e->>'activeDuration', 's')::numeric / 60) as active_minutes,
  round(extract(epoch from (e->'interval'->>'endTime')::timestamptz - (e->'interval'->>'startTime')::timestamptz) / 60) as elapsed_minutes,
  round((e->'metricsSummary'->>'caloriesKcal')::numeric) as calories,
  (e->'metricsSummary'->>'averageHeartRateBeatsPerMinute')::int as avg_hr,
  round((e->'metricsSummary'->>'distanceMillimeters')::numeric / 1609344, 2) as distance_miles,
  (e->'metricsSummary'->>'steps')::int as steps,
  (e->'metricsSummary'->>'activeZoneMinutes')::int as active_zone_minutes,
  round(rtrim(e->'metricsSummary'->'heartRateZoneDurations'->>'lightTime', 's')::numeric / 60) as hr_light_minutes,
  round(rtrim(e->'metricsSummary'->'heartRateZoneDurations'->>'moderateTime', 's')::numeric / 60) as hr_moderate_minutes,
  round(rtrim(e->'metricsSummary'->'heartRateZoneDurations'->>'vigorousTime', 's')::numeric / 60) as hr_vigorous_minutes,
  round(rtrim(e->'metricsSummary'->'heartRateZoneDurations'->>'peakTime', 's')::numeric / 60) as hr_peak_minutes,
  coalesce((e->'exerciseMetadata'->>'hasGps')::boolean, false) as has_gps
from public.health_records r,
  lateral (select r.payload->'exercise' as e) exercise
where data_type = 'exercise';

-- Duplicate Fitbit recordings of one workout (docs/workout-dedupe.md). A row
-- folds record_key into canonical_key; a row whose two keys match pins a
-- record on its own. 'auto' rows are rebuilt after every exercise sync from
-- lib/health/dedupe-rules.ts; 'user' rows are the owner's merges and splits
-- and are never overwritten.
create table if not exists public.health_workout_merges (
  user_name text not null,
  record_key text not null,
  canonical_key text not null,
  decided_by text not null check (decided_by in ('auto', 'user')),
  created_at timestamptz not null default now(),
  primary key (user_name, record_key)
);

alter table public.health_workout_merges enable row level security;

-- One row per physical workout: canonical records only. Each metric is the
-- canonical record's, or the largest from its duplicates when the canonical
-- lacks it; metrics are never summed. merged_ids lists the folded records.
create or replace view public.health_workouts with (security_invoker = true) as
with folded as (
  select m.user_name, m.record_key, m.canonical_key
  from public.health_workout_merges m
  where m.record_key <> m.canonical_key
    and exists (
      select 1 from public.health_workout_records c
      where c.user_name = m.user_name and c.id = m.canonical_key
    )
)
select
  c.user_name,
  c.id,
  c.day,
  c.started_at,
  c.ended_at,
  c.type,
  c.name,
  coalesce(c.active_minutes, d.active_minutes) as active_minutes,
  c.elapsed_minutes,
  coalesce(c.calories, d.calories) as calories,
  coalesce(c.avg_hr, d.avg_hr) as avg_hr,
  coalesce(c.distance_miles, d.distance_miles) as distance_miles,
  coalesce(c.steps, d.steps) as steps,
  coalesce(c.active_zone_minutes, d.active_zone_minutes) as active_zone_minutes,
  coalesce(c.hr_light_minutes, d.hr_light_minutes) as hr_light_minutes,
  coalesce(c.hr_moderate_minutes, d.hr_moderate_minutes) as hr_moderate_minutes,
  coalesce(c.hr_vigorous_minutes, d.hr_vigorous_minutes) as hr_vigorous_minutes,
  coalesce(c.hr_peak_minutes, d.hr_peak_minutes) as hr_peak_minutes,
  c.has_gps or coalesce(d.has_gps, false) as has_gps,
  coalesce(d.ids, '{}') as merged_ids
from public.health_workout_records c
left join lateral (
  select
    max(r.active_minutes) as active_minutes,
    max(r.calories) as calories,
    max(r.avg_hr) as avg_hr,
    max(r.distance_miles) as distance_miles,
    max(r.steps) as steps,
    max(r.active_zone_minutes) as active_zone_minutes,
    max(r.hr_light_minutes) as hr_light_minutes,
    max(r.hr_moderate_minutes) as hr_moderate_minutes,
    max(r.hr_vigorous_minutes) as hr_vigorous_minutes,
    max(r.hr_peak_minutes) as hr_peak_minutes,
    bool_or(r.has_gps) as has_gps,
    array_agg(r.id order by r.started_at) as ids
  from folded f
  join public.health_workout_records r on r.user_name = f.user_name and r.id = f.record_key
  where f.user_name = c.user_name and f.canonical_key = c.id
) d on true
where not exists (
  select 1 from folded f where f.user_name = c.user_name and f.record_key = c.id
);

-- Chat brain (docs/brain.md). Meals the chat logs can carry a meal type.
alter table public.macro_entries
  add column if not exists meal_type text;
alter table public.macro_entries
  drop constraint if exists macro_entries_meal_type_check;
alter table public.macro_entries
  add constraint macro_entries_meal_type_check
  check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'dessert'));

-- Local wall-clock time the meal was eaten, when it differs from when it was
-- logged. Null means "when it was logged" (created_at).
alter table public.macro_entries
  add column if not exists eaten_at time;

-- One row per logged workout: what was trained and how hard. Linked to the
-- matching Fitbit workout (health_workouts.id) when there is one; 'pending'
-- sessions are linked after a later sync, 'untracked' ones never are.
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  entry_date date not null,
  name text not null,
  workout_type text not null
    check (workout_type in ('strength', 'run', 'walk', 'ride', 'sport', 'class', 'other')),
  -- widened below to add pilates and yoga
  muscle_groups text[] not null default '{}',
  rpe numeric check (rpe between 1 and 10),
  duration_min integer check (duration_min > 0),
  match_status text not null default 'pending' check (match_status in ('linked', 'pending', 'untracked')),
  health_record_key text,
  linked_by text check (linked_by in ('auto', 'user')),
  -- Local wall-clock window from "this morning", "after work"; used when matching.
  time_hint_start time,
  time_hint_end time,
  raw_text text not null,
  notes text,
  created_at timestamptz not null default now(),
  check ((match_status = 'linked') = (health_record_key is not null))
);

-- Pilates and yoga are their own types (they used to be 'class').
alter table public.workout_sessions
  drop constraint if exists workout_sessions_workout_type_check;
alter table public.workout_sessions
  add constraint workout_sessions_workout_type_check
  check (workout_type in ('strength', 'run', 'walk', 'ride', 'sport', 'class', 'pilates', 'yoga', 'other'));

-- Per-muscle intensity: {"Chest": "light", "Triceps": "hard"}. Keys are names
-- from muscle_groups; a muscle without one takes its intensity from rpe.
alter table public.workout_sessions
  add column if not exists muscle_intensity jsonb not null default '{}'::jsonb;

create index if not exists workout_sessions_user_date_idx
  on public.workout_sessions (user_name, entry_date desc);

-- One Fitbit workout belongs to at most one session.
create unique index if not exists workout_sessions_health_record_idx
  on public.workout_sessions (user_name, health_record_key) where health_record_key is not null;

-- Watch workouts the owner chose to ignore (an accidental 1-minute recording):
-- left out of matching, Unlabeled, Recent workouts and the Today timeline.
-- Day strain still counts them.
create table if not exists public.workout_ignores (
  user_name text not null,
  health_record_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_name, health_record_key)
);

alter table public.workout_ignores enable row level security;

-- Soreness and pain, one row per report (docs/training-plan.md#fatigue).
-- Soreness uses the Training muscle names and feeds each muscle's fatigue;
-- pain uses plain body parts (wrist, lower back) and is for looking back.
create table if not exists public.body_log (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  entry_date date not null,
  body_part text not null,
  kind text not null check (kind in ('sore', 'pain')),
  severity text not null check (severity in ('mild', 'bad')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists body_log_user_date on public.body_log (user_name, entry_date desc);

alter table public.body_log enable row level security;

-- The chat thread: one continuous thread per user. Assistant rows carry the
-- drafts shown with that reply, and whether each was saved.
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_name text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  drafts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_name, created_at desc);

alter table public.workout_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Chat conversations: "New chat" starts one. Claude sees only the current
-- conversation's messages. Messages from before conversations existed have
-- no conversation_id and aren't shown.
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_created_idx
  on public.chat_conversations (user_name, created_at desc);

alter table public.chat_messages
  add column if not exists conversation_id uuid references public.chat_conversations (id) on delete cascade;

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, id);

alter table public.chat_conversations enable row level security;

-- Journal, habits and reminders (docs/journal-habits-plan.md).
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  entry_date date not null,
  kind text not null check (kind in ('morning', 'evening', 'other')),
  body text not null,
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  stress smallint check (stress between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists journal_entries_user_date_idx
  on public.journal_entries (user_name, entry_date);

-- Tracked habits are rows, so new ones are added through chat.
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  name text not null,
  measure text not null check (measure in ('intensity', 'count', 'minutes')),
  unit text,
  direction text not null check (direction in ('limit', 'build')),
  scale_guide text,
  cutoff time,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_name, name)
);

-- A habit's daily target: the most that's OK for limit habits (0 = none), the
-- least for build habits. A cutoff can apply on weeknights (Sun-Thu) only.
alter table public.habits
  add column if not exists goal numeric check (goal >= 0);
alter table public.habits
  add column if not exists cutoff_weeknights boolean not null default false;

-- One row per use; amount 0 records "didn't today".
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  habit_id uuid not null references public.habits (id),
  entry_date date not null,
  amount numeric not null check (amount >= 0),
  details text,
  started_at time,
  ended_at time,
  created_at timestamptz not null default now()
);

create index if not exists habit_logs_user_date_idx
  on public.habit_logs (user_name, entry_date);

-- Web push: one row per device that turned reminders on.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_name text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- One row per reminder sent, so a day never gets two.
create table if not exists public.reminder_sends (
  user_name text not null,
  local_date date not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (user_name, local_date, kind)
);

-- Habit description (what counts) and frequency: the weekdays it's tracked,
-- 0 Sunday-6 Saturday; null means every day.
alter table public.habits
  add column if not exists description text;
alter table public.habits
  add column if not exists days smallint[];

-- Reminders the owner edits (lib/reminder-rules.ts). Each fires at most once a
-- day in its local hour, plus once after a snooze; reminder_sends.kind holds
-- the reminder id. 'habit' reminders belong to one habit.
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  kind text not null check (kind in ('checkin', 'journal', 'habits', 'habit', 'custom')),
  habit_id uuid references public.habits (id) on delete cascade,
  hour smallint not null check (hour between 0 and 23),
  days smallint[],
  message text,
  enabled boolean not null default true,
  snoozed_until timestamptz,
  skip_date date,
  created_at timestamptz not null default now(),
  check ((kind = 'habit') = (habit_id is not null)),
  check (kind <> 'custom' or message is not null)
);

create index if not exists reminders_user_idx on public.reminders (user_name);

-- One reminder per habit, set from the habit editor.
create unique index if not exists reminders_habit_idx
  on public.reminders (user_name, habit_id) where kind = 'habit';

alter table public.reminders enable row level security;

alter table public.journal_entries enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_sends enable row level security;

-- App feedback queued from chat for the next dev pass (lib/feedback.ts).
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  kind text not null check (kind in ('bug', 'idea', 'change')),
  area text not null,
  title text not null,
  details text not null,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at);

alter table public.app_feedback enable row level security;
