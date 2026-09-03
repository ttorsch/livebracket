# Map: Placement — how a match earns its court and its slot

Label: wayfinder:map

## Destination

The generator places matches by a rule an organizer can read off a wall chart:
divisions take turns on courts reserved to them, half a division's pools play
while the other half rests, and nets move only at a handover. No team plays
back to back unless the generator says out loud that it could not avoid it.

Reached when a generated schedule for a real tournament has zero unexplained
back-to-back play and zero unexplained idle court time — shipped, not specified.

## Notes

**Domain:** tournament scheduling. This map is about **placement quality** —
whether the arrangement is *good*. Its sibling,
[Schedule generator — logic and mobile grid](../schedule-generator/map.md), is
about whether the arrangement is *legible and trustworthy*. Fifteen of that
map's nineteen tickets are resolved; four remain open there and are not this
map's business.

**Execution is in scope**, on the sibling map's precedent. The destination is
working behaviour, so `task` tickets build as well as decide.

**Vocabulary:** the root `CONTEXT.md` is the glossary. *Court*, *net change*,
*net buffer*, *pool*, *round*, *draw lock* are defined there. This effort adds
*turn*, *reservation* and *rest partner* — add them as they settle.

**Skills each session should consult:** `grilling` + `domain-modeling` for the
decision tickets, `diagnosing-bugs` for `01`, `tdd` for the solver changes —
the solver is pure and fully tested, which is the only reason this is safe to
rebuild.

**Before editing:** run a graphify query. `lib/schedule/*` is ~3,300 lines and
every phase reads the one before it.

### Measured during charting

Run against the real solver on synthetic tournaments; scripts were throwaway.
These are the facts the map is built on, not opinions:

- **More courts produce more back-to-back play.** Same tournament, only the
  court count changed: 6 courts → 12 back-to-back matches; 12 courts → 32.
  The mechanism is `poolplay.ts`: the rotation reports
  `optimalCourts = ⌊teams per pool ÷ 2⌋ × pools ÷ 2` but *uses*
  `poolsAtOnce = ⌊courts ÷ perPool⌋`. The **÷ 2 survives only in the number
  shown to the organizer, never in the number used**. Measured directly, every
  team in a division is on court simultaneously (8/8, 12/12, 16/16) unless the
  venue is too small to fit them — court shortage is the only thing creating
  rest today.
- **Pool play has no rest rule at all.** `assign.ts` hard-filters rest only for
  `!node.isPool`. For pool play rest is a price. So `restIsHard` — documented as
  *"never break the rest rule"* — does not protect pool play, and pool
  back-to-back never appears in the relaxation report. Measured: 48 back-to-back
  matches reported as `relaxations: (none)`.
- **The generator lowers its standards silently rather than saying the day is
  too short.** On a tournament the inventory calls `fits`, with 22 court-slots
  left empty, the ladder surrendered *every* promise it has including
  back-to-back. Widening the day 17:00 → 21:00 made every relaxation vanish. The
  real answer was "your day is 45 minutes short"; the organizer was given a
  worse schedule and no reason.
- **The venue runs 43–79% idle** on roomy events, rising with court count,
  because the endgame is almost entirely serial: finals one at a time on one
  court, semifinals one division at a time.
- **The tidy-up pass accepted zero improvements in every run.** It can only
  trade matches of identical length on the same court or the same net height, it
  never reaches past the morning (fixed budget, pairs visited in placement
  order), and it does not re-check rest — so it can undo a guarantee silently.
- **Unplaced matches with an idle venue: reproduced on real data by `01`.** No
  synthetic overflow showed it — every one had a genuinely full venue. On the
  organizer's actual tournament it reproduces on the first run, and the
  mechanism is *net-height scarcity in the last layer*: four matches ready at
  16:15, two needing 2.24 m, one court standing at 2.24 m, and no minutes left
  to absorb a net change. The day is long enough — the same venue on the same
  day places all 54 matches at a different net-change weight. `01` was the one
  ticket that could have redrawn this map; it did not.
