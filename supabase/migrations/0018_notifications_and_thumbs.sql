-- Notifications between players, and the thumb-up that produces one.
--
-- ── Why a notifications table at all ─────────────────────────────
-- The two things a player needs telling about already exist as rows
-- somewhere: an invitation is a `players` row claiming to be you
-- (0016), and a thumb-up is the row added below. Neither is something a
-- player would find by looking — /api/me/invites has never had a screen,
-- and a thumb-up has nowhere of its own to live at all.
--
-- So this table is the *addressed* copy: one row per thing one account
-- should be told about another. It duplicates a little (the team's name
-- travels in the payload) on purpose — a notification should still read
-- correctly after the thing it describes has moved on, and rendering a
-- list should not mean joining four tables per row.
--
-- ── Why RLS here, when the app reads through the service role ────
-- Because this is the first table the *browser* subscribes to. The live
-- badge is a Realtime subscription filtered to `recipient_id`, and a
-- filter is not a permission — without the policy below, anyone holding
-- the anon key could subscribe to everyone's. Reads are therefore
-- policy-bound to your own rows; writes have no policy at all, so only
-- the service role (route handlers) can create a notification. Nobody
-- can notify themselves into someone else's list.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  -- Who is being told.
  recipient_id uuid not null references auth.users (id) on delete cascade,
  -- Who caused it. Null when the account is gone: the notification stays
  -- readable ("someone added you to a team") rather than vanishing.
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('thumb_up', 'team_invite', 'invite_accepted', 'invite_declined')),
  -- Enough to draw the row without joining: team name, tournament title
  -- and slug, division. Shape depends on kind — see lib/notifications.ts.
  payload jsonb not null default '{}'::jsonb,
  -- The invitation this notification is about, so Accept and Decline can
  -- be answered from the list itself. Null for every other kind.
  player_row_id uuid references players (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table notifications is
  'One row per thing an account should be told about. Written only by route '
  'handlers through the service role; read by the recipient alone.';

-- The list is always "mine, newest first", which is this index exactly.
create index if not exists notifications_recipient_created_idx
  on notifications (recipient_id, created_at desc);

-- The unread badge counts against this one.
create index if not exists notifications_unread_idx
  on notifications (recipient_id)
  where read_at is null;

alter table notifications enable row level security;

-- Read your own, and nothing else. This is what makes the Realtime
-- subscription safe to open from the browser.
create policy "Read own notifications" on notifications
  for select using (recipient_id = auth.uid());

-- Deliberately no insert/update/delete policy: creating a notification is
-- the server's job, and marking one read goes through /api/me/notifications
-- so the same session check covers both.

-- Realtime publishes inserts on this table to subscribers whose policy
-- lets them see the row. Wrapped because re-adding a table already in the
-- publication is an error, and a migration should survive a second run.
do $$
begin
  alter publication supabase_realtime add table notifications;
exception
  when duplicate_object then null;
end
$$;


-- ── The thumb-up ─────────────────────────────────────────────────
-- One per person per player, so the count is a number of *people* and a
-- second click takes yours back rather than adding another. The unique
-- constraint is what makes that true; without it, "liked" would be a
-- question the client had to be trusted to answer.

create table if not exists player_thumbs (
  id uuid primary key default gen_random_uuid(),
  -- The player being recognised.
  target_id uuid not null references auth.users (id) on delete cascade,
  -- The account doing it. Signing in is required precisely so this exists.
  actor_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (target_id, actor_id),
  -- Nobody thumbs themselves.
  constraint player_thumbs_not_self check (target_id <> actor_id)
);

comment on table player_thumbs is
  'One thumb-up per account per player. The count on a player card is the '
  'number of rows here with that target.';

create index if not exists player_thumbs_target_idx on player_thumbs (target_id);

alter table player_thumbs enable row level security;

-- The count is on the public player card, so the rows behind it are
-- readable. Writing goes through /api/players/[userId]/thumb, which is
-- where the "is it you" and "are you signed in" checks live.
create policy "Public read thumbs" on player_thumbs for select using (true);
