# Should a hand-placed match pay for a net change?

Type: grilling
Status: open
Blocked by: —

## Question

A pin is a hard constraint, so the solver puts it exactly where the organizer
said — `startAbs: slot.abs`, `netChange: false`, span from the duration alone
(`assign.ts:297-307`). It never consults `optionFor`, so it never pays the net
buffer and never even records that a change happened.

That was invisible while the buffer was charged everywhere else too. [A net
change must not eat the start of a day](14-net-buffer-eats-day-start.md) has now
stated the rule out loud — *the buffer is the wait between the previous match
ending and this one starting* — and pins are the one placement exempt from it.
So an organizer can drag a 2.43 m match into the slot straight after a 2.24 m
match on the same court, and the schedule says it starts on time.

`validateSchedule` does not catch it either: nothing in `validate.ts` reads
`netHeight`. It checks court clashes, team clashes, rest, blocked periods and
lunch, and a net change with no time to make it passes unremarked.

Open decisions:

1. **Should a pin be moved, or reported?** Moving it contradicts what a pin is.
   Reporting it — a `PinConflict`, or a validation warning on a hand edit — keeps
   the pin hard and tells the organizer what it costs. A third option is that
   this is fine: the organizer looked at the court and decided.
2. **If reported, at which seam?** `assign.ts` sees pins the solver was given;
   `validate.ts` sees a hand-edited schedule coming back from the page. `14`'s
   rule lives in `assign.ts` and would have to be shared, not duplicated, or the
   two will drift.
3. **Does a pinned match's height change what follows it?** It does today —
   `occupy` sets `courts[].height` from any placement — so the cost of a pin is
   already partly paid by the *next* match. Whether that is the right place for
   the whole cost to land is the question underneath 1.

## Notes

Surfaced by [A net change must not eat the start of a day](14-net-buffer-eats-day-start.md),
which found it while separating the buffer's two meanings and deliberately left
pins alone: they were exempt before that ticket and are exempt after it, so it
is not a regression it introduced.

Sits next to the map's open fog on **drift / live projection vs. hand edits** —
both are about what an organizer's manual placement is allowed to override.
