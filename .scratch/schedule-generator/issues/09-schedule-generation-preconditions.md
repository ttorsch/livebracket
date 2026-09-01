# When may a schedule be generated?

Type: grilling
Status: resolved
Blocked by: —

## Question

Today the Generate button has **no preconditions at all** (`page.tsx:1727` —
plain `onClick={handleGenerate}`, no `disabled`, no guard). A schedule can be
generated in any phase, with an unlocked draw, or with no draw whatsoever.

The state needed to gate it already exists and does not need inventing:

- `tournaments.phase` — draft → announced → open → closed
  (`0010_tournament_lifecycle.sql`).
- `divisions.settings.draw.isLocked` — *"the draw is final, not just
  generated"* (`setupReadiness.ts:22`), set per division, toggled from
  `dashboard/tournament/[id]/page.tsx:375`.
- `computeReadiness` (`lib/setupReadiness.ts`) already derives six readiness
  items from real state, including a `schedule` item, and already reads
  `drawLocked`.

Open decisions:

1. **What is the hard precondition?** Candidates: registration closed
   (`phase`), draw generated, draw *locked*, teams at cap, payments cleared.
   These are not the same thing and only some of them are genuine dependencies
   of scheduling.
2. **Per division or whole tournament?** The lock is per division, but the day
   plan balances divisions against one another and court capacity is shared
   (`dayplan.ts`, `cost.ts` `paceDeviation`/`divisionSpread`). A schedule
   covering two of three divisions would be rewritten when the third arrives.
3. **What happens to an existing schedule when a locked draw is unlocked and
   regenerated?** `mode: 'draw'` rebuilds matches from scratch, so match ids
   change — which orphans every `PinnedPlacement` and every hand edit, silently.
   This is the destructive path and it currently has no warning.
4. **Where is the organizer told?** A disabled button with no reason is worse
   than no gate. Reuse `computeReadiness` rather than growing a second,
   divergent notion of "ready".
5. **Is a soft gate needed** — generate anyway, with a warning — or is the
   precondition genuinely hard? An organizer testing court capacity before the
   draw is locked is a real use, and it is the legitimate remnant of the
   preview idea that was dropped.

Consult `domain-modeling`: "generated", "locked", "final", "ready" and "closed"
are all doing work here and none are defined in one place. There is no
`CONTEXT.md` in this repo yet — this ticket is a good reason to start one.

## Answer

**Generating stays open; saving is gated.** `handleGenerate` already produces an
unsaved `preview` with separate Discard and Save buttons (`page.tsx:1773-1776`),
so the commit point already exists and is the right place for the gate.

1. **Precondition for saving: the draw is locked on every division.**
   `settings.draw.isLocked` already means "final, not just generated", which is
   exactly what the schedule depends on. Registration being closed is neither
   necessary (a division can close early) nor sufficient (closing creates no
   matches). A merely *generated* draw is too weak — it can be regenerated, and
   that destroys the match ids the schedule was built against. Payments and
   team-cap are commercial state, not structural: an unpaid team still plays
   matches that need a court.

2. **Whole tournament, not per division.** Every non-cancelled division must be
   locked. The day plan balances divisions against one another and court
   capacity is shared (`paceDeviation`, `divisionSpread` in `cost.ts`), so a
   schedule covering some divisions is rewritten wholesale when the rest arrive.
   Saving it would teach the organizer something false. Partial scheduling is a
   separate feature, not a relaxation of this rule.

3. **Unlocking a locked draw that has a saved schedule must be confirmed
   explicitly**, naming what is lost ("this discards your schedule and 14
   manual edits"). `mode: 'draw'` rebuilds matches from scratch, so match ids
   change and every `PinnedPlacement` and hand edit is silently orphaned. This
   is a live data-loss bug today, independent of the gating work. Follows
   `validate.ts`'s principle: never refuse the organizer, never let them destroy
   work unknowingly.

4. **Generate/preview stays ungated.** `inventory.ts` already answers "does this
   event fit, and which lever fixes it" — capacity testing before locking is a
   real and valuable use. The preview is unsaved and organizer-only, so no
   player sees it and no fairness question arises. This is the surviving,
   legitimate remnant of the dropped pre-registration preview.

   Requirement: the **Save button must state why it is disabled**. A dead button
   with no reason is worse than no gate.

Vocabulary settled here is recorded in the new root `CONTEXT.md`
(*draw*, *draw lock*, *phase*, *schedule*, *placement*, *hand edit*, *preview*).

Spawns [10 — Gate saving a schedule on a fully locked draw](10-gate-schedule-save.md)
and [11 — Protect a saved schedule when a draw is unlocked](11-protect-schedule-on-unlock.md).
