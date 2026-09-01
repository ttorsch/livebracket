# Anchor the grid's court columns and day sections to the configured venue

Type: task
Status: resolved
Blocked by: 02

## Question

The grid's *other* two axes still float. `02` fixed time; courts and days were
left alone deliberately, because they carry a bigger blast radius.

Both are still derived from `filteredMatches` in the calendar memo
(`page.tsx`, `const calendar = useMemo`):

- **Columns** come from the distinct courts of the *visible* matches, so
  selecting one division drops every court that division does not play on. The
  courts an organizer is looking for free time on are exactly the ones with
  nothing on them.
- **Day sections** come from the distinct days of the visible matches, so a
  filter can make a whole day disappear rather than show it empty.

`02` settled the principle these follow from: the grid's frame is the configured
venue, and the filters decide which cards sit in it, not where it is. Empty
columns and empty days are wanted for the same reason empty rows are.

What this ticket has to decide and do:

1. Take the column roster from `courtRoster(config)` (`lib/schedule/types.ts`)
   rather than from the matches. Decide what happens to a match placed on a
   court no longer on the roster — a saved schedule can name one.
2. Take the day sections from the event's `dayCount` / dates. Decide how a
   schedule whose days sit outside the event's current range is shown; the
   existing comment in the memo about negative day indices is the live case.
3. `courtOrder` feeds the left/right arrows of the navigator
   (`navOptions`/`navMove`). Confirm that widening the roster does not let a
   match be moved onto a court the venue does not have, and that the arrows
   still skip the `Unscheduled` column.
4. Consider whether the `Unscheduled` column belongs in the roster or beside it,
   now that the roster is configuration rather than observation.

Done when selecting a single division changes which cards are on the grid and
nothing else — same columns, same day sections, same rows.

## Answer

The grid's frame is the **configured venue** on all three axes now. `02` settled
the principle for time; this applies it to courts and days, and the shape of the
answer is the same each time: draw the configuration, and show anything outside
it *beyond* the frame rather than dropping it.

**1. Columns come from `courtRoster(config)`.** Roster order, not sort order —
the venue's own order is what the organizer knows. A saved schedule can name a
court the roster no longer has, because court names live on the match row and
dropping `courtCount` from 6 to 4 strands whatever was on Court 5. Those become
**off-roster columns**, drawn past the roster, in a dashed muted head reading
"Not on this venue · N matches". Rejected: evicting them to the tray (rewrites
what the schedule *is*, while the saved rows still say Court 5) and hiding them
(the exact defect `02` fixed for the axis). Off-roster courts are read off
`allMatches`, never the filtered set, so a filter cannot move the frame either.

**2. Day sections come from the event's days**, `0 … dayCount-1`, plus any day a
match actually sits on — which covers the negative day indices the memo's old
comment flagged, computing their date from `startDate` rather than reading it off
a match, so a day with nothing on it still knows what date it is. Choosing a day
in the filter bar still narrows to that day: that is picking which frame to look
at, which is a different act from filtering by division.

An empty day would otherwise cost a full-height grid (~1500px of nothing), which
is the vertical budget `06` is trying to win back — so an empty day **collapses**
to a one-line strip ("Day 3 · Sat, Jul 26 — Nothing scheduled") that expands on
tap. Present, because an empty Day 3 is information; collapsed, because a blank
grid is not.

**3. The arrows travel the roster only.** `courtOrder` is now `calendar.roster`,
so widening the columns cannot turn a stray into somewhere a match can be *put*.
A match already stranded on one can step **left** into the last roster court —
strays are drawn to the right of the roster, so "left" reads as pushing it back
into the venue, and the arrows become the way out of exactly the mess the
off-roster columns expose. Right is dead from a stray. Rejected: walking every
drawn column (re-creates the stranding) and disabling both arrows (draws the
problem, offers no way out of it).

