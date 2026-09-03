-- Remove pinned matches column.
--
-- Schedule generation always solves all matches from scratch; manual edits are
-- draft-only adjustments in the editor rather than hard server-side pins.

alter table matches
  drop column if exists pinned;
