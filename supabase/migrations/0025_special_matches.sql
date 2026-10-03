-- Special matches: an exhibition the organizer adds by hand.
--
-- ── What it is ───────────────────────────────────────────────────
-- A one-off fixture outside the competition — a showcase game, an
-- all-stars match, a final for the kids. It is played on a court, shown
-- on the public schedule and scored with a scorekeeper link like any
-- other match, and it counts for nothing: no standings, no bracket, no
-- advancement, no player record, no prize.
--
-- ── Where it lives ───────────────────────────────────────────────
-- In a round of its own, with the format 'special'. A match has to hang
-- off a round (and through it a division and a tournament) for the
-- schedule, the scorekeeper link and the public page to find it, and a
-- round is also where a match's length is kept. One round per special
-- match, because each has its own length; sequences start at 1000 so they
-- never meet the 1, 2, 3… a draw numbers its rounds with.
--
-- 'special' is neither a group nor a knockout format (lib/roundFormat), so
-- standings and the bracket pass it by on their own. lib/data keeps these
-- rounds out of a division's bracket entirely and hands them over as the
-- tournament's special matches instead.
--
-- ── Who plays ────────────────────────────────────────────────────
-- Either side can be a registered team (team_a_id / team_b_id, from any
-- division) or just a name typed for this one match (team_a_label /
-- team_b_label). A typed name creates no team: it is not in any division's
-- list, takes no seat and has no players. When a label-only side wins,
-- there is no team id to record, so winner_team_id stays null and the
-- winner is read off the score.

alter table rounds drop constraint if exists rounds_format_check;

alter table rounds add constraint rounds_format_check
  check (format in ('round-robin', 'single', 'double', 'special'));

alter table matches
  add column if not exists team_a_label text,
  add column if not exists team_b_label text;

comment on column matches.team_a_label is
  'Side A''s name when it is not a registered team — only on special '
  '(exhibition) matches. Null whenever team_a_id names the side.';
comment on column matches.team_b_label is
  'Side B''s name when it is not a registered team — only on special '
  '(exhibition) matches. Null whenever team_b_id names the side.';
