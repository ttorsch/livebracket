# Generate a schedule from pool positions

Type: task
Status: closed — out of scope
Blocked by: 03

## Question

Build what `03` decided: generate and display a schedule before registration has
filled, with slots read as `Pool A - 1` rather than a team name.

Touches at minimum:
- the draw/shape path decided in `03`;
- `lib/divisionMatches.ts:136-144`, which already resolves a display name and
  falls back to "TBD" / "Winner of M9" — pool-position labels belong in the same
  function, not beside it;
- the generate panel on the schedule page, which needs the preview affordance
  and the labelling decided in item 5 of `03`.

Done when an organizer with an empty division and a declared cap can press
generate, get a full schedule laid out on real courts and times, and read every
slot as a pool position.

## Outcome — ruled out of scope

Pre-registration schedule generation was dropped. Pool count comes from the pool
draw configuration, so any preview requires generating a draw first, and a draw
standing before registration closes invites "did you re-roll it?" from players.
The fairness cost is not worth the planning convenience.

Superseded by [09 — When may a schedule be generated?](09-schedule-generation-preconditions.md).
