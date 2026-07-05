-- Split players.name into first_name / last_name so surfaces like the
-- live-score pulse card can show a surname-only label without re-parsing
-- a combined "First Last" string.

alter table players
  add column first_name text,
  add column last_name text;

update players
set
  first_name = split_part(name, ' ', 1),
  last_name = nullif(trim(substring(name from length(split_part(name, ' ', 1)) + 1)), '')
where name is not null;

alter table players
  alter column first_name set not null,
  drop column name;
