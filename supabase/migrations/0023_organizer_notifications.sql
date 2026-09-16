-- Telling the organizer about their own event.
--
-- ── Why the same table ───────────────────────────────────────────
-- 0018 built notifications for one kind of reader: a player being told
-- about another player. An organizer needs the same machinery — an
-- addressed row, read by them alone, arriving live — for a different
-- subject: what is happening to the events they run.
--
-- Nothing about the table changes to accommodate that. The recipient is
-- still an auth user, the RLS policy still says "your own rows and
-- nothing else", and Realtime still publishes inserts to whoever the
-- policy lets see them. Only the vocabulary widens.
--
-- ── Why the split is a kind and not a column ─────────────────────
-- An organizer is also a player. The same account can be thumbed up on
-- Tuesday and take four registrations on Wednesday, and those belong on
-- two different screens: the profile is about the person, the dashboard
-- is about the event. An `audience` column would be a second thing to
-- keep true about a row that its `kind` already determines — a
-- team_registered is *always* organizer-facing. So the audience is
-- derived from the kind in lib/notifications.ts, and the two lists are
-- the same query with a different `kind in (...)`.
--
-- The existing (recipient_id, created_at desc) index still serves both:
-- the kind filter lands on the handful of rows that index already
-- narrowed to, so neither list needs an index of its own.

alter table notifications drop constraint if exists notifications_kind_check;

alter table notifications add constraint notifications_kind_check
  check (kind in (
    -- Player to player (0018).
    'thumb_up',
    'team_invite',
    'invite_accepted',
    'invite_declined',
    -- To the organizer, about their tournament.
    --   team_registered — a team entered a division.
    --   team_updated    — the people on a team changed their own entry.
    --                     Organizer edits never raise one: an organizer
    --                     does not need telling what they just did.
    'team_registered',
    'team_updated'
  ));

comment on column notifications.kind is
  'What happened. The kind also decides who the row is for: the invite and '
  'thumb kinds are personal (the profile), team_registered and team_updated '
  'are organizer-facing (the dashboard). See NOTIFICATION_AUDIENCE in '
  'lib/notifications.ts.';
