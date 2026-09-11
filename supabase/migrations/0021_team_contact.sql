-- Move the registration contact from the player to the team.
--
-- A team answers one email and one phone. The form has always asked once —
-- RosterFields renders a single "Team contact" block — but the API copied
-- that pair onto every player row, storing one fact N times. The copies
-- then drifted: a roster of six could carry two spellings of the same
-- address with no way to say which was the team's.
--
-- Contact now lives on the team, which is what every reader already
-- assumed. The setup page's own regFieldSection() has always classified
-- these two as 'contact' rather than per-player, and the teams table's
-- CONTACT column read players[0].phone to fake it.
--
-- Backfill takes the first non-null value per team ordered by player id,
-- which is the row the CONTACT column was already displaying. One team is
-- corrected by hand: its roster carries a misspelled address on five rows
-- and the real one on the sixth, and majority order picks the typo.

alter table teams
  add column contact_email text,
  add column contact_phone text;

update teams t
set contact_email = (
      select p.email from players p
      where p.team_id = t.id and p.email is not null
      order by p.id limit 1
    ),
    contact_phone = (
      select p.phone from players p
      where p.team_id = t.id and p.phone is not null
      order by p.id limit 1
    );

-- Organizer-confirmed correction: prefer the correctly spelled address
-- wherever a roster carries it on any row.
update teams t
set contact_email = 'teamwonderful@hotmail.com'
where exists (
  select 1 from players p
  where p.team_id = t.id and p.email = 'teamwonderful@hotmail.com'
);

-- The per-player columns are now unread. Dropping them is what stops the
-- fan-out coming back.
alter table players
  drop column phone,
  drop column email;
