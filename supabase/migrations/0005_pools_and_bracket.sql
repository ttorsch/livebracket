-- Schema recommendation for the Draw Pool / Generate Bracket feature.
-- Not wired into any route yet — review before running `supabase db push`.
--
-- Today, pool groupings only exist implicitly (matches share a round_id and
-- teams share a "seed" derived pool position). This adds first-class pools,
-- per-pool standings, and a relational trail from a bracket match slot back
-- to the pool result that filled it — so the bracket can show "Winner Pool
-- A" placeholders before pool play finishes, and Generate Bracket can read
-- real standings instead of re-deriving them from seed order.

create table pools (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions (id) on delete cascade,
  round_id uuid not null references rounds (id) on delete cascade, -- the pool-play round
  name text not null,        -- 'A', 'B', 'C', ...
  sequence integer not null, -- 0-based draw order; source of `name`
  created_at timestamptz not null default now(),
  unique (round_id, sequence),
  unique (round_id, name)
);

-- Pool membership + running standings. One row per team per pool.
create table pool_teams (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  is_top_seed boolean not null default false, -- snapshot of the seed-jar assignment at draw time
  wins integer not null default 0,
  losses integer not null default 0,
  points_for integer not null default 0,
  points_against integer not null default 0,
  rank integer, -- final standing within the pool (1 = winner); null until pool play finishes
  unique (pool_id, team_id),
  unique (team_id) -- a team sits in exactly one pool per draw
);

-- Pool matches need to know which pool they belong to (knockout matches
-- leave this null).
alter table matches add column pool_id uuid references pools (id) on delete cascade;

-- Traces each knockout match slot back to the pool result that fills it, so
-- "Generate Bracket" is a relational read rather than a recomputation, and
-- the UI can render a placeholder ("Winner Pool A") before that pool locks.
create table bracket_slots (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds (id) on delete cascade, -- knockout round
  match_id uuid not null references matches (id) on delete cascade, -- match this slot feeds
  side text not null check (side in ('a', 'b')),
  source_pool_id uuid references pools (id) on delete set null,
  source_rank integer, -- e.g. 1 = pool winner feeds this slot
  team_id uuid references teams (id), -- resolved once the pool locks (or a prior match completes)
  unique (match_id, side)
);

alter table pools enable row level security;
alter table pool_teams enable row level security;
alter table bracket_slots enable row level security;

create policy "Public read pools" on pools for select using (true);
create policy "Public read pool_teams" on pool_teams for select using (true);
create policy "Public read bracket_slots" on bracket_slots for select using (true);

create policy "Organizer manages own pools" on pools for all
  using (division_id in (
    select id from divisions where tournament_id in (
      select id from tournaments where organizer_id in (
        select id from organizers where auth_user_id = auth.uid()
      )
    )
  ));

create policy "Organizer manages own pool_teams" on pool_teams for all
  using (pool_id in (
    select id from pools where division_id in (
      select id from divisions where tournament_id in (
        select id from tournaments where organizer_id in (
          select id from organizers where auth_user_id = auth.uid()
        )
      )
    )
  ));

create policy "Organizer manages own bracket_slots" on bracket_slots for all
  using (round_id in (
    select id from rounds where division_id in (
      select id from divisions where tournament_id in (
        select id from tournaments where organizer_id in (
          select id from organizers where auth_user_id = auth.uid()
        )
      )
    )
  ));
