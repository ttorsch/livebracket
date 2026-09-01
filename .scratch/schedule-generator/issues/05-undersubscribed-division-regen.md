# Reshape when a division does not fill

Type: task
Status: closed — out of scope
Blocked by: 04

## Question

Cap is 16, registration closes with 11 teams. The shape was built for 16.

Settled: **reshape and regenerate** — rebuild pools for the real count rather
than carrying five byes. This is the one case where the schedule legitimately
moves after being shown, so it must be the organizer's explicit act and the UI
must say plainly that times will change.

What this ticket has to decide and do:

1. When is the reshape offered — at registration close, at draw, at generate?
2. What survives it? Hand edits are pinned placements (`PinnedPlacement`,
   `types.ts`) keyed by match id; if matches are rebuilt, those ids are gone and
   every manual edit is lost silently. Decide whether to warn, remap, or discard
   explicitly.
3. What the organizer sees before committing — ideally a diff, at minimum an
   honest warning.

Done when an under-subscribed division can be locked and regenerated without
surprising the organizer or silently discarding their edits.

## Outcome — ruled out of scope

Pre-registration schedule generation was dropped. Pool count comes from the pool
draw configuration, so any preview requires generating a draw first, and a draw
standing before registration closes invites "did you re-roll it?" from players.
The fairness cost is not worth the planning convenience.

Superseded by [09 — When may a schedule be generated?](09-schedule-generation-preconditions.md).
