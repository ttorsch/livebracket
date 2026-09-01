# A net change must not eat the start of a day

Type: task
Status: resolved
Blocked by: —

## Question

Courts start late for a net change that nobody has to make during play.

On Test Tournament the venue opens at 09:00, and: Court 4 starts at 09:15 on
day 1, and **every** court starts at 09:15 on day 2. Fifteen minutes is exactly
`netBufferMinutes`. Reproduced in isolation — two 2.43 m divisions and one
2.24 m, two pools each, 4 courts, 09:00–17:00 — and it goes away entirely with
`netBufferMinutes: 0`, so the buffer is the whole cause. The repro is committed
beside this ticket — run it before changing anything, and again after:

```
node --experimental-strip-types .scratch/schedule-generator/assets/14-net-buffer-repro.ts
```

Re-run after [Lunch stops play on every court](01-lunch-stops-play.md) landed:
the symptom is unchanged, so the day-run split is not involved.

Two places charge it wrongly, both the same mistake:

1. **Before the event has started.** `generate.ts:160-182` seeds each court with
   the net height of the division whose affinity claims it — deliberately, so
   straying onto another division's court costs a net change "from the first
   slot". But `assign.ts:optionFor` implements that cost as *real court time in
   front of the match* (`startAbs = slot.abs + buffer`), so a Men's match in the
   09:00 slot on the Women's court starts at 09:15. Instrumented and confirmed:
   at day 0, slot 09:00, `court.height` is already 2.24 against a 2.43 match,
   before a single placement.
2. **Across the overnight break.** `courts[].height` is one running scalar for
   the whole event and is never reset per day, so the first match of day 2 pays
   for a change that had all night to happen.

The seeding comment argues the case against itself: *"nets are set in the
morning, not mid-match"*. Exactly — so at a court's first match of a day there
is no play time to lose.

What this ticket has to decide and do:

1. Separate the two things the buffer currently is: a **preference penalty**
   (keep divisions on their own courts) and **elapsed court time** (a net really
   does take fifteen minutes mid-day). Decide whether the seeded height should
   stay a cost-function term only — `cost.ts:331-336` already scores net pivots
   separately — while `optionFor` charges time only against a *real* preceding
   match on that court that day.
2. Reset, or don't consult, `courts[].height` at a day boundary.
3. Confirm the affinity clustering the seeding was protecting still holds once
   the buffer stops being charged at 09:00. That was its stated purpose, and a
   fix that scatters divisions across courts has traded one defect for another.
4. `pivots` in `ScheduleResult` counts net changes and feeds the diagnostics;
   decide whether a start-of-day rig still counts as one.

Done when every court's first match of every day starts at `config.startTime`
unless something real — a blocked period, lunch, or nothing left to place —
stops it, and divisions are still clustered onto their own courts.

## Notes

Surfaced by [Anchor the grid's time axis to the configured day](02-anchor-grid-time-axis.md).
The old grid anchored each day to its earliest match, so a court that started
late simply looked like the top of the day and the defect was invisible. This is
the second half of the map's destination clause *"the day starts when the config
says it starts"* — `02` fixed the view's half of it.

## Resolution

**The buffer was never a flat charge; it is a wait.** Both reported symptoms are
one mistake — court time charged for a net change nobody is waiting through —
and both fall out of a single rule in `optionFor`:

```ts
startAbs = mustMoveNow ? Math.max(slot.abs, previous.endAbs + buffer) : slot.abs;
```

The crew starts when the court frees; only what runs past the slot delays play.
With no predecessor `previous.endAbs` is `-Infinity`, so the max is the slot and
the morning rig is free. **The day boundary needs no special case of its own** —
that is item 2's answer, and it is why `courts[].height` is *not* reset (item 2's
other option). Resetting it would have been wrong: the scalar is the physical
state of the net, and the net really is still at yesterday's height at 09:00.

**The two things the buffer was are now separate, and only one moved** (item 1):

- **Preference** — `netChange` still reads the running `court.height`, seeding
  included, so straying onto another division's court is still discouraged at
  09:00 on day 1. `cost.ts` is untouched.
- **Elapsed court time** — charged only against a real predecessor on that
  court *that day*.

An idle gap now absorbs the change, which is the same defect in a third guise:
a net moved during a two-hour gap costs nobody anything, and the old code
charged fifteen minutes for it.

**A division with no declared height does not move the net.** `precedingOn`
therefore reads its two halves from different matches: the court frees when the
*last* match ends, but the height is the last one that *declared* one. Reading
both off the immediately-preceding match would have let a null-height division
mask the height behind it and silently skip a real change.

**Item 3 — clustering holds.** On the repro's shape the fix changes neither
`pivots` (11 both ways) nor placement count (45, nothing unplaced, no
relaxations); the day gets *tighter* (latest start 15:00 → 14:45). The existing
`pivots <= 2` affinity test still passes and a third new test pins it.

**Item 4 — a start-of-day rig still counts as a pivot.** No change to
`cost.ts`. Someone does move that net; what this ticket changed is only whether
it costs *play* time. The page's "N net changes" diagnostic
(`page.tsx:1908`) stays honest, and `placementCost`/`evaluate` still agree, so
the repair pass has nothing to undo.

**Verified.** The committed repro goes from 3 late courts to 0 (and `netBuffer:
0` is unchanged, so nothing else moved). 200 tests pass, `tsc --noEmit` clean,
eslint clean on both touched files. Three new tests in a `net changes` block,
each checked to fail on the code it replaces:

- *never charges a net change against the first match of a court-day* — red on
  the old code (`men-B-23 opens Court 4 on day 1`). Asserts `startAbs ===
  slot.abs` for the first match of every court-day, which is the rule itself.
  It needs the repro's pool shape: `makeDivision` builds one flat round-robin
  and the defect does not appear.
- *still charges a net change that a match is actually waiting for* — red when
  the buffer is forced to 0, so it guards the over-correction.
- *keeps divisions on their own courts…* — item 3, locked.

Not a regression, and left alone: **pins never pay the buffer at all**
(`startAbs: slot.abs`, `netChange: false`, `assign.ts:297-307`) and nothing
reports it. Raised as [Should a hand-placed match pay for a net
change?](16-pinned-net-change.md).

Files: `lib/schedule/assign.ts` (`precedingOn` added, `optionFor` rewritten),
`lib/schedule/generate.test.ts`.
