# Decide the pool-position preview model

Type: grilling
Status: closed — out of scope
Blocked by: —

## Question

An organizer wants to generate a schedule before registration has filled.

Settled framing: the schedule is a **shape**, not a roster. Slots are labelled by
pool position (`Pool A - 1`, `Pool A - 2`), pool structure derives from
`divisions.division_team_cap` (mandatory, `0001_init.sql`), and real seeding
happens after registration closes, moving teams *within* the shape. No
placeholder `teams` rows.

This is already half-supported: matches carry `team_a_id: null` and knockout
slots render as "#1 Pool A" via `CrossSlot`; the scheduler accepts
`teamA: string | null` throughout.

Open decisions:

1. **Where does the shape come from?** The draw route
   (`divisions/[divisionId]/draw/route.ts`) currently needs `seedOrder` — a list
   of real team ids — to deal pools serpentine. Generating a shape from a cap
   alone means a path through that route (or beside it) that produces pools and
   matches with no teams. Which?
2. **Does the shape persist**, or is preview recomputed each time? Persisting
   makes the schedule stable and publishable; recomputing keeps the DB clean
   while registration is open.
3. **What does a pool-position slot become when seeding lands?** A team is
   written into the existing match row, or the match is rebuilt? The first keeps
   court and time; the second does not.
4. **Rest and `maxMatchesPerTeamPerDay` are unenforceable** on a shape — the
   cost function needs team identity to measure rest (`cost.ts`, `teamsOf`).
   A shape-only schedule is therefore optimised on fewer signals than a real one.
   Decide whether that is acceptable, or whether pool *position* can stand in as
   a team identity for rest purposes (position 1 of Pool A plays a known set of
   matches, so it can).
5. **How is a preview labelled in the UI** so an organizer never mistakes it for
   a final schedule?

Item 4 is the one most likely to bite: if positions can stand in for teams, the
preview is genuinely as good as the real schedule and nothing has to be redone
when names arrive. If not, the preview is decorative and `04` shrinks.

Resolve by grilling the organizer, not by picking. Consult `domain-modeling` —
"shape", "slot", "position" and "seed" all need to land in a glossary; there is
no `CONTEXT.md` in this repo yet.

## Outcome — ruled out of scope

Pre-registration schedule generation was dropped. Pool count comes from the pool
draw configuration, so any preview requires generating a draw first, and a draw
standing before registration closes invites "did you re-roll it?" from players.
The fairness cost is not worth the planning convenience.

Superseded by [09 — When may a schedule be generated?](09-schedule-generation-preconditions.md).
