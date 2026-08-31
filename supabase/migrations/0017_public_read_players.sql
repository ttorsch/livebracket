-- Public read access for the players table.
--
-- 0001_init.sql enabled Row-Level Security on players, but only created public
-- SELECT policies for tournaments, divisions, matches, teams, rounds, and vouchers.
-- Because getTournamentDetail() reads teams with nested players over the public/anon
-- client, players returned empty arrays without this policy, causing the bracket
-- and tournament pages to fall back to displaying the team name instead of individual players.

create policy "Public read players" on players for select using (true);
