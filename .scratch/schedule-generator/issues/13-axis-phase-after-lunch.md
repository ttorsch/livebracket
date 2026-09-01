# Re-phase the calendar axis after lunch

Type: grilling
Status: resolved
Blocked by: 01

## Question

The solver's day is now segmented; the display axis is still one uniform ruler.

`01` split the playing day into runs so play resumes at the configured
`lunchEnd`. `calendarAxis.ts` (built by `02`, before the split existed) still
rules the whole day at one `pitch` from `startTime`, so on the default config
every afternoon card carries a constant 15-minute `offsetMinutes`:

```
banner 12:00-13:00 -> row 4  span 2  offset 0min
card   11:15-12:00 -> row 3  span 1  offset 0min
card   13:00-13:45 -> row 5  span 2  offset 15min
card   16:45-17:30 -> row 10 span 2  offset 15min
```

The morning sits on the row lines and the whole afternoon sits 15 minutes below
them. Cards are drawn at their true minute, so nothing is *wrong* — but every
afternoon card now spans two rows and none of them line up with a gridline or a
time label. That is a readability question, and `06` inherits it on a phone,
where a card spanning two rows costs proportionally much more.

The tension is real in both directions: `02` settled that the axis is a property
of the configured day rather than of the matches, and re-phasing after lunch
makes the axis depend on the lunch rule too. But an axis whose rows no one plays
on for half the day is a frame that has stopped framing anything.

What this ticket has to decide:

1. Whether the axis mirrors the solver's runs — restarting its row phase at
   `lunchEnd`, so afternoon cards sit on rows again — or stays one uniform ruler
   and accepts the offset.
2. If it re-phases: what the lunch band itself spans, and whether row *labels*
   restart too (13:00, 13:45, ... rather than 12:45, 13:30, ...).
3. Whether an off-phase afternoon is a reason to nudge the organizer toward a
   lunch window that divides their block (`01` chose the honest remainder over
   snapping; this asks whether the display should advertise the cost).
4. Whether this is a hint that `pitch` should come off `grid.slotStarts` rather
   than being recomputed independently from config — the two now encode the same
   day twice, by different rules.

Done when the afternoon reads as deliberately placed rather than accidentally
misaligned **at the desktop density**, and the axis exposes a row shape `06` can
retune without redoing it.

**Scope against `06`.** This ticket owns the axis's *shape* — which rows exist,
what each one spans, what it is labelled. `06` owns its *scale* — row height,
card height, column width, the time column. `06` stays blocked on this one
because tuning pixels against a shape still in motion is work done twice.


## Answer

**The axis mirrors the solver's runs.** `calendarAxis.ts` no longer rules one
uniform ladder from `startTime`; it exposes `rows: AxisRow[]`, each with a true
`startMin`, its own `minutes` and a `kind`. Morning rows run from `startTime`,
the afternoon's from `lunchEnd`, so every afternoon card is back on a gridline:
span 1, offset 0, where it used to be span 2 at a constant 15-minute offset.
Row labels restart as a consequence rather than as a separate decision — a row
is labelled with the minute it actually starts at, so the afternoon reads 13:00,
13:45 because that is when those rows begin.

Three alternatives were weighed and rejected. Leaving the ladder uniform was
untenable once it turned out the misalignment is not only cosmetic (below).
Shrinking the pitch to `gcd(pitch, lunch)` so both runs land on one ladder buys
uniformity with the one resource this feature is shortest on — 12 rows would
become 36 — and it makes the pitch a function of the lunch window, so a 12:00–
12:50 lunch would drop the whole day to a 5-minute ruler, the exact failure `02`
removed. Shipping the solver's `Grid` to the page was unavailable: the page
receives matches and config, not solver output.

**The misalignment was already lying to the organizer.** The block tool mounts a
clickable cell per row and reads its time back off `startMin + slot * pitch`
(`page.tsx`), so on the default config it offered court time at **12:45**,
inside lunch, underneath the lunch banner. That is what made this a correctness
question rather than a taste one. Both sites that did that arithmetic — the
block tool and the buffer-insert fallback — now ask `rowStartMin`, and the block
tool mounts no cell on a lunch row: lunch already takes that time off the board
on every court.

**The lunch row collapses to a seam only while nothing is inside it.** An hour
at `PX_PER_MIN` is ~486px — about half a phone screen — of announced emptiness
that repeats what the banner on it already says. But an organizer may type any
time, and a blocked period may overlap the break, so `collapsed` is false the
moment anything overlaps the window, on any court or any day, and the row
returns to true scale. This is `02`'s "matches may stretch the axis, never move
it" rule turned inward. It is the one place the grid stops drawing time to
scale, and it only happens where there is no time to draw.

**Run tails get their own short rows.** 13:00–18:00 fits six 45-minute rows and
ends at 17:30, so `17:30–18:00` is a real half-hour of the configured day that
nothing can start in; a 12:15 lunch would strand `12:00–12:15` the same way.
These are drawn as `idle` rows rather than folded into a neighbour (which would
mean a row labelled 16:45 silently covering 75 minutes) or dropped (which would
break `02`'s rule that the axis is bounded by the configured day, and leave a
hand edit at 17:40 nowhere to live). They also show the organizer the cost of
their lunch window in the place it is actually paid.

**Hour emphasis is unchanged.** Re-phasing was checked against the worry that it
would thin the hour anchors out, and it does not: the uniform ladder put three
rows on the hour (09:00, 12:00, 15:00) and the re-phased axis puts three playing
rows on the hour (09:00, 13:00, 16:00) plus the lunch row at 12:00. What it
loses is regularity, and the lunch row is what marks the change of phase.

**One description of the day, not two.** `grid.ts` now exports `dayRuns` and
`lunchWindow`; `buildSlotStarts` and `buildCalendarAxis` both lay their output
from `dayRuns`, so the solver and the display cannot disagree about where the
afternoon starts again. `gridResolution` was already shared, so this widens an
existing seam rather than opening one.

### Scope

Mobile density stays `06`'s. The row heights are emitted as
`calc(<minutes> * var(--cal-px-per-min))` with the seam as `var(--cal-lunch-h)`,
so this ticket fixes the rows' *shape* and their proportions while leaving the
*scale* a variable `06` can retune. Note for `06`: `PX_PER_MIN` is still a JS
constant used to size cards, so retuning the CSS variable alone will desync the
cards from the rows — the two have to move together.

Whether the schedule config panel should warn that a lunch window costs unused
minutes was raised (part 3) and **ruled out of this ticket**: it is a config
change, not an axis change, and it is the same species of question as the open
"should the feasibility verdict count blocked periods". Carried to the map's
**Not yet specified** rather than resolved here.

### Changed

- `lib/schedule/grid.ts` — `dayRuns` and `lunchWindow` exported; `lunchWindow`
  now takes the two times rather than a whole `ScheduleConfig`.
- `lib/schedule/calendarAxis.ts` — rows model, `collapsed` lunch row, `idle`
  tails, `rowStartMin`, `rowKind`; `placeOnAxis` walks rows instead of dividing.
- `lib/schedule/calendarAxis.test.ts` — 15 new tests. 197 green, 0 failing.
- `app/dashboard/tournament/[id]/schedule/page.tsx` — axis is passed the lunch
  window and the blocks; `gridTemplateRows` emitted per row; lunch banner fills
  its row; both `slot * pitch` call sites replaced.
- `CONTEXT.md` — **Run** added; **Time axis** and **Pitch** amended, since a row
  is no longer always a pitch tall.

Not verified in a browser: `/dashboard` is auth-gated. The shape was verified
against the ticket's own before/after table by running the axis directly.
