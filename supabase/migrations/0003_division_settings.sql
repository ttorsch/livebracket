-- Divisions carry several organizer-facing setup fields (max roster size,
-- staggered registration open date, rules text, gender eligibility, prize
-- pool, net height, min teams, waitlist cap, post-registration confirmation
-- message/photo) that don't warrant their own columns. Store them as a
-- single settings blob instead of adding a dozen narrow columns.

alter table divisions
  add column settings jsonb not null default '{}'::jsonb;
