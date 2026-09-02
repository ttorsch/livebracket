# Map: Schedule generator — logic and mobile grid

Label: wayfinder:map

## Destination

The organizer schedule generator (`/dashboard/tournament/[id]/schedule`) produces
schedules that match the organizer's mental model — lunch stops play, the day
starts when the config says it starts, and generation is only offered once the
tournament is actually ready for it — and its grid view is usable on a phone.

Reached when those behaviours are shipped, not merely specified.

## Notes

**Domain:** tournament scheduling. The solver (`lib/schedule/*`, ~3,300 lines) is
a pure, deterministic pipeline: graph → inventory → dayplan → grid → cost →
assign → repair, plus validate and drift. It is fully tested (148 tests green).
The driving page (`app/dashboard/tournament/[id]/schedule/page.tsx`, 2,369 lines
TSX + 2,490 lines CSS) is untested and is where every reported symptom lives.

**Execution is in scope.** This map overrides Wayfinder's plan-only default: the
destination is working behaviour, so `task` tickets build as well as decide.
Decision tickets still resolve before the build tickets that depend on them.

**Vocabulary:** the root `CONTEXT.md` is this repo's glossary, started by this
effort. Terms like *draw*, *draw lock*, *placement*, *hand edit* and *preview*
are defined there — use them as written, and add to it when a term is settled.

**Skills each session should consult:** `diagnosing-bugs` for the symptom
tickets, `grilling` + `domain-modeling` for the decision tickets, `prototype`
for the mobile interaction ticket.

**Before editing:** run a graphify query (`graphify-out/graph.json`) — the page
is large and heavily interconnected.

### Settled during charting

These framed the map and are inputs to every ticket, not steps on the route:

- **Lunch means nobody plays.** `staggerLunch` (a rolling per-court break) is
  rejected as user-facing behaviour. The organizer's model is a venue-wide stop.
- **Seeds are never registration order.** Real seeding happens after
  registration closes.
- **The schedule is downstream of the draw.** Pool count comes from the pool
  draw configuration, so a draw must exist before a schedule can. Generating a
  schedule pre-registration would require generating a draw first, and a draw
  that exists before registration closes invites the question "did you re-roll
  it?" — which is why pre-registration preview was dropped.
- **The draw's ceremony is the lock, not the generation.**
  `settings.draw.isLocked` already distinguishes *final* from *merely
  generated*. Attempts before the lock are working acts; changing a locked draw
  is a visible one.
- **Scope is the organizer generator only.**

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [When may a schedule be generated?](issues/09-schedule-generation-preconditions.md):
  generating a preview stays open; **saving** requires every non-cancelled
  division's draw to be locked. Unlocking a draw over a saved schedule must be
  confirmed with the cost named. Vocabulary settled into a new root
  `CONTEXT.md`.
- [Protect a saved schedule when a draw is unlocked](issues/11-protect-schedule-on-unlock.md):
  the confirm belongs on the **regenerate**, not the unlock, and is enforced
  server-side — the draw route returns 409 with a real count unless the body
  carries `confirmDiscard`. Placements are columns on the match row and
  `round_id` cascades, so a redraw **deletes** them rather than orphaning them:
  nothing survives to report, and none of it is recoverable. `mode: 'crossing'`
  was destructive too, and is now gated at knockout scope.
