-- Add hometown to organizers table
alter table organizers
  add column if not exists hometown text;

grant update (hometown) on organizers to authenticated;
grant select (hometown) on organizers to anon, authenticated;
