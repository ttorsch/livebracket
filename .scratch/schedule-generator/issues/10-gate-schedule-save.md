# Gate saving a schedule on a fully locked draw

Type: task
Status: resolved
Blocked by: —

## Question

Implement the gate decided in
[09](09-schedule-generation-preconditions.md): generating a preview stays open,
**saving** requires every non-cancelled division's draw to be locked.

Today `handleSave` (`page.tsx`) has no precondition at all, and neither does the
Save button (`page.tsx:1776`).

What to do:

1. Derive "schedulable" from real state, not a new flag: every non-cancelled
   division has `settings.draw.isLocked`. `lib/data.ts:301` already surfaces
   `drawLocked` per division and `computeReadiness` already consumes it — extend
   that path rather than adding a second notion of ready.
2. Enforce it on the **server** too (`api/tournaments/[slug]/schedule/route.ts`),
   not only in the UI. A disabled button is a courtesy; the route is the rule.
3. The disabled Save must **say why**, naming the divisions still unlocked and
   linking to where they are locked
   (`dashboard/tournament/[id]/page.tsx:375`).
4. Decide whether the `schedule` readiness item in `setupReadiness.ts` should
   reflect this — it currently reads "every drawn match has a time and a court",
   which is downstream of the gate rather than the gate itself.

Done when a schedule cannot be saved while any division's draw is unlocked, the
organizer is told exactly which ones and where to go, and the API refuses it
independently of the UI.

## Answer

Built and verified against a running event. The gate is a single pure
predicate, `scheduleSaveGate` (`lib/scheduleGate.ts`, 9 unit tests), asked by
both the page and the route — so a disabled control and a refused request can
never disagree about the reason.

**1. Every division counts.** The ticket inherited "every *non-cancelled*
division" from [09](09-schedule-generation-preconditions.md), but there is no
such thing: `divisions` is `0001_init.sql:33` plus the `0003` settings blob, and
`cancelled_at` exists only on `tournaments`. There was no exemption to make.
Approximating one — "divisions that have matches drawn" — was rejected outright:
it would let an undrawn division fall silently out of a saved schedule, which is
the exact failure `09` ruled out when it chose whole-tournament over
per-division. Pinned by a test.

**2. The gate is on placements, not on the save.** `handleSave` writes twice —
PATCH (venue configuration) then PUT (placements) — so gating the *function*
would have blocked saving the court roster until every draw was locked, killing
the capacity testing `09` deliberately kept open. Only the PUT is refused.
Config saves whatever the draw is doing.

**3. Both save buttons are gated**, because both write placements: the preview
*Save Schedule* and the edit-bar *Save changes* for hand edits. One rule, no
exception to state.

**4. `setupReadiness.ts` untouched.** Its `schedule` item stays an outcome
measure. Worth recording why a third copy would have been the real duplication:
the gate's condition **already exists** there as the `published` item —
`lockedCount === divisions.length`, labelled *"Draw locked in every division"*
(`setupReadiness.ts:99`). The checklist already tells the story in order.

### Where it is enforced

- **Server** (`api/tournaments/[slug]/schedule/route.ts`): PUT reads the
  divisions itself rather than trusting the client, and refuses **before any
  write** with 409 + `drawUnlocked: true` + the unlocked divisions. Unlike
  `11`'s `discardRefusal` this refusal carries **no confirmation escape** — the
  way through is to lock the draw, not to insist.
- **Client**: `saveGate` derives from `detail.divisions[].drawConfig.isLocked`.
  No new state, no new flag.

### The dead-button problem, resolved differently

The ticket asked for a *disabled* Save that says why. That turned out to be the
wrong shape once the gate landed on the write rather than the control: the
button still saves the venue configuration, so disabling it would have broken
requirement 2. Instead the button **stays live and stops lying** — it relabels
to *Save settings*, and a notice beside it names the divisions and links to the
bracket page. The reason is visible *before* the click rather than buried in a
disabled control's tooltip, which serves `09`'s actual principle ("a dead button
with no reason is worse than no gate") better than a dead button would.

### A correction to the ticket's own step 1

It pointed at `lib/data.ts:301` as the path to extend. That is
`getSetupSummary`, which feeds `computeReadiness` on the **setup** page; the
schedule page uses `getTournamentDetail`, which already surfaces
`drawConfig.isLocked` (`lib/data.ts:1096`). There was never one path to extend —
there were two loaders. Hence a shared predicate *over* both rather than a flag
*in* either.

### Verified

- 182 unit tests green (9 new); `tsc --noEmit` and `eslint` clean.
- **Gate open** — `test-tournament`, all three draws locked: button reads
  *Save Schedule*, no notice.
- **Gate closed** — `sideout-beach-volleyball-tournament`, both draws never
  locked and no matches drawn (so it exercises the undrawn-division edge too):
  notice reads *"The draw is not locked in Men Open and Women Open."* with a
  working link to the bracket page, and the button reads *Save settings*.
- **Server independent of the UI** — a direct `PUT` from the page's own session,
  bypassing the button entirely, returned **409** naming both divisions.
  A direct `PATCH` returned **200**: configuration is genuinely not gated.

Spawns [15 — Should the draw lock gate anything besides the schedule?](15-draw-lock-as-a-rule.md),
graduated from the map's fog now that the lock is read as a rule on exactly one
write path.
