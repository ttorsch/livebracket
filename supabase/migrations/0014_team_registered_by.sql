-- Registrations get an owner.
--
-- A team registering through /tournament/[slug]/register has so far been
-- anonymous: the row records who is playing but not which account, if any,
-- filled the form in. That is why /profile could never show a player their
-- own events. This column is that link.
--
-- Nullable on purpose. Registration stays open to visitors without an
-- account — signing up must not be the price of entering a tournament — so
-- an unowned team is a normal row, not an incomplete one. It is set at
-- submit time when a session is present, and otherwise claimed later by
-- matching a verified email (see claimTeamsForUser in lib/auth.ts).
--
-- ON DELETE SET NULL rather than CASCADE: deleting an account must never
-- delete the team from the organizer's bracket. The event happened; only
-- the link to a login goes away.
alter table teams
  add column if not exists registered_by uuid references auth.users (id) on delete set null;

comment on column teams.registered_by is
  'The signed-in account that registered this team, if any. Null means the '
  'team was entered anonymously (or by an organizer on the team''s behalf) '
  'and has not been claimed. Never used for authorization — an organizer''s '
  'right to edit a team comes from owning the tournament, not from this.';

-- /profile lists a player's own teams, so the lookup is always
-- "registered_by = me". Partial: the anonymous rows are the majority and
-- are never selected by this path.
create index if not exists teams_registered_by_idx
  on teams (registered_by)
  where registered_by is not null;

-- The claim-by-email path resolves teams through their players' contact
-- address. Without this the claim scans every player row in the database on
-- each sign-in.
create index if not exists players_email_lower_idx
  on players (lower(email))
  where email is not null;
