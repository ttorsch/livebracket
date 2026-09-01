# Protect a saved schedule when a draw is unlocked

Type: task
Status: resolved
Blocked by: —

## Question

**A live data-loss bug**, surfaced while resolving
[09](09-schedule-generation-preconditions.md) and independent of the rest of
this map.

Unlocking a division's draw and regenerating it (`mode: 'draw'`) rebuilds its
rounds and matches from scratch, minting **new match ids**
(`divisions/[divisionId]/draw/route.ts` — ids are generated server-side, not
read back). Every `PinnedPlacement` and every hand edit is keyed by match id
(`types.ts`), so all of them are silently orphaned. Nothing warns the organizer
and nothing reports it afterwards.

Settled: the organizer is never refused, but never allowed to destroy work
unknowingly — the principle `validate.ts` is built on.

What to decide and do:

1. Where the confirmation belongs: the unlock toggle
   (`dashboard/tournament/[id]/page.tsx:361-375`), the regenerate action, or
   both. Unlocking alone is harmless; regenerating is what destroys.
2. What the warning counts and names — "this discards your schedule and 14
   manual edits" needs those numbers to be real.
3. Whether orphaned placements are deleted, or left and reported. Leaving dead
   rows keyed to vanished matches is how this stayed invisible.
4. Whether any of it is recoverable, or whether the honest answer is "this
   cannot be undone" stated plainly up front.

Done when regenerating a draw over a saved schedule is impossible to do by
accident, and what it costs is stated in numbers before it happens.

## Answer

**The confirmation belongs on the regenerate, not the unlock — and it is
enforced on the server, not in the dialog.**

### 1. Where it belongs

The **destructive action** carries the blocking confirm; unlocking carries a
standing notice. Unlocking only flips `settings.draw.isLocked` and reveals the
Draw Config tab — it destroys nothing, and a dialog there would be the first of
two, which is how organizers learn to dismiss both. So:

- **Unlock** → a non-blocking line beside the lock button whenever the division
  has placed matches: *"This division has a saved schedule (46 matches placed).
  Redrawing discards it."* Counted client-side from the bracket the page
  already holds — enough to warn before anything is at risk.
- **Redraw / rebuild** → a blocking confirm carrying the server's own numbers.

### 2. Two destructive paths, not one

The ticket named `mode: 'draw'`. `mode: 'crossing'` destroys too, and was
missed: it deletes the elimination rounds and their matches
(`route.ts:539-541`), so knockout placements go while pool play keeps its times
and courts. Both are now gated, at their true scopes (`division` / `knockout`),
and the crossing dialog says pool play survives — because it does.

### 3. Orphaned placements: the premise was wrong, and the truth is worse

There are **no orphans**. A placement is not a row keyed by match id — it is
*columns on the match row* (`court`, `planned_time`, `scheduled_time`, `pinned`,
`referee_team_id`, migration `0008`), and `matches.round_id` is
`on delete cascade` (`0001_init.sql:84`). Deleting the rounds deletes the
matches and takes the placements with them.

So nothing is left to delete or report afterwards. The question resolves as
**moot**: the only honest moment to count is *before* the delete, which is what
the gate does. `PinnedPlacement` in `types.ts` is the generator's in-memory
type; it is not how a pin is persisted.

**Referee duty is destroyed the same way** and nobody had counted it. It is now
in the tally.

### 4. Recoverable: no, and it says so

No snapshot, no undo. Match ids are minted server-side on every regenerate, so
there is nothing to restore *to*. The dialog ends "This cannot be undone."
because that is the fact.

### What was built

- **`lib/schedule/discardCost.ts`** (+ 11 tests, suite now 159 green) — the pure
  rule: what counts as a placement, what a pin is worth on its own, and how to
  say the total in a sentence that never names an empty category. Extracted
  rather than inlined because these numbers are a promise about what is about to
  be deleted, and duplicated the "placed means a court *and* a time" rule that
  already lived in `getSetupOverview`.
- **The server refuses** (`draw/route.ts`): a rebuild that would cost anything
  returns **409** with `{ needsDiscardConfirm, scope, cost }` unless the body
  carries `confirmDiscard: true`. The refusal sits **ahead of the seed write**
  as well as the delete — a refused request leaves the division exactly as it
  found it, and reseeding is a write. The route is the rule; the dialog is the
  courtesy. A client that never asks still cannot destroy the work silently.
- **The client spends the count** (`dashboard/tournament/[id]/page.tsx`):
  `saveDraw` / `applyCrossing` run unconfirmed, read the 409, show the dialog
  with the server's numbers, and come back through with the answer. The numbers
  are therefore always fresh and always the server's.

### Scope held

The gate is keyed on **schedule cost, not on lock state**. Whether the draw lock
should itself refuse a regenerate stays in the map's fog where it belongs — and
that fog entry is now sharper: the server currently checks the lock on **no**
write path at all (`isLocked` is only ever written, in PATCH), so the lock is
today a client-side courtesy.

Raised, and then **ruled out of scope**: *carrying placements across a redraw*.
The thought was that a pool fixture whose two teams land in a pool together
again is the same match and could keep its time. It does not survive contact —
a schedule is solved as a whole, so carried-over times are stale constraints
rather than preserved work, and a schedule that looks intact while part of it
is a fossil is exactly the illegibility this ticket closed. Pinning already
expresses "keep this one" as an explicit act. See the map's **Out of scope**.
