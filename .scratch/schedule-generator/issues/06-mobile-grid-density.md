# Make the grid readable on a phone

Type: task
Status: resolved
Blocked by: 02, 13, 12

## Question

Grid view on mobile is unusably tall and overflows sideways.

Measured causes:
- rows are `minmax(var(--cal-slot-h, 126px), auto)`
  (`page.module.css:1541`) — with the `gcd` pitch collapsed to 5 minutes, a
  09:00–18:00 day is ~108 rows ≈ 13,600px tall;
- mobile court columns are `minmax(var(--cal-court-col, 240px), 1fr)`
  (`page.module.css:2394`) — 240px per court overflows a 375px screen;
- match cards are sized to fit a full team name on two lines, which the
  organizer says is more vertical space than the content needs.

`02` fixes the pitch and cuts the row count to roughly a dozen. This ticket
handles what remains: row height, card height, and column width.

What to decide and do:

1. A mobile `--cal-slot-h` — target a full day in two to three screens.
2. Card content at mobile density: what a card must still show when it is one or
   two lines tall. Note that after `03`/`04` a slot may read `Pool A - 1`, which
   is shorter than most team names — do not tune the card to team names alone.
3. Column width against the existing 1.2-court peek (`e59d89b`), which is the
   established pattern for showing there is more to the right.
4. The time axis column (`--cal-time-col`, 96px) is oversized for a phone.

Empty slots must remain visible and legible — see `07`; spotting free court time
is a stated purpose of this view, so density must not come from hiding gaps.

Done when a full tournament day in grid view is readable on a 375px screen
without horizontal overflow of the page body.

---

**Blocked on `13` as well as `02`.** `13` re-phases the calendar axis after
lunch; tuning row height, card height and column width against the current
uniform ruler would be redone the moment it lands, and `13` names this ticket as
the place its cost is felt hardest.

---

**Blocked on `12` as well.** `12` made the columns the configured venue instead
of the courts the visible matches sit on, so a filtered view no longer collapses
to two or three columns — a 4-court venue now draws 4 columns always. That was
hiding the horizontal problem this ticket has to solve, and it changes what
column width has to achieve. `12` also introduced the collapsed empty-day strip,
which is the first piece of vertical budget already won back.

---

## Answer

The ticket's three measured causes were all stale — `02`, `13` and `12` had
already removed two of them. Re-measured live at 375px on `test-tournament`
before deciding anything:

- **Row count was no longer the problem.** `13` made height `minutes × ppm`, so
  the "~108 rows" is gone; the day was 1861px because the *scale* was 8.1px per
  minute.
- **Horizontal overflow was already fixed** by `12` — `docW == winW == 375`, the
  calendar scrolling inside itself.
- **The card was the problem, in the opposite direction to the one written
  down.** A 30-minute card was drawn **237px** tall around **135px** of content:
  `.gridTeamRowA/B`'s `margin-top:auto`/`margin-bottom:auto` were silently
  distributing ~100px of slack around the teams. The ticket assumed the card was
  sized to fit team names; it was sized to fit *the desktop scale*.

So most of this ticket was recoverable with no loss of content at all.

### The scale is derived, not chosen

`PX_PER_MIN` is one constant tuned so a typical shortest card fits. That is a
bet, and on a phone it costs either legibility (too small — and a stretched row
stretches across *every* court, so one short match inflates that row for the
whole venue) or screens of scrolling (too large). The phone was paying the
second.

