-- Live Bracket initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push` once the
-- CLI is linked to the project). Postgres is the system of record for
-- everything that must be durable, joined, or transactionally correct;
-- high-frequency live-score state lives in Redis instead (see lib/redis.ts).

create extension if not exists "pgcrypto";

create table organizers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  club text,
  created_at timestamptz not null default now()
);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  organizer_id uuid not null references organizers (id) on delete cascade,
  title text not null,
  location text not null,
  start_date date not null,
  end_date date,
  is_one_day boolean not null default false,
  phase smallint not null default 1 check (phase between 1 and 4),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table divisions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  name text not null,
  format_type_on_sand text not null check (format_type_on_sand in ('2v2', '3v3', '4v4', '6v6')),
  registration_fee numeric(10, 2) not null default 0,
  division_team_cap integer not null check (division_team_cap > 0),
  scoring_rules jsonb not null default '{}'::jsonb,
  reg_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions (id) on delete cascade,
  sequence integer not null,
  format text not null check (format in ('pool', 'round-robin', 'single', 'double')),
  name text not null,
  unique (division_id, sequence)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions (id) on delete cascade,
  name text not null,
  seed integer,
  payment_cleared boolean not null default false,
  status text not null default 'unpaid' check (status in ('confirmed', 'unpaid', 'waitlist')),
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  shirt_size text
);

create table registrations (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'cleared', 'refunded')),
  amount_paid numeric(10, 2) not null default 0,
  submitted_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds (id) on delete cascade,
  division_id uuid not null references divisions (id) on delete cascade,
  court text,
  scheduled_time timestamptz,
  team_a_id uuid references teams (id),
  team_b_id uuid references teams (id),
  score_a integer[],
  score_b integer[],
  winner_team_id uuid references teams (id),
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'done')),
  live_snapshot jsonb,
  updated_at timestamptz not null default now()
);

create table vouchers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('flat', 'percent')),
  discount_value numeric(10, 2) not null,
  max_uses integer,
  uses_count integer not null default 0,
  expires_at timestamptz,
  unique (tournament_id, code)
);

-- Enforce division capacity: a partial count check via trigger, since a
-- plain CHECK constraint can't reference other rows' aggregates.
create or replace function enforce_division_team_cap() returns trigger as $$
declare
  cap integer;
  current_count integer;
begin
  select division_team_cap into cap from divisions where id = new.division_id;
  select count(*) into current_count from teams
    where division_id = new.division_id and status <> 'waitlist';
  if current_count >= cap and new.status <> 'waitlist' then
    raise exception 'Division team cap (%) reached', cap;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_division_team_cap
  before insert on teams
  for each row execute function enforce_division_team_cap();

-- Row-Level Security: organizers manage only their own tournaments;
-- everyone (including anonymous) can read published tournament data;
-- writes to matches are done via the service role from the scorekeeper
-- flow, not directly by anon clients.
alter table organizers enable row level security;
alter table tournaments enable row level security;
alter table divisions enable row level security;
alter table rounds enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table registrations enable row level security;
alter table matches enable row level security;
alter table vouchers enable row level security;

create policy "Public read tournaments" on tournaments for select using (true);
create policy "Organizer manages own tournaments" on tournaments for all
  using (organizer_id in (select id from organizers where auth_user_id = auth.uid()));

create policy "Public read divisions" on divisions for select using (true);
create policy "Organizer manages own divisions" on divisions for all
  using (tournament_id in (
    select id from tournaments where organizer_id in (
      select id from organizers where auth_user_id = auth.uid()
    )
  ));

create policy "Public read matches" on matches for select using (true);
create policy "Public read teams" on teams for select using (true);
create policy "Public read rounds" on rounds for select using (true);
create policy "Public read vouchers" on vouchers for select using (true);

-- NOTE: only SELECT policies exist for rounds/teams/players/registrations/
-- matches/vouchers, so RLS denies all writes to them by default for now.
-- Organizer-scoped write policies (mirroring the tournaments/divisions
-- pattern above) and the service-role path for scorekeeper match writes
-- should be added in the CRUD-migration phase, once the app code that
-- exercises them exists.
