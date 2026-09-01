# Anchor the grid's time axis to the configured day

Type: task
Status: resolved
Blocked by: —

## Question

The grid's day does not start at the configured start time, and its axis moves
when filters change.

`page.tsx:937` anchors each day to `Math.min(...)` over the **currently filtered**
matches, and the memo depends on `filteredMatches` (`page.tsx:1026`). So:

- the first row is the earliest scheduled match, not `config.startTime`;
- filtering by division or status re-anchors the whole axis;
- the lunch banner is positioned relative to that floating anchor
  (`page.tsx:970-984`), so it slides around too;
- row pitch is a `gcd` over match offsets (`page.tsx:930-934`), so a single odd
  start time collapses it to 5 minutes and a 09:00–18:00 day becomes ~108 rows.

Settled: anchor the axis to `config.startTime`–`config.endTime` with a fixed
pitch derived from `blockMinutes`, independent of which matches are visible.

What this ticket has to decide and do:

1. Fixed pitch — `blockMinutes` exactly, or the grid's own `slotMinutes` from
   `lib/schedule/grid.ts`? The solver already computes a resolution that divides
   every match length. Prefer reusing it over recomputing a second, different
   answer in the view.
2. Matches that fall off the fixed axis (a hand-edit before `startTime` or after
   `endTime`) must still be visible. Decide how.
3. Empty rows at the head and tail of the day are now expected, and are
   **wanted** — see `07`: spotting free slots is a stated purpose of this view.

Done when the first row is the configured start time, the axis and the lunch
banner hold still while filters change, and row count is bounded by the day
length over the block size.

## Answer

The axis is now a property of the configured day, computed in a pure module —
[`lib/schedule/calendarAxis.ts`](../../../lib/schedule/calendarAxis.ts) — and
tested in isolation. The page reads it; it no longer derives it.

**1. Pitch: the solver's `gridResolution`, over durations only.**
`buildCalendarAxis` calls `gridResolution(durations, blockMinutes)` — the same
function `buildGrid` uses — so the view and the solver agree on the step by
construction rather than by coincidence. `blockMinutes` alone was rejected: a
20-minute pool match in a 45-minute-block event would not land on a row.

The real defect was never the *choice* of gcd, it was its **inputs**: the old
code folded each match's offset from the first match into the same gcd, so one
hand edit at 09:07 dropped a nine-hour day to a 5-minute pitch and 108 rows. An
offset is where a match happens to be; it says nothing about how finely the day
should be ruled. Durations only. The 5-minute floor and the `blockMinutes` cap
inside `gridResolution` bound the row count from both ends.

**2. Matches off the axis: the axis opens outward, in whole rows.**
`startTime`/`endTime` are the frame; any match starting earlier or ending later
pushes the boundary out by whole multiples of the pitch. Whole multiples matter
— it keeps `startTime` exactly on a row boundary, so the labels keep their phase
and the first row is still the configured start in every ordinary case. The
alternatives (clamping such matches to the end rows, or dumping them in the
Unscheduled column) both lie about when the match is, and a hand edit outside
the day is a thing the organizer should *see*, not have tidied away.

**3. Off-pitch starts get a sub-row offset, not a rounding.**
Fixing the pitch created a case the old gcd had absorbed: an organizer can type
any `HH:MM`, and inserting a buffer shifts a court's run by an arbitrary number
of minutes, so a match need not begin on a row. `placeOnAxis` returns
`offsetMinutes` alongside the row, and the view turns it into a pixel offset and
an explicit height at the same `PX_PER_MIN` scale the rows use. Rows stay the
frame; the card sits at its true minute. A block that *does* start on a boundary
gets no extra style at all, so the ordinary case renders exactly as before.

**4. Every row is labelled.** Previously: hours, plus the start of every row
holding a match. Both halves broke under a fixed pitch — 45-minute rows land on
the hour only every third one, and the rows an organizer most wants to read are
the *empty* ones, which by definition no match would have labelled. Row count is
now bounded by the day, so all of them get a time; `isHour` still marks the
hour so it reads as the anchor.

**5. Capacity check (the point of it all).** The axis reads `allMatches`, never
`filteredMatches`. That single change is what makes it hold still: the day, the
pitch, the row count, the labels and the lunch banner are now identical whether
one division is selected or all of them.

### Also changed, following from the above

- A drop onto an **empty court** takes `config.startTime` as its start. It used
  to take the earliest match on screen, so the same drop landed at a different
  time depending on the filters.
- **Inserting a buffer** before a match uses that match's own start time rather
  than the top of the row it is drawn in — those differ once an edit is
  off-pitch.
- A blocked period reports **its own length** instead of re-deriving it from the
  rows it covers.
- `calendar.pitch` is gone; there is one pitch and it belongs to the axis.

### Feedback loop

`npm test`. The module was first committed as a verbatim port of the page's
existing algorithm, and the nine assertions covering the reported symptoms all
went red against it before any behaviour changed; 172/172 green after. The page
itself is typechecked and lint-clean.

### Surfaced, not fixed

The same memo builds the grid's **columns** and its **day sections** from
`filteredMatches` too, so selecting one division still drops courts and can make
a whole day vanish. Same defect, different axis, and a bigger blast radius —
court order feeds the left/right navigator. Ticketed separately as
[Anchor the grid's court columns and day sections to the configured venue](12-anchor-grid-courts-and-days.md).

**Court view does not share this defect.** The map left that open pending `02`.
Checked: `courtSections` is a list grouped by court and sorted by time — there is
no axis, no anchor and no pitch, so there is nothing to float. What it *does*
share is court membership: its columns come from `filteredMatches` too, which is
`12`'s territory, not a separate question.

**The fixed axis immediately exposed a real defect it had been hiding.** With the
day anchored to 09:00, Test Tournament shows Court 4 idle until 09:15 on day 1
and every court idle until 09:15 on day 2 — a net-change buffer charged where no
net has to be changed during play. The old floating axis anchored each day to its
earliest match, so a court starting late looked like the top of the day. Ticketed
as [A net change must not eat the start of a day](14-net-buffer-eats-day-start.md).

Label density at a 5-minute pitch (108 labelled rows on a nine-hour day) is
legible but busy. It only arises when the event genuinely mixes match lengths,
where 5-minute rows are correct — but it is worth a look from `06`, which owns
grid density on a phone.