- **The organizer's "lots of empty space" is their own lunch break, on this
  event.** `lunchStart 12:00` / `lunchEnd 15:30` cuts each 09:00–17:00 day to
  4½ playing hours. Day utilisation is 86% and 85%, so the 43–79% idle finding
  above describes roomy events and not this one. Stored configuration rather
  than a generator decision, and **worth putting to the organizer**: measured,
  a 13:00 lunch end makes the overflow disappear on its own.

### Settled during charting

Inputs to every ticket, not steps on the route:

- **A dedicated court is a reservation**, not a preference. During a division's
  turn those courts are its own and nobody else may use them. Today it is a
  hint costing 26 points, against 260 for a net change — ten times cheaper to
  break than the thing it exists to prevent.
- **Half a division's pools play, then the other half.** Restores the ÷ 2. A
  team gets at least one match-length of rest, by construction rather than by
  price. Affordable now in a way it was not when it was removed: the courts a
  resting half gives up are taken by *another division*, not left empty.
- **Divisions play concurrently**, each on its own reserved courts.
- **A turn is one round**, whatever that round's format — a round robin, a
  first round, a quarter-final. Not "the pool stage": a division may have no
  pool play at all. The data already carries this as `roundIndex`, and rounds
  are separate database rows with their own format and duration.
- **Divisions take turns, biggest first**, until a round finishes.
- **Reservations are for pool play only.** Reserving four courts for a
  two-match semifinal would strand the venue; the endgame uses what is free,
  governed by staging.
- **The finals programme stays as it is**: semifinals one division at a time,
  every division's 3rd-place play-off together, finals one at a time.
- **The endgame may run past the configured end time**, with no ceiling, and
  the overrun **blocks saving** until the organizer decides what to do.
- **A one-pool division plays flat out and is warned** that its rest cannot be
  guaranteed. Rare in practice, because a lone pool leaves courts another
  division fills.
- **The tidy-up (repair) pass is deleted**, not tuned.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [A round set up as "Pool Play" is not pool play to the solver](issues/06-pool-format-is-not-pool-play.md):
  **pool play is not a round format** — the pool count on the draw is what makes
  a round robin "pool play", so `'pool'` is deleted from the schema
  (migration 0010), the type and the label map, and **Round format** is added to
  `CONTEXT.md`. It was never reachable (no dropdown offered it, no row held it),
  so this was a latent hole, not the live defect the ticket measured. The hole
  was wider than `isPool`: "is this a group round?" was asked six ways and they
  disagreed — including in the **draw route**, where a `'pool'` round would have
  been *drawn* as a pure elimination bracket, not merely scheduled wrong. All six
  now go through `isGroupFormat` / `isKnockoutFormat`. No arrival-time validation
  guard: the format picker is the only way in. The **handover to the solver** is
  out of the schedule page and into `lib/schedule/schedulableDivisions.ts` with
  17 tests — every fact the generator gets passes through it and no later phase
  can tell it was handed a wrong one. Verified byte-identical against the old
  code on all four real tournaments, with identical solver placements.

- [Reproduce the unplaced match that had somewhere to go](issues/01-reproduce-unplaced-with-idle-venue.md):
  reproduced on the real tournament — Women Open's 3rd-place play-off is refused
  beside 45 free minutes because that court is rigged to the wrong net height
  and the change would run it past 17:00. The refusal is correct arithmetic; the
  trap was set three hours earlier by a cost function that prices a net change at
  **zero** during the finals programme (`cost.ts:182`). Neither of the ticket's
  two options: the venue was *idle*, not full, and none of its four suspects is
  the cause. **The map's shape is unchanged** — `03` and `08` are confirmed from
  a new direction, `09` gains a third question, and `11` is new.