**Deriving removes the bet**: `phonePxPerMin = PHONE_CARD_FLOOR_PX /
shortestMatchMinutes`. The organizer never reads a pixels-per-minute figure —
what the timeline promises them is *relative* ("a 45-minute match is one and a
half times a 30-minute one"), and that holds at any absolute scale. So the scale
is pinned to the one thing that must not break, and the grid is then always
exactly as compact as its content allows. The stretching row becomes unreachable
by construction rather than merely unlikely.

**Not clamped.** A cap would buy compactness back by letting the shortest card
stop fitting — reintroducing, *rarely*, exactly the failure the rule exists to
prevent, and rare failures are the ones nobody finds. Sub-20-minute matches are
not real beach volleyball, so if the derivation ever exceeds the desktop scale
the event's durations are wrong, not the rule. Hence a dev-mode `console.warn`
rather than a `Math.min`.

`shortestMinutes` is read off `allMatches`, never `filteredMatches` — same rule
as `02`'s axis and `12`'s roster. A division filter that hid the short matches
would otherwise re-scale the whole grid under the organizer.

### The floor is measured, not chosen

`PHONE_CARD_FLOOR_PX = 92`: 6px padding each end, a 20px top row and the 6px
under it, two 24px team rows, plus the 3px the card is inset from its row at
each end. The phone card gives up two things, both **redundancy rather than
information**:

- the **`vs` divider row** (35px — over a third of what the card needs) to
  separate two names that are already stacked, already flanked by score badges
  and already inside one card;
- the **duration chip**, because on a timeline the card's length *is* the
  duration. It costs no height (it shared the top row) but returns width.

The match-number chip and the score badges were deliberately kept: the chip is
the card's only division colour, and empty score slots are how an unplayed match
reads.

### Mechanism

The scale had to become swappable at a breakpoint, which meant it could no
longer be computed in JavaScript: an inline `--cal-px-per-min` out-specifies
every rule in the stylesheet. The page now hands over **both candidates as
data** (`--cal-ppm-wide`, `--cal-ppm-phone`, plus `--cal-pitch`) and `.calGrid`
chooses; `--cal-slot-h` is derived from the choice rather than passed in, so the
two cannot disagree. `offsetStyle` emits `calc(N * var(--cal-px-per-min))`
instead of multiplied pixels — otherwise an off-pitch hand edit would keep its
wide-screen height on a phone and hang out of its row. `LUNCH_SEAM_PX` moved to
CSS for the same specificity reason.

### Result (375px, `test-tournament`)

| | before | after |
|---|---|---|
| Day section | 1861px | **791px** (−57%) |
| Whole page (2 days) | 4490px | **2350px** (−48%) |
| Scale | 8.1px/min fixed | **3.07px/min** derived (92 / 30) |
| 30-min card drawn / needed | 237 / 135 | **86 / 86** |
| Time gutter | 68px | **52px** |
| Court column | 227.5px | **240.8px** |
| Lunch seam | 48px | **36px** |

All 14 playing rows measure exactly `pitch × ppm` — **nothing stretched**. Cards
run 86.1px (30min) to 132.1px (45min), a 1.53 ratio against a true 1.5, so
proportionality holds. Desktop verified unchanged: 8.1px/min, 121.5px rows, 48px
seam, `vs` and duration both still drawn.

### Decisions

1. **Scale**: derived per event from the card floor, no clamp (Q1, Q5).
2. **Card**: drops the `vs` row and the duration chip; top-row margin 12→6 and
   team rows 28→24 (Q2).
3. **Column width**: the 1.2-court peek **stays**. Two courts across 275px is
   ~137px each, which cannot hold a team name — and squeezing would pre-empt
   `07` with the weakest of the options it exists to prototype (Q3).
4. **Time gutter**: 52px, by **deleting the rule and the dot**, not by shrinking
   the hour. The parts summed to 78px in a 68px box, so the `flex: 1` rule was
   crushed against its `min-width` and read as clutter; `.calGridLine` already
   draws the same tick across every court. The hour keeps its size — `13` made
   it the anchor of the axis, and shrinking it to the minor labels' size to buy
   9px would undo that (Q4).
5. **Lunch seam**: 36px, sized by its banner and deliberately *not* by the
   scale — tying it to the scale would re-entangle the one thing the seam exists
   to keep separate (Q6).

### Two defects found and fixed in passing

- **`scroll-padding-left` was short by the container's own padding.** It was set
  to `--cal-time-col`, but the gutter sticks to the *padding* edge, so its right
  edge is the column plus `.calScroll`'s 12px. At rest the snap left ~12px of
  the first court under the gutter, eating the first character of its match
  times and team names. Pre-existing at 68px by the same margin; fixed as
  `calc(var(--cal-time-col) + 12px)`.
- **The lunch banner was invisible on a phone.** It centres across the whole
  court roster — 1015px against a 343px scrollport — so the pill sat off-screen
  and the seam read as an unlabelled dashed strip: the one row whose meaning
  cannot be inferred from the cards around it, because it has none. Now
  `position: sticky` at the gutter's edge, riding the left the way the time
  gutter does. Pre-existing, but shrinking the seam to 36px made it mine.

### Not done, deliberately

- **The same derivation would fit desktop**, where 8.1 is still a hand-tuned
  bet. Left alone — this ticket is the phone, and widening it to the wide-screen
  scale would put a working view at risk for no reported symptom.
- **`17`'s wrong court-header count** is visible in this fixture (the section
  reads `25 MATCHES` while its four court heads sum to 34). Not touched: it is
  its own open ticket, and the header's *height* did not need retuning here.

### Glossary

No new `CONTEXT.md` term. *Pitch*, *time axis*, *run* and *slot* already carry
this ticket's concepts and none of their meanings changed; the card floor and
the pixels-per-minute scale are implementation, and `CONTEXT.md` is a glossary.

**Verified**: 200/200 tests pass, `eslint` clean, `tsc --noEmit` clean, no
console errors, no horizontal page overflow at 375px.
