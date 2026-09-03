# A one-pool division cannot be given rest — say so

Type: task
Status: open
Blocked by: — (was 02, now resolved)

## Question

`02` guarantees rest by splitting a division's pools into two groups. A
division with **one** pool has no second group: every team is on court every
round, by construction, and no court allocation changes that.

Settled: such a division **plays flat out and the organizer is warned** that
its rest cannot be guaranteed. Not slowed to half speed, and not refused. The
organizer's reasoning: it is rare, and a lone pool leaves courts that another
division fills.

What is left to decide is the warning — where it appears and what it says.
It is a fact about the *draw*, not about the schedule: it is knowable the
moment the pool count is chosen, well before a schedule exists. So it probably
belongs beside the pool-count control in setup rather than only in the
generated schedule's problem list.

Pool count is organizer-chosen, clamped 1–8 in the draw route and offered as
2–8 by the dashboard stepper — so a one-pool division arrives through the API
or through a default, not through the stepper. Worth confirming whether it can
happen at all in practice before building anything for it.

## Notes

A pool of 2 or 3 teams is the degenerate case within the degenerate case: even
half speed would not help, since one match uses every team in the pool.

### Measured by 02: unchanged and unavoidable, plus one wrong number to fix

With [02](02-half-the-pools-rest.md) in, a one-pool division is **not slowed
down** — it still runs `⌊teams ÷ 2⌋` matches at once, because the ceiling
narrows how many *pools* play together and a lone pool is always one. Measured,
1 pool of 4 at 2, 4 and 6 courts: back-to-back 8, width 2, identical at every
court count. Flat out, exactly as settled.

**One number to fix here.** `optimalCourts` for a one-pool division is now
`max(1, ⌊1 ÷ 2⌋ × perPool)` = **1**, while the division actually occupies
`perPool` courts. The `max(1, …)` is doing all the work and the result is a lie
— there is no back-to-back-free width for a lone pool, so the honest answer is
"none", not "one". Harmless today (its only consumer is the cohort-0 ordering in
`staging.ts`, where a one-pool division simply sorts last), but it is the wrong
number to put in front of an organizer, and this ticket is the one that has to
say something truthful about this division anyway.

The degenerate-within-degenerate case from the Notes is confirmed unaffected:
2 pools of 3 gives `optimalCourts` 1, width 1, back-to-back 0 — it rests fine,
because two pools is two groups.
