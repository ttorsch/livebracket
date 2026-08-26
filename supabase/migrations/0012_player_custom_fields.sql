-- Public registration renders each division's own reg_fields schema, which the
-- organizer builds freely: beyond the core name/phone/email and the apparel
-- preset (which map to real columns), a division can ask for anything —
-- Home Town / Club, Skill Level, Nationality, or a field they wrote themselves.
--
-- Those answers get one jsonb bag keyed by the reg_field id rather than a
-- column each, because the question set is per division and changes whenever
-- the organizer edits the form. A column per question would mean a migration
-- per question.

alter table players
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column players.custom_fields is
  'Answers to the division''s non-core reg_fields, keyed by reg_field id. Core name/phone/email and the apparel preset live in their own columns.';
