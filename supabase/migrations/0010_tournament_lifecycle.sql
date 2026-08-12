-- Retiring a tournament, in the two ways an organizer actually needs.
--
-- `phase` says where an event is in its lifecycle (draft → announced →
-- open → closed). It deliberately does not also carry "this one is over
-- and I don't want to see it" or "this one is off", because those are a
-- different axis: a cancelled tournament is still a phase-3 tournament
-- that had registrations, and squashing that into a fifth phase value
-- would destroy the state it was cancelled *from*.
--
-- So two nullable timestamps instead. Null means "not archived" / "not
-- cancelled"; a value is both the flag and the record of when.

alter table tournaments
  add column archived_at timestamptz,
  add column cancelled_at timestamptz;

comment on column tournaments.archived_at is
  'Set when a draft or announced tournament is archived. Hidden from the '
  'dashboard and the public site; the row is kept so it can be restored.';

comment on column tournaments.cancelled_at is
  'Set when an open or closed tournament is called off. Stays visible and '
  'badged CANCELLED — players who registered need to find that out, not a 404.';

-- The dashboard and the public listings both filter on "not archived", and
-- that runs on every page load. A partial index keeps the common read
-- cheap without indexing the archived rows nobody lists.
create index tournaments_active_idx
  on tournaments (start_date)
  where archived_at is null;
