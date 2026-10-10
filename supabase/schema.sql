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

create or replace view public.health_workouts with (security_invoker = true) as
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

-- Chat brain (docs/brain.md). Meals the chat logs can carry a meal type.
alter table public.macro_entries
  add column if not exists meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'));

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

create index if not exists workout_sessions_user_date_idx
  on public.workout_sessions (user_name, entry_date desc);

-- One Fitbit workout belongs to at most one session.
create unique index if not exists workout_sessions_health_record_idx
  on public.workout_sessions (user_name, health_record_key) where health_record_key is not null;

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
