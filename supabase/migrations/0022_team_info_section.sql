-- Split the registration form into Team info and Player info.
--
-- A question now belongs to one of two halves. The team half already had
-- somewhere to put its two core answers (contact_email / contact_phone);
-- this gives it room for the rest:
--
--   teams.team_name     — the optional Team name question
--   teams.custom_fields — any other question the organizer scopes to the
--                         team, keyed by reg_field id, the same shape
--                         players.custom_fields uses
--
-- team_name is its own column rather than a key in the bag because it is
-- displayed, not just recorded: teams.name stays the player-derived string
-- every query and search relies on, and the registration surfaces prefer
-- team_name when it is set.
--
-- The two core contact questions are also relabelled. They were named from
-- the player's point of view ("Player's Phone Number", "Captain Email")
-- back when their answers were copied onto every player row; they belong
-- to the entry, and the form now says so.

alter table teams
  add column team_name text,
  add column custom_fields jsonb not null default '{}'::jsonb;

update divisions d
set reg_fields = (
  select jsonb_agg(
    case
      when field ->> 'id' = 'base-phone' then jsonb_set(field, '{label}', '"Team contact no."')
      when field ->> 'id' = 'base-email' then jsonb_set(field, '{label}', '"Team email"')
      else field
    end
    order by ord
  )
  from jsonb_array_elements(d.reg_fields) with ordinality as elem(field, ord)
)
where jsonb_typeof(d.reg_fields) = 'array'
  and exists (
    select 1 from jsonb_array_elements(d.reg_fields) f
    where f ->> 'id' in ('base-phone', 'base-email')
  );
