# The endgame may run past the end time, and blocks saving

Type: task
Status: open
Blocked by: —

## Question

Settled: the finals programme stays as it is — semifinals one division at a
time, every division's 3rd-place play-off together, finals one at a time on one
court. That programme is serial by design and is the main reason the venue runs
43–79% idle at the end of a day.

Also settled: rather than compress or abandon the programme, **the day may
stretch**. A 17:00 end time may become 18:00 if that is what the finals need.
**No ceiling.** The overrun **blocks saving** until the organizer decides what
to do about it.

What this ticket decides:

1. **What "blocks" means precisely.** The sibling map's
   [gate](../schedule-generator/issues/10-gate-schedule-save.md) settled a
   refusal with no escape, and its
   [redraw confirm](../schedule-generator/issues/11-protect-schedule-on-unlock.md)
   settled a confirm that names its cost. An overrun is the second kind — the
   organizer is being asked to accept something, not prevented from doing
   something wrong — so it wants a confirmation, not a dead Save button. That
   also follows `10`'s finding that a dead button with no reason is worse than
   no gate at all.
2. **Whether only the endgame may overrun.** Pool play never should: a pool
   match running late is a scheduling failure, a final running late is a
   tournament. The rule needs to name which matches are allowed to.
3. **What the organizer is told.** The overrun is a fact about the schedule
   like a broken promise. This ticket read `05` as arguing for **one** list of
   things worth knowing; [05](05-pool-play-has-no-rest-rule.md) settled the
   opposite. There are two lists and their difference is real: a **given-up
   promise** explains the whole event, a **problem** accuses one match. What
   `05` fixed was that they were shown at two different volumes, not that there
   were two of them. So the question here is which of the two an overrun is —
   and it looks like the first: nothing is wrong with any particular final, the
   event as a whole ran past its end time.
4. **Where the stretched time is drawn.** The grid's time axis is a property of
   the configured day, settled by the sibling map — an axis that now has to
   open past `endTime`. That map's rule was "stretch, never move", which this
   should follow rather than reinvent.

## Notes

Interacts with the lunch and blocked-period machinery: a stretched day extends
past `endTime`, which is where `dayRuns` currently stops.