**4. The tray is out of the roster.** `'Unscheduled'` was an entry in
`calendar.courts` filtered back out at five call sites; it is now its own thing.
The memo returns `roster` (the venue), `offRoster` (the strays), and `columns`
(what the grid draws: roster, strays, then the tray). Nothing can be dragged into
or out of the tray today, so it is a readout, not a destination — which is why it
does not permanently occupy a court column. It stands whenever the *tournament*
has anything unplaced rather than whenever the *filtered set* does: a column that
came and went with the filters would shift the grid the same way the courts did.
Lifting it out of the grid entirely is left to `07`, which will have a gesture
for moving a match out of it.

**Lunch and blocked periods stop at the roster's edge.** A venue-wide block is a
statement about the venue, and an off-roster court is not part of it. The absence
of the lunch band on a stray column does the flagging for free. A block that
names a court explicitly still paints on it, wherever it is.

Also settled: the block tool only arms cells on roster courts — taking time off
the board on a court the venue does not have is meaningless.

**Vocabulary**: *court roster* and *off-roster court* added to the root
`CONTEXT.md`, the former written as the explicit counterpart of *time axis*.

**Verified**: `tsc --noEmit` clean, `eslint` clean (the memo's dep array has to
name `detail` rather than `detail?.startDate` — the React Compiler refuses to
preserve the memo otherwise), `npm test` 182/182, `next build` succeeds. The
behavioural check ran against **Test Tournament** (2 days, 4 courts, 3
divisions, saved schedule) on the local dev server, after `13` had landed:

1. **Filter to Mixed Open** (3 matches, all on Court 2) — Courts 1-4 all still
   drawn, three of them empty; both day sections still present, Day 2 holding a
   single match; rows 09:00-16:45 and the lunch band unmoved. Only the cards
   changed, 25 -> 2. This is the acceptance criterion, and it is the case that
   used to collapse the grid to one column.
2. **Courts 4 -> 3** — Court 4 becomes an off-roster column in place, headed
   "Not on this venue · 8 matches" in the dashed muted head, all 8 matches still
   drawn.
3. **Lunch** spans Courts 1-3 and stops before the stranded column.
4. **The rescue** — picking up the 09:00 match on the stranded Court 4 gives
   left enabled, right disabled; pressing left lands it on Court 3 (8 -> 9) and
   the stranded column drops to 7.
5. **Empty days** — filtering to Completed Matches (nothing played) collapses
   both days to "Day 1 · Wed, Sep 2 — Nothing scheduled" strips rather than
   dropping them or drawing two empty grids; tapping one expands it to the full
   frame, four courts and all rows, reading "0 MATCHES".

Nothing was saved: the court count and the hand move were both discarded by
reload.

**Surfaced, not fixed**: the per-day court header counts every day's matches,
not that day's — filtered to Mixed Open, Day 1's Court 2 head reads "0/3" beside
a section headed "2 MATCHES". Pre-existing (`onCourt` is not day-scoped) and
untouched here, but far more visible now that empty courts sit next to it
reading "0/0". Ticketed as `17`.

### Behavioural check — done

Run against Test Tournament (2 days, 3 divisions, 4 courts) on the local dev
server, signed in. The frame was snapshotted with all divisions showing, then
re-read after selecting each division in turn:

| Filter | Cards on grid | Columns · day sections · rows |
|---|---|---|
| Divisions (all) | 34 | baseline |
| Mixed Open | 3 | identical |
| Women Open | 16 | identical |
| Men Open | 15 | identical |

"Identical" compares the column list (`Court 1–4`), the day headings
(`Wed, Sep 2` / `Thu, Sep 3`), the section count, the row count and the first
and last row labels — all byte-for-byte equal across every filter state. Mixed
Open is the hard case: 3 cards spread over 2 days, which under the old memo
would have collapsed the grid to the one or two courts it plays on.

This closes the item the answer above left open ("the signed-in account on the
local dev server has no tournaments"). There is a seeded tournament at
`/dashboard/tournament/test-tournament/schedule`; the earlier session was
looking at an account without one.

Not exercised here: the **off-roster** column and the **collapsed empty day**,
since Test Tournament's saved schedule names only roster courts and has no empty
day. Both are unit-testable and neither is on this ticket's done criterion, but
they are the parts of the answer that remain unseen in a browser.