- [Anchor the grid's time axis to the configured day](issues/02-anchor-grid-time-axis.md):
  the axis is a property of the **configured day**, not of the visible matches —
  `startTime`–`endTime` at the solver's own `gridResolution`, read off
  `allMatches`, opening outward in whole rows for anything outside the day. Off-pitch
  hand edits keep their true minute via a sub-row offset rather than being rounded
  onto a row. Extracted to `lib/schedule/calendarAxis.ts` and unit-tested.
- [Lunch stops play on every court](issues/01-lunch-stops-play.md): `staggerLunch`
  is **deleted**, not defaulted — a stale `true` in a saved config blob is now a
  key nothing reads, so no migration. Lunch is **absent from the grid rather
  than blocked on it**: the day is built as runs either side of the break, each
  laying slots from its own start, so play resumes at the configured `lunchEnd`
  instead of the next block boundary. `Grid.slotStarts` replaces
  `dayStart + i * step` as the source of truth, and `courtOpen` refuses a span
  that crosses the break. Capacity is unchanged; the sub-block remainder moved
  from after lunch to the end of the day.
- [Gate saving a schedule on a fully locked draw](issues/10-gate-schedule-save.md):
  the gate is a shared pure predicate (`lib/scheduleGate.ts`) asked by both the
  page and the route, and it bites on **placements, not on the save** — the
  venue configuration saves whatever the draw is doing, or the capacity testing
  `09` protected could be done but never kept. **Every** division counts: there
  is no cancelled division in this schema, and approximating one by "divisions
  with matches drawn" would let an undrawn division fall silently out of a
  saved schedule. The refusal carries no confirmation escape, unlike `11`'s.
  The Save button is not disabled — it relabels to *Save settings* and names
  the unlocked divisions beside itself, which serves `09`'s "a dead button with
  no reason is worse than no gate" better than a dead button would.

- [Re-phase the calendar axis after lunch](issues/13-axis-phase-after-lunch.md):
  the axis **mirrors the solver's runs** — `calendarAxis.ts` exposes `rows[]`
  with a true start, its own length and a kind, so the afternoon's rows begin at
  `lunchEnd` and every afternoon card is back on a gridline (span 1, offset 0,
  from span 2 at a constant 15-minute offset). Not merely cosmetic: the block
  tool read a row's time back off `startMin + slot * pitch` and was offering
  court time at **12:45, inside lunch**; both sites doing that arithmetic now
  ask `rowStartMin`. Lunch is a row that **collapses to a seam while nothing is
  inside it** and re-opens to true scale for a hand edit or an overlapping
  block — `02`'s stretch-never-move rule turned inward. Run tails become short
  `idle` rows, so the axis still reaches `endTime` and the half-hour a lunch
  window costs is drawn where it is lost. `grid.ts` now exports `dayRuns`, so
  solver and display cannot disagree about the day again. Shape only — density
  stays `06`'s.

- [A net change must not eat the start of a day](issues/14-net-buffer-eats-day-start.md):
  the net buffer is a **wait, not a flat charge** — `max(slot.abs, previousEnd +
  buffer)`, so the morning rig and any change that fits an idle gap cost nothing,
  and the overnight break needs no special case. The buffer's two meanings are
  split: *preference* still reads the seeded running height (clustering is
  unchanged — `pivots` 11 both ways), *elapsed court time* only ever bills a real
  predecessor on that court that day. `courts[].height` is deliberately **not**
  reset per day: it is the physical state of the net. A start-of-day rig still
  counts as a pivot — it happens, it just costs no play time. Pins remain exempt
  from the buffer entirely, which is now
  [16](issues/16-pinned-net-change.md).

- [Anchor the grid's court columns and day sections to the configured venue](issues/12-anchor-grid-courts-and-days.md):
  the last two axes follow `02`. Columns are `courtRoster(config)` in venue
  order; a court a saved schedule names but the roster no longer has is drawn
  **past** the roster and marked "Not on this venue", never dropped and never
  somewhere a match can be moved *to* — the arrows travel the roster only, and a
  stranded match steps **left** back into the venue, which makes them the way
  out of the mess the column exposes. Day sections are the event's days plus any
  day a match actually sits on; an empty one **collapses** to a strip rather than
  a full-height empty grid, because that vertical cost is what `06` is trying to
  win back. Lunch and venue-wide blocks stop at the roster's edge. `'Unscheduled'`
  left the roster: the memo now returns `roster` / `offRoster` / `columns`, and
  the tray stands on the tournament having something unplaced rather than the
  filtered set, so it cannot come and go with a filter either. *Court roster* and
  *off-roster court* added to `CONTEXT.md`.

- [Make the grid readable on a phone](issues/06-mobile-grid-density.md): the
  phone's scale is **derived, not chosen** — `PHONE_CARD_FLOOR_PX /
  shortestMatchMinutes`, read off `allMatches` like `02`'s axis. A fixed
  px-per-minute is a bet that costs either legibility (a stretched row stretches
  across *every* court) or screens of scrolling, and the phone was paying the
  second: a 30-minute card was drawn 237px tall around **135px of content**,
  because `margin-top:auto` was quietly distributing the slack. What the
  timeline promises is *relative* — 45 minutes reads as 1.5× 30 — and that holds
  at any absolute scale, so pinning the scale to the card's content makes the
  grid always exactly as compact as its content allows and the stretched row
  unreachable rather than merely unlikely. Deliberately **not clamped**: a cap
  would reintroduce that failure *rarely*, and rare failures are the ones nobody
  finds. The card gives up only redundancy — the `vs` row (35px to separate two
  already-stacked names) and the duration chip (on a timeline the card's length
  *is* the duration). The 1.2-court peek **stays**: two courts across 275px
  cannot hold a team name, and squeezing would pre-empt `07` with the weakest
  option it exists to prototype. Gutter 68→52px by deleting a `flex: 1` rule
  crushed against its `min-width`, not by shrinking `13`'s anchor hour. Both
  scales now cross into CSS **as data** so a breakpoint can choose — an inline
  `--cal-px-per-min` out-specifies every rule — which is also why `offsetStyle`
  emits a `calc()` and the lunch seam moved to CSS. Day 1861→**791px**, page
  4490→**2350px**, card 237→**86px** against an 86px need, nothing stretched.
  Two pre-existing defects fixed in passing: `scroll-padding-left` was short by
  the scroll container's own padding, hiding the first court's leading
  characters under the gutter; and the lunch banner centred across a 1015px
  roster in a 343px scrollport, so the seam read as an unlabelled strip.

## Not yet specified

- **Referee assignment** is modelled in the types but assigned by hand. Whether
  it interacts with rest and the day plan enough to matter here is unclear until
  the schedule is otherwise correct. (`11` settled one corner: a redraw destroys
  referee duty along with the placements, so it is counted in what a redraw
  costs.)
- **Drift / live projection vs. hand edits** — `drift.ts` projects a running
  event; how that composes with pinned manual edits has not been examined.
- **Whether the feasibility verdict should count blocked periods.** Surfaced by
  `01`: `courtMinutesPerDay` subtracted only lunch, and now subtracts nothing —
  the manual `blocks` an organizer takes off the board never reach
  `scheduleInventory`'s supply, so a venue with a morning ceremony on every court
  still reports `fits`. Pre-existing, and left alone because `01` was narrowing
  what capacity means rather than widening it. How wrong it is in practice is
  unclear until someone uses blocks in anger.

- **Whether the config panel should price a lunch window.** Raised by `13` and
  deliberately not answered there: `01` chose the honest remainder over
  snapping, so a 12:00–13:00 lunch on 45-minute blocks silently costs 30 minutes
  at the end of every day, and an off-pitch `lunchStart` strands minutes before
  the break too. `13` made the cost *visible* — the leftovers are drawn as their
  own rows — but never *named*. Whether the organizer should be told the price
  while choosing the window, or nudged toward one that divides, is a schedule
  config question rather than a display one, and it is the same species as the
  blocked-periods entry above: how honestly capacity is reported back.

## Out of scope

- **Public tournament schedule view**, **scorekeeper screen**, **setup page
  readiness checks** — ruled out; this effort is the organizer generator only.
- **Placeholder `teams` rows with frozen seeding** — the persistence-heavy
  version of preview. Ruled out because seeds are not registration order, which
  removes its only advantage.
- **Generating a schedule before registration fills**, in every form —
  placeholder teams and pool-position shapes alike. Ruled out on fairness, not
  feasibility: pool count comes from the pool draw configuration, so any preview
  requires a draw to exist first, and a draw standing before registration closes
  reads to players as an attempt that might have been re-rolled. Closes
  [Decide the pool-position preview model](issues/03-pool-position-preview-model.md),
  [Generate a schedule from pool positions](issues/04-build-pool-position-preview.md)
  and [Reshape when a division does not fill](issues/05-undersubscribed-division-regen.md)
  — the last is moot once the draw always follows the real team list.
- **Staggered lunch as a user-facing feature** — ruled out as behaviour. `01`
  settled the code path's fate too: deleted outright, flag and all, so there is
  nothing left to resurrect.
- **Carrying placements across a redraw** — raised by `11` as possible fog,
  ruled out on merit before it was ever ticketed. A schedule is a whole, not a
  bag of matches: the generator balances rest, court capacity, pace and
  division spread across all of them at once, so a time that was good under the
  old draw is only coincidentally good under the new one. Carrying a subset
  forward does not preserve work, it pins stale constraints onto a fresh
  solve — and hands the organizer a schedule that *looks* intact while some of
  it is a fossil of a draw that no longer exists. That is the failure mode `11`
  just closed, mirrored: legibility is the whole point, and "none of it
  survives" is legible in a way "most of it does" is not. It inherits the old
  draw's prime-time advantages across a ceremony meant to redistribute them,
  and the identity it rests on does not hold anyway — the knockout's sides are
  pool positions, so it has no stable fixture identity at all. **Pinning is
  already the honest version of this**: an explicit organizer act, not a guess
  at intent.
