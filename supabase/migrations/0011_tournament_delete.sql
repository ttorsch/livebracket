-- Deleting a draft, the one tournament state with nothing to preserve.
--
-- archived_at hides a tournament but keeps it restorable, because by the
-- time an organizer archives it something may have been public. A draft
-- has never been public and nobody has registered, so it doesn't need that
-- caution — it can just be gone. Soft-deleted anyway, not DROP'd, so a
-- stray delete is a support fix rather than a lost row.

alter table tournaments
  add column deleted_at timestamptz;

comment on column tournaments.deleted_at is
  'Set when a draft tournament is deleted. Hidden everywhere, no restore UI '
  '- only ever set on draft-phase rows, enforced by the API.';
