# Lunch stops play on every court

Type: task
Status: resolved
Blocked by: —

## Question

Make lunch a venue-wide stop, as the UI has always claimed it is.

Today `staggerLunch` defaults to `true` (`lib/schedule/types.ts:152`). Staggered,
each court gives up only one block at an offset (`lib/schedule/grid.ts:130-176`),
so courts play straight through the lunch window. Meanwhile the page draws a
full-width "Lunch Break (12:00 – 13:00)" banner across every court
(`page.tsx:2112`). The banner and the solver disagree, and the flag is not
exposed in the UI — only the API accepts it (`schedule/route.ts:106`), so an
organizer cannot turn it off.

Settled: lunch means nobody plays. What this ticket still has to decide and do:

1. Flip the default to `staggerLunch: false`.
2. **Saved configs already carry `staggerLunch: true`.** Decide whether to
   migrate them, coerce on read, or leave them and let regeneration pick up the
   new default. An organizer who never touches the setting should not keep
   getting staggered lunches.
3. Decide the fate of the stagger code path — keep it dormant behind the flag,
   or delete it. Note `generate.test.ts:492-500` tests both paths.
4. Confirm capacity: removing the stagger costs roughly one block × court count
   per day. Check `inventory.ts` still reports a feasible event for a
   representative tournament, and that the loss surfaces as a clear message
   rather than silent overflow.

Done when a generated schedule places no match overlapping the lunch window on
any court, and the banner tells the truth.

## Resolution

Lunch is now a venue-wide stop that honours the configured window exactly, and
`staggerLunch` is gone.

**The flag is deleted, not defaulted.** Removed from `ScheduleConfig`, from
`DEFAULT_SCHEDULE_CONFIG`, from the route's `cleanConfig` whitelist, and the
stagger branch is gone from `grid.ts`. This settles item 2 by dissolving it: a
stale `staggerLunch: true` left in a saved `schedule_config` blob is now a key
nothing reads, so no migration and no read-time coercion is needed. Worth
recording that the ticket's third option — "leave them and let regeneration pick
up the new default" — was never available: the page PATCHes the whole normalised
config (`page.tsx:597`), so every tournament that had ever saved carried an
explicit `true` that a changed default would never have reached.

**Lunch is absent from the grid, not blocked on it.** Flipping the flag alone
would not have met this ticket's own done-condition. Measured on the default
config (09:00–18:00, 45-minute blocks, 12:00–13:00 lunch): the old unstaggered
path blocked whole slots on a lattice anchored at `dayStart`, so it took *two*
blocks — 90 minutes per court, not one block as the ticket assumed — and play
resumed at **13:30** while the banner said 13:00. The banner would still have
lied, just differently.

So the day is now built as **runs**. `lunchBlocked` and `buildLunch` are deleted;
`buildSlotStarts` lays `[dayStart, lunchStart)` and `[lunchEnd, dayEnd)`, each
run laying slots from its own start. A run only offers a slot that finishes
inside it, so nothing can start that would run into lunch, and play resumes at
exactly `lunchEnd`.

New `Grid.slotStarts: number[]` replaces `dayStart + i * step` as the source of
truth for when ordinal *i* begins, and `Grid.lunch` carries the clipped window
for the callers that must judge a time the grid never offered. Slots keep their
day-ordinal identity, so every occupancy array, cost term and repair swap is
untouched — the uniform-lattice assumption existed in only six places, all now
fixed:

- `grid.ts` — slot generation, `buildBlocks`, `courtOpen`.
- `assign.ts` — pins resolve by start time, not by arithmetic on the index. A
  pinned time inside lunch now matches no slot, which is the right answer.
- `validate.ts` — blocked periods scanned by overlap; lunch checked against the
  window itself, because a hand-placed match sitting in the break overlaps no
  slot and would otherwise pass unremarked.

**Contiguity is the new rule.** The slots either side of the break are adjacent
ordinals an hour apart in time, so `courtOpen` refuses a span that crosses them —
otherwise a 90-minute match would book 11:15–12:00 and resume at 13:00.

**Capacity (item 4) is unchanged, and the loss moved rather than grew.** The
segmented day yields the same 10 slots/court/day as the old blocked lattice; the
sub-block remainder now falls at the end of the day (last slot ends 17:30)
instead of after lunch. That is where slack belongs — an over-running match eats
into the evening, not into the afternoon's first round. A representative event
(3 divisions × 8 teams, 6 courts, 2 days) reports `fits` at 0.70 utilisation.

One latent bug was made reachable and fixed: lunch can now swallow the day
outright, and with zero playable minutes `inventory.ts` printed the lever "Add
Infinity days". It now reports "No court time is playable at all…" instead.

**The banner needed no change.** It already read `config.lunchStart`/`lunchEnd`
(`page.tsx:1001`); those times are now literally true. Verified the geometry:
the last morning card ends exactly where the banner begins (11:15–12:00 → row 3,
banner row 4 offset 0), and the afternoon resumes at 13:00.

**Verified:** 174 tests pass, `tsc --noEmit` clean, no lint findings in any
touched file. The three stagger tests are replaced by five covering the new
behaviour: no slot inside the break, play resuming at the configured end rather
than the next block boundary, spans refused across the break, no generated match
over the break, and a lunch window outside the day collapsing to no lunch.
Edge cases probed: lunch dividing evenly (30-min blocks, zero waste), lunch
outside the day, `end <= start`, lunch overhanging the morning (clipped, play
starts at 10:00), and lunch swallowing the day (0 slots, reported as overflow).

**Not verified visually.** `/dashboard` is auth-gated, so the rendered grid was
not confirmed in a browser; the axis geometry was checked arithmetically instead.

Files: `lib/schedule/grid.ts`, `types.ts`, `assign.ts`, `validate.ts`,
`inventory.ts`, `generate.test.ts`, `app/api/tournaments/[slug]/schedule/route.ts`.
