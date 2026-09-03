# Say "the day is too short" instead of lowering the standard

Type: grilling
Status: open
Blocked by: — (was 05, now resolved)

## Question

When `assignMatches` cannot place everything, it walks a relaxation ladder,
giving up one promise at a time — finals on the last day, then staging, then
rest, then the day plan, then the daily cap, then back-to-back — and returns
the first rung that places everything.

Measured during charting, on a tournament the inventory verdict called `fits`,
with 22 court-slots left empty: **the ladder surrendered every promise it has,
including back-to-back.** Widening the day from 17:00 to 21:00 made every
relaxation vanish. The true answer was *"your day is about 45 minutes too
short for a knockout chain this deep"*; what the organizer got was a worse
schedule and a list of broken promises with no cause attached.

The ladder is the right mechanism and should stay. What is missing is that it
never diagnoses. Two things to decide:

1. **Should there be a floor?** Some promises may be worth refusing over. If
   back-to-back is the thing nobody wants, perhaps the generator should stop
   above that rung and say why, rather than producing a schedule the organizer
   would not have accepted had they been asked.
2. **What does the report say?** Today it names the promise broken. It knows
   enough to name the *cause* too — the critical path is already computed
   (`criticalPathMinutes`), so "the deepest chain needs 6h15 and your day is
   5h30" is available and is far more actionable than "gave up backToBack".
3. **What an unplaced match says for itself.** Added by
   [`01`](./01-reproduce-unplaced-with-idle-venue.md), which measured this on
   the organizer's real tournament. `overflow` is `{ matchId, divisionId }` —
   a bare id and no reason. The organizer saw a missing match beside 45
   minutes of visibly empty court and concluded the app was broken; the true
   answer was *"that court is rigged to 2.43 m and the net change leaves 35
   usable minutes, not 45."* That reason **exists** at the moment of refusal —
   `optionFor` in `assign.ts` knows whether it returned null for a net-change
   wait, a blocked period, or no open span — and is discarded. This is the
   same report and the same decision as (2), one rung down: per match rather
   than per promise. Kept here rather than cut as its own ticket, following
   `05`'s finding that there should be **one** list of things worth knowing.

Blocked by `05`: a report that does not yet cover pool back-to-back cannot be
made to explain it.

## Notes

`best` is selected by fewest unplaced matches and never by cost, so between two
rungs that both place everything the earlier wins — correct — but between two
that both fail, the *quality* of the partial schedule is not consulted at all.

Also inherited from the sibling map: whether the feasibility verdict should
count blocked periods. It said `fits` here while the generator broke every
promise it had, so the verdict's honesty is part of this question now.


---

## Unblocked by 05

[05](05-pool-play-has-no-rest-rule.md) settled the report's *shape*, which is
what this ticket needed before it could attach causes to anything:

- The preview now runs the full validator, so pool back-to-back exists as a
  **problem** on the schedule the organizer is looking at, not only after they
  save. Question 2 here — "what does the report say?" — now has something to
  say it about.
- **Two lists stay two.** A given-up promise explains the whole event; a
  problem accuses one match. `05` rejected merging them and left the join to
  this ticket: given-up promises become the **causes** attached to problems.
  That is the shape "the deepest chain needs 6h15 and your day is 5h30" wants —
  a cause, not a seventh item on a flat list.
- Rest is **two-state**, so "gave up on rest gaps" is no longer a rung this
  ticket has to explain. There is one rest rung left and it means exactly one
  thing.
- Question 1 here — *should there be a floor?* — is sharper now: under `05`'s
  "rest waits, never refuses", the last rung is the only place a team can be
  sent straight back on court, and it is reached only when waiting ran out of
  day. So a floor at that rung is the same statement as "your day is too short",
  which is what this ticket wants the generator to say.

### Measured by 02: `poolBlocks` is the first promise surrendered, and it is the whole rest guarantee

On the organizer's real tournament **as configured**, [02](02-half-the-pools-rest.md)
changed nothing — back-to-back stayed at 9 — because the ladder gives up
`poolBlocks` before the rotation can matter. Measured across day lengths, same
tournament, with `02`'s changes in:

| config | back-to-back | `poolBlocks` |
|---|---|---|
| as configured (lunch 12:00–15:30) | 9 | given up |
| lunch ends 13:00 | 5 | given up |
| day to 21:00 | 0 | kept |
| lunch 13:00 + day to 21:00 | 0 | kept |

Two things for this ticket:

- **`poolBlocks` is now load-bearing.** Before `02` it was nearly decorative —
  the rotation it names was advisory, so giving it up cost little. It is now the
  entire "half the pools rest" guarantee, and it is the **first** rung the
  ladder spends. The generator's cheapest concession is now its most expensive
  one, and the ladder's order was never revisited for that.
- **The relaxation report was lying in the other direction too.** Baseline, at
  `lunch 13:00 + 21:00`, reported `poolBlocks` **kept** while producing 12
  back-to-back matches. That specific lie is fixed by `02`, but it is the same
  species as this ticket's complaint: the standard was lowered and the report
  said otherwise.

The honest answer on this event remains "your day is about 45 minutes short",
and the organizer's 12:00–15:30 lunch is still the cause — a 13:00 lunch end
alone takes 9 back-to-back down to 5.