- [Pool play is exempt from the rest rule, and invisible in the report](issues/05-pool-play-has-no-rest-rule.md):
  the back-to-backs were never invisible — they arrived **too late**. The
  validator already flags every zero-gap pair, pool included, but the page runs
  it over the *saved* matches and never over the preview, so a generate says
  nothing and the save that follows lights up 48 faults. Whiplash, not silence;
  and `preview.backToBack` is on screen already, just without the warning icon
  the line beside it gets. `restIsHard` and `minRestSlots` turn out to have **no
  control anywhere**, so the "organizer who declared rest non-negotiable" is a
  trap, not a live defect. **Rest is two-state**: a whole match between a team's
  matches, or none. `minRestSlots` already means *matches* and already defaults
  to 1 — the middle state is an artefact of multiplying it into minutes, and it
  goes everywhere, costing nothing on screen because all three rest numbers are
  shown to nobody. **Rest waits, it never refuses**: the knockout's filter defers
  a match rather than dropping it, so "just flag it" and "hold it back" are the
  same policy — the wait applies everywhere once turns exist, handed to `04`
  with the rule half, which cannot ship before `02` gives the resting half's
  courts to another division. This ticket keeps the **telling**, because it is
  how anyone will know whether the redesign worked: the preview runs the **full**
  validator (`10`'s shared-predicate precedent turned onto faults), which makes
  the complaint vanish as a side effect — 48 problems, no new rung, no change to
  placement. Only a genuine no-rest is a problem, on validate's measured reason
  that warning on every short gap buried the real ones. **Two lists stay two** —
  a given-up promise explains the event, a problem accuses a match — but at one
  volume; joining them by cause is `09`'s, which waited on this precisely to
  have pool problems to explain. The ladder loses the rung that could never
  fire. A faulted card keeps its red border as the permanent mark and **pulses
  only on arrival from the problem list** — 48 cards blinking is the wall of
  noise that stopped the short-gap warnings in the first place, and the one
  effect that breaks the page for motion sensitivity. *Rest*, *back-to-back*,
  *given-up promise* and *problem* added to `CONTEXT.md`, which had none of the
  four. Build is [`12`](issues/12-show-problems-before-you-save.md).

- [Restore "half the pools rest"](issues/02-half-the-pools-rest.md):
  restored, and it took **two** changes rather than the one the ticket
  specified — the cap alone scores *worse* than doing nothing (20 back-to-back
  → 24), because the pool rotation was never binding. `assign.ts` exempted pool
  waves from being held, so a turn that could not start whole fell through to
  the cost matcher and was placed out of turn, beside the turn already on court;
  narrowing the turns only gave the matcher more loose matches to scatter. One
  branch (`else if (wave.phase !== 'pool')` → `else`) makes the rotation mean
  something. **Not** the `!node.isPool` filter at `assign.ts:476` that `05`
  handed to `04` — different line, different mechanism, `04` still has its half.
  The ceiling is the organizer's own: **the most courts a division can be given
  while nobody plays back to back**, `⌊pools ÷ 2⌋ × ⌊teams per pool ÷ 2⌋`, and
  the **pairing is floored, not the product** — the old `⌊2 × 3 ÷ 2⌋ = 3` named
  a width the rotation can never run at, so three pools of four are comfortable
  at two courts exactly as two pools of four are. `poolsAtOnce` is now *derived*
  from `optimalCourts` rather than from the venue, so the ÷ 2 exists once and
  the two numbers cannot drift apart again — better than the Notes' "one of them
  should go". **The map's headline measurement no longer reproduces**: four
  pools of four at 4, 6, 8 and 12 courts all give back-to-back 0 and the same
  6-slot schedule. On the real tournament with the day widened so the ladder
  keeps `poolBlocks`, 12 back-to-back → **0**, and net changes 14 → 8 as a side
  effect. `men + women` on 8 courts already run **concurrently** at 4 each with
  back-to-back 0 — a piece of `04` arriving free. As configured the organizer's
  event is unchanged at 9, because the ladder discards `poolBlocks` before any
  of this can matter; that is `09`'s, neither fixed nor hidden. The idle venue
  the ÷ 2 was once deleted to fix is back and stays until `04`, with a test
  standing as the signpost. *Rotation ceiling* and *rest partner* added to
  `CONTEXT.md`; **`turn` deliberately not defined**, because the map already
  uses it for *one round* and this ticket's unit is the group *within* a round.

- [A dedicated court is a reservation, not a hint](issues/03-dedicated-court-is-a-reservation.md):
  a dedicated court is a **structural reservation** during pool play, not a soft
  cost. Enforced as a hard candidate filter in `assign.ts` so divisions stay on
  their own courts; `divisionSpread` is deleted from `cost.ts` for pool play.
  Idle courts may be borrowed only if net heights match (zero net changes).
  **Rotation appetite is the single source of truth** (`poolsAtOnce × perPool`),
  and any organizer override is bounded by `⌈pools ÷ 2⌉ × perPool` to protect the
  rest invariant; `autoDedicatedCourts` is deleted. Inside a turn, court underfill
  cannot occur by construction under `02`'s formula. Pool rounds run synchronously
  on reserved courts and release together at the turn handover, absorbing net
- [Show the problems before you save, and make rest two-state](issues/12-show-problems-before-you-save.md):
  the preview runs the full validator over working-state placements (`preview.assignments` merged with hand edits), surfacing faults before save. Rest is strictly two-state across solver and validator (`gap <= 0` is back-to-back, otherwise rested); removed artificial fractional deficit minutes (`restDeficitSlots`, `averageRestMinutes`, deficit cost). Collapsed ladder's two rest rungs into one final `backToBack` rung. Preview bar elevates back-to-back count to warning weight and places an interactive problem count next to it (matched in `editBar`). Clicking a problem opens a list that jumps directly to the target match card and pulses it for 1.5s, with full `prefers-reduced-motion` support.

## Not yet specified

- **What survives of the cost function.** If placement becomes turn-taking on
  reserved courts, most of the nine weights lose their job: division spread is
  replaced by reservation, pace by turns, court churn by both. Whether the cost
  function shrinks to a tie-break within a turn or disappears is not
  answerable until `02`, `03` and `04` are built and the shape is visible.
- **How a turn behaves across a day boundary.** A round that does not finish
  by the end of the day — does the turn resume tomorrow holding the same
  courts, or is it re-cut against the new day? Multi-day is where the current
  day-plan machinery lives, and turn-taking may replace it.
- **What happens when a round cannot fit its reserved courts in the time
  left.** Adjacent to the ladder question in `09` but not the same: `09` is
  about the whole event being too short, this is about one turn.
- **Minimising net changes as a placement rule rather than a price**, *during
  pool play*. The destination names it as a goal, and reservations plus
  handovers should make it mostly automatic — but "mostly" needs measuring once
  `03` and `04` land. The endgame half of this patch has graduated into
  [`11`](issues/11-net-change-is-free-in-the-endgame.md), where `01` measured
  it failing.
- **Whether the "rest is non-negotiable" switch survives at all.** `05` left it
  uncontrolled deliberately — a control on a switch that does not do what it
  claims ships the lie to more people. Under "rest waits, never refuses" there
  may be nothing left for it to mean, and the same goes for `minRestSlots` once
  rest is two-state with a threshold of one match. Answerable after `04`, when
  both are finally honest; the choice is then a control, or deletion.
- **Referee assignment** and **drift / live projection vs. hand edits** —
  inherited unchanged from the sibling map; neither has been examined.
- **Whether the feasibility verdict should count blocked periods** — inherited.
  It called this tournament `fits` while the generator broke every promise it
  had, so the verdict's honesty is now this map's problem too.

## Out of scope

- **Everything the sibling map ruled out** — pre-registration preview,
  placeholder teams, staggered lunch, carrying placements across a redraw, the
  public schedule view, the scorekeeper screen, setup-page readiness checks.
- **The sibling map's four open tickets** — mobile same-time court swap,
  splitting the schedule page, draw lock as a rule, organizer pinning. They
  belong to legibility, not to placement quality.
- **The grid's display** — axis, density, court columns, day sections. All
  settled by the sibling map; this effort changes what is placed, never how it
  is drawn.
