-- Real authentication: the organizers table becomes the answer to "is this
-- person an organizer", replacing a role string in auth.users.user_metadata
-- that the browser holding the session could write for itself.
--
-- It makes the auth-user link one-to-one, opens the narrow read and write
-- paths the app actually needs on this table (and narrows the column grants
-- that were sitting wide open behind RLS), and settles a piece of schema
-- drift the app had already started depending on.

-- One auth user owns at most one organizer account. Without this, two
-- concurrent sign-ins could each insert a row and the app would then read
-- whichever came back first — a coin flip over which account you land in.
create unique index if not exists organizers_auth_user_id_key
  on organizers (auth_user_id)
  where auth_user_id is not null;

-- lib/auth.ts resolves an organizer from the session id on essentially
-- every authenticated request; the unique index above already serves that
-- lookup, so no second index is warranted.

-- Drift: the dashboard header and /api/organizer have been selecting
-- avatar_url since before it existed in any migration. It was presumably
-- added by hand in the Studio; declare it so a fresh database matches the
-- one the app was written against.
alter table organizers
  add column if not exists avatar_url text;

comment on column organizers.auth_user_id is
  'The Supabase auth user who owns this organizer account. Presence of a '
  'row with this set is what makes someone an organizer — user_metadata.role '
  'is only the intent captured at sign-up, and is client-writable.';

-- Organizers may edit their own row. Inserts stay closed: the row is
-- created by the service role in ensureOrganizerForUser, so "who is an
-- organizer" is never something a client asserts directly.
drop policy if exists "Organizer updates own row" on organizers;
create policy "Organizer updates own row" on organizers for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- That policy is the first thing to open any write path on this table, so
-- the column grant has to be narrowed in the same breath. anon and
-- authenticated hold a table-wide UPDATE grant here that only RLS was
-- holding back; left as it is, the policy above would let an organizer
-- rewrite their own id (orphaning their tournaments), their email, or their
-- auth_user_id. Editable identity is the three display fields, nothing more.
revoke update on organizers from anon, authenticated;
grant update (name, club, avatar_url) on organizers to authenticated;

-- Reads are a different problem. The homepage labels every event with the
-- organizer running it, which means an anonymous visitor has to be able to
-- resolve organizers(name) through the tournaments join. RLS is row-level
-- only, so an "own row" select policy would blank that label for everyone
-- not signed in.
--
-- So: rows are readable, columns are not. The policy opens every row, and
-- the grant narrows what can be selected from it to the three fields that
-- are already public on the event page. email and auth_user_id are left out
-- of the grant, so `select *` as anon fails rather than leaking them —
-- lib/auth.ts and /api/organizer read those over the service role, which is
-- unaffected.
drop policy if exists "Organizer reads own row" on organizers;
drop policy if exists "Public read organizer identity" on organizers;
create policy "Public read organizer identity" on organizers for select
  using (true);

revoke select on organizers from anon, authenticated;
grant select (id, name, club, avatar_url) on organizers to anon, authenticated;
