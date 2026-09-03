# Delete the tidy-up pass

Type: task
Status: open
Blocked by: —

## Question

`repair.ts` is a bounded local search over the finished schedule: try an
improving exchange, keep it if the total cost drops. Settled during charting
that it should be **deleted rather than tuned**. This ticket is the deletion
and the argument for it, so a future reader does not rebuild it.

Measured and structural reasons:

- **It accepted zero improvements in every run during charting**, across every
  venue size and division count tried.
- **It can only trade look-alikes.** Two placements may swap only if they span
  identical blocks *and* sit on the same court or want the same net height. It
  can never move a single match into an empty gap — the first thing a human
  would do, and the only move that helps an idle venue.
- **It never reaches past the morning.** Fixed budget (default 4000), pairs
  visited in ascending placement order, so the budget is spent on the earliest
  matches and later ones are never examined. If sweep one exhausts the budget,
  sweeps two through eight do not run at all.
- **It does not re-check rest.** `legal()` verifies courts, dependencies,
  staging and team overlap — not `minRestMinutes`, not the daily cap. So it can
  undo a guarantee the placement phase treated as inviolable, including under
  `restIsHard`, and price alone decides. That makes the relaxation report a
  lie, which is the same defect as `05` from the other end.

Deleting it removes `repairIterations` from the config and `improvements` from
the result. Check the schedule page for both before pulling.

## Notes

The honest counter-argument, recorded so it is not lost: solving each slot
optimally in sequence really does not produce an optimal schedule, and repair
was the answer to that. Under `04` the answer becomes the turn plan instead —
structure rather than search. If turns do not deliver it, the gap reopens, and
it should reopen as a *new* ticket with a measurement, not as this code.
