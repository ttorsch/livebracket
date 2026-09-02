# The court header counts every day, not its own day

Type: task
Status: resolved
Blocked by: —

## Question

Each day section draws its own court headers, but the count in them is not
scoped to that day.

`page.tsx`, in the grid's court-header map:

```ts
const onCourt = filteredMatches.filter(m => m.court === court);
```

`filteredMatches` spans the whole event, so on a two-day tournament every day's
header reports the same total. Filtered to Mixed Open on **Test Tournament**,
Day 1's Court 2 head reads `0/3 played` while the section beside it is headed
`2 MATCHES` — the third match is on Day 2.

Pre-existing, and deliberately left alone by `12`, which was narrowing where the
grid's frame comes from rather than touching what the headers say. It is worth
fixing now for two reasons `12` created:

- the roster is drawn in full, so headers on courts with nothing on them read
  `0/0 played` and sit directly beside the wrong number, which makes the
  inconsistency legible in a way it was not before;
- `06` is about to tune the header's height and content for a phone, and should
  not tune around a number that is wrong.

What to do:

1. Scope the count to the day the header is drawn for. The per-day items are
   already grouped in the calendar memo (`itemsByDay`), so the count can come
   off the same grouping rather than a second filter over every match.
2. Decide whether the progress bar means the same thing once it is per-day — it
   is `played / total` on the same set, so it should follow the count.
3. Check the `Unscheduled` tray's header, which has no day and currently shares
   this code path.

Done when a court's header on a given day reports that day's matches, and the
section heading's match count and the sum of its court headers agree.

## Answer

**A court header counts the cards drawn under it.** Not the event's matches on
that court, not the filter's — the column's own, in the section it heads. The
old line re-filtered `filteredMatches`, which is scoped by division and by
nothing else, so a header stated a fact about the *tournament* while sitting on
top of a *day*. Every section of a two-day event therefore reported the same
number, and the two were only ever equal on a one-day event.

The count now comes off `d.items`, the day's own grouping — the same array the
blocks are built from a few lines later. That is the point of taking it from
there rather than re-deriving it: the number and the cards it sits over are the
same list, so they cannot disagree again. A single pass builds a
`Map<court, {total, played}>` per day; the header reads its own key.

### The tray is not a court, and not on a day

`Unscheduled` shared the court branch and so was rendered with a progress bar
that sat at 0% permanently — an unplaced match is never `done`, so `0/N played`
was structurally unreachable above zero. It reads `N waiting` now, with no bar.

Two counting questions fell out of that, and both were settled the same way:

- **The corner no longer counts the tray.** It was `day.blocks.length`, and
  `blocks` carries the tray stack on the first section, so "Day 1 · 25 matches"
  was claiming unplaced matches as that day's work. It is `d.items.length` now.
  The **By Court** view had already drawn this line — it gives `Unscheduled` a
  *dateless* section of its own (`key = ''`) rather than filing it under a date
  — so the two views of this page now agree about what a day contains.
- **The tray's own count is section-scoped**, like every other column's. The
  stack is drawn in the first visible section only, so later sections show the
  column with no note rather than a number over an empty column — which is the
  defect this ticket is about, and it would have been silly to reintroduce it in
  the one column that provoked the question.

That leaves the corner equal to the sum of the court columns by construction:
both are `d.items`, partitioned by court. The tray sits outside the equation
because it is outside the day.

### Fixed in passing

- An **unplaced match kept its court name** (`unscheduled` is
  `court === 'Unscheduled' || time === '—'`, so a match with a real court and no
  time is unplaced), and the old header counted it against that court. It is
  gone with the switch to `d.items`, which is built from `scheduled`.
- `"1 matches"` in the corner, on the line being rewritten anyway.

### Behavioural check — done

`test-tournament` on the local dev server, signed in. For each filter state, the
corner count was compared against the sum of that section's court headers:

| Filter | Wed, Sep 2 | Thu, Sep 3 | Total |
|---|---|---|---|
| Divisions (all) | 25 = 7+6+6+6 | 9 = 3+2+2+2 | 34 |
| Mixed Open | 2 = 0+2+0+0 | 1 = 0+1+0+0 | 3 |
| Women Open | 12 | 4 | 16 |
| Men Open | 11 | 4 | 15 |

Corner equals the sum in all eight sections. The totals are `12`'s baseline
(34 / 3 / 16 / 15), so no card changed hands. The ticket's reported symptom is
the Mixed Open row: Wed's Court 2 read `0/3 played` beside a section headed
`2 MATCHES`, and now reads `0/2` beside `2 matches`.

The frame `12` and `02` fixed did not move: four columns (`Court 1–4`) and 16
grid rows in every section under every filter, and Day 2 stays collapsed. `06`'s
phone density is unchanged — checked at 375px, the header still reads
`Court 1 · 0/7 played` over the corner's `25 MATCHES`. No console errors.
207 tests green, `tsc` and `eslint` clean.

**Not exercised in a browser**: the tray branch and the off-roster branch —
`test-tournament` has no unplaced match and no stranded court, so neither column
is drawn. Same gap `12` recorded for the off-roster column; the tray's copy and
its section-scoping are reasoned and typechecked but unseen.

### Surfaced, not fixed

`slots` is `Math.max(axis.slots, maxUnscheduledSlot)` on **every** day, but the
tray stack is only drawn in the first section. A tournament with enough unplaced
matches to out-run the axis therefore makes *every* day's grid taller, with the
extra rows empty on all but the first. Pre-existing, the same "the tray belongs
to one section" confusion this ticket untangled in the headers, and one line
from the fix — left alone because it changes day heights, which `06` has just
tuned, and it is not on this ticket's done criterion. Added to the map's fog.
