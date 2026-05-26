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

alter table public.macro_entries enable row level security;
alter table public.user_macro_goals enable row level security;

-- The app writes from server-side code only. Do not expose DATABASE_URL in browser code.
