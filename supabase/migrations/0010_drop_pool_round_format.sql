-- Drop 'pool' as a round format.
--
-- rounds.format has allowed four values since 0001: 'pool', 'round-robin',
-- 'single', 'double'. Only three were ever reachable — the setup page's
-- format picker offers round robin, single elimination and double
-- elimination, and nothing else writes the column — so no round has ever
-- carried 'pool'. Verified before writing this: the table holds 'single'
-- and 'round-robin' rows and nothing else.
--
-- It was not harmless dead weight. 'pool' read as "Pool Play", but the
-- scheduler asks whether a match is pool play by comparing the format to
-- 'round-robin' exactly, so a round set up as Pool Play would have produced
-- no pool rotation, no court appetite, no pool waves, and would have been
-- placed under the knockout rest rule instead of the pool one. The right
-- word led to the wrong behaviour.
--
-- Whether a round robin is played in pools is the draw's pool count, not the
-- format. One pool is a round robin; four pools is pool play; both are
-- 'round-robin'. So there is one name for one thing again.

alter table rounds drop constraint if exists rounds_format_check;

alter table rounds add constraint rounds_format_check
  check (format in ('round-robin', 'single', 'double'));
