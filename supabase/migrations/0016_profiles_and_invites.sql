-- Player accounts become findable, and a roster slot can name one.
--
-- Two things arrive together because the invite flow needs both: an
-- identity you can hand to a teammate, and a link from a roster slot to
-- the account it refers to.
--
-- ── Why a stored player_id ────────────────────────────────────────
-- lib/playerId.ts derived an 8-digit id by hashing the auth uuid. That
-- cannot support search: the hash is one-way, so finding "who is
-- 40318827" means hashing every account in the database and comparing.
-- It is also not unique — 90,000,000 buckets collide with better than
-- even odds somewhere around eleven thousand accounts, and two players
-- sharing an id is an invite delivered to the wrong person.
--
-- So the id becomes a stored, unique, indexed column. Random rather
-- than sequential: a sequential id would let anyone holding one count
-- the platform's users and enumerate the rest.
--
-- ── Why a profiles table ──────────────────────────────────────────
-- Player-facing identity has been living in auth.users.user_metadata,
-- which cannot be joined or indexed, and which the browser holding the
-- session can write for itself. Search needs a real table.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  player_id text not null unique check (player_id ~ '^[0-9]{8}$'),
  name text,
  avatar_url text,
  club text,
  hometown text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is
  'Player-facing identity for an auth user. One row per account, created '
  'at the first authenticated moment (ensureProfileForUser in lib/profiles.ts).';
comment on column profiles.player_id is
  'The 8-digit code a player shares so a teammate can add them to a roster. '
  'Random and unique — never derived from the uuid, which was neither.';

-- The lookup behind the invite search is an exact match on this column,
-- and the unique constraint above already indexes it.

-- ── Roster slots can name an account ──────────────────────────────
-- A team registers immediately and holds its slot; the invite rides
-- alongside as a claim about who is playing, which that account
-- confirms or rejects. So invite_status never gates the registration —
-- it only decides how the name is drawn on the public page.
alter table players
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists invite_status text not null default 'none'
    check (invite_status in ('none', 'pending', 'accepted', 'declined')),
  add column if not exists invited_at timestamptz,
  add column if not exists responded_at timestamptz;

comment on column players.user_id is
  'The account this roster slot refers to, when it was filled by player-ID '
  'search. Null for a name typed by hand — most rows.';
comment on column players.invite_status is
  '''none'' when nobody was invited (a hand-typed name), ''pending'' until the '
  'named account responds, then ''accepted'' or ''declined''. The registrant''s '
  'own slot is ''accepted'' outright — they do not invite themselves.';

-- /profile asks "what am I invited to", which is this exact predicate.
create index if not exists players_user_invite_idx
  on players (user_id, invite_status)
  where user_id is not null;

-- ── Backfill ──────────────────────────────────────────────────────
-- Existing accounts get a profile now rather than on next sign-in, so
-- they are searchable immediately and the table has no partial state.
-- The loop retries on the unique constraint; with 90M ids and a handful
-- of users a collision is vanishingly unlikely, but "unlikely" is not a
-- correctness argument.
do $$
declare
  u record;
  candidate text;
  attempts int;
begin
  for u in
    select au.id, au.raw_user_meta_data as meta
    from auth.users au
    left join profiles p on p.id = au.id
    where p.id is null
  loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      candidate := lpad((floor(random() * 90000000) + 10000000)::bigint::text, 8, '0');
      begin
        insert into profiles (id, player_id, name, avatar_url, club, hometown)
        values (
          u.id,
          candidate,
          coalesce(u.meta ->> 'full_name', u.meta ->> 'name'),
          coalesce(u.meta ->> 'avatar_url', u.meta ->> 'picture'),
          u.meta ->> 'club',
          coalesce(u.meta ->> 'hometown', u.meta ->> 'location')
        );
        exit;
      exception when unique_violation then
        if attempts >= 20 then
          raise exception 'Could not allocate a unique player_id for %', u.id;
        end if;
      end;
    end loop;
  end loop;
end $$;

-- ── Access ────────────────────────────────────────────────────────
-- Search runs over the service role, so the client needs no read path
-- into other people's rows — and must not have one, or the 8-digit id
-- stops being the thing that gates a lookup. Reads and writes are
-- limited to your own row, and player_id is not in the update grant:
-- an id you can rewrite is an id someone else's invite can follow.
alter table profiles enable row level security;

drop policy if exists "Profile reads own row" on profiles;
create policy "Profile reads own row" on profiles for select
  using (id = auth.uid());

drop policy if exists "Profile updates own row" on profiles;
create policy "Profile updates own row" on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

revoke all on profiles from anon, authenticated;
grant select (id, player_id, name, avatar_url, club, hometown) on profiles to authenticated;
grant update (name, avatar_url, club, hometown) on profiles to authenticated;
