# Reproduce the unplaced match that had somewhere to go

Type: task
Status: resolved
Blocked by: —

## Question

The organizer reports: *"there is an unscheduled match, and the time shown will
fit, but still there is some match unscheduled. Also, there is a lot of empty
space."*

Charting reproduced the **empty space** conclusively (43–79% of the venue idle
on roomy events) and the **back-to-back** half conclusively. It did **not**
reproduce unplaced matches beside an idle venue: every synthetic overflow had a
genuinely full venue, where refusing to place is the correct answer.

So one of these is true, and the map's shape depends on which:

1. The idle space and the unplaced match are the *same* symptom seen twice —
   the venue was full at the moment the match was ready and idle later, which
   is what a serial endgame looks like. Then `02`–`04` fix it and this ticket
   closes as a duplicate.
2. There is a distinct placement bug that only real data triggers — an uneven
   pool, a per-round duration that does not divide the slot, a blocked period,
   an off-event day, a bye that still reserves a court.

Resolve by running the generator against the organizer's actual tournament and
reporting which. Get the tournament by slug and drive `generateSchedule` with
the same divisions the schedule page builds, then compare `overflow` against
the free court-slots at each unplaced match's earliest ready time.

## Notes

Suspects worth checking first, all found while charting but none proven to
cause an overflow:

- `page.tsx:866` sets `isPool: r.format === 'round-robin'`, so a round the
  organizer configured as **Pool Play** (`format: 'pool'`, labelled "Pool Play"
  in their own dropdown) is not pool play to the solver. That is `06`.
- A match whose `durationMinutes` does not divide the grid resolution spans an
  extra slot and can fail `courtOpen` near a lunch break or the end of a day.
- `restIsHard` builds a shorter ladder, so matches overflow rather than
  relaxing. Measured as safe on synthetic data, but only there.

## Answer

**Reproduced on the real tournament, first run. It is neither of the two
options as written — and it does not change the map's shape. It confirms it.**

Harness: [`assets/01-real-tournament-repro.ts`](../assets/01-real-tournament-repro.ts),
driving `getTournamentDetail` → `toSchedulableDivisions` → `generateSchedule`,
exactly as the schedule screen does.

```
node --experimental-strip-types \
  --import ./.scratch/schedule-placement/assets/_ts-resolve.mjs \
  --env-file=.env.local \
  .scratch/schedule-placement/assets/01-real-tournament-repro.ts
```

### What happens

Test Tournament, 3 divisions × 18 schedulable matches = 54. **53 placed, 1
overflowed**: Women Open's 3rd-place play-off (2.24 m, 45 min).

Its two semifinals end at 12:00 and 16:15 on day 1, so it is ready at 16:15.
The last layer of day 1 looks like this:

```
       Court 1        Court 2         Court 3        Court 4
15:30  Men/r2  2.43   Women/r2 2.24   Mixed/r3 2.43  Mixed/r4 2.43
16:15  Men/r3  2.43   Women/r3 2.24   Men/r4   2.43    .            <- 45 free minutes
```

The organizer is **right**: Court 4 is free from 16:15 to 17:00, which is
exactly the 45 minutes the match needs. What they cannot see is that Court 4 is
rigged to 2.43 m, because Mixed Open's play-off just finished on it. The match
needs 2.24 m, the net change takes 10 minutes, so it would run **16:25–17:10** —
past the 17:00 end of the last day. The refusal is arithmetically correct
(`assign.ts:555-560`: the buffer is charged as real elapsed minutes, not rounded
onto the slot lattice).

Measured, one variable at a time
([`assets/01-variants.ts`](../assets/01-variants.ts)):

| change | overflow |
|---|---|
| baseline | 1 |
| `netBufferMinutes: 0` | **0** |
| `netBufferMinutes: 5` | 1 (16:20–17:05, still past) |
| `endTime: 17:15` | **0** |
| `stageFinals: false` / `finalsOnLastDay: false` / either `dayPlan` / any `repairIterations` | 1 (or 3) |

### Which of the two options

**Option 1 is false as stated.** The venue was *not* full at the moment the
match was ready. There were 45 free minutes on a court, and idle time later is
not the explanation.

**Option 2 has the right shape — a distinct failure only real data triggers —
but none of the four suspects it named is the cause.** All four check out clean
on this tournament:

- **Byes**: dropped correctly — 18 schedulable per division, not 20.
- **Duration vs. slot**: structurally impossible. `slotMinutes` is *derived* as
  the largest step dividing every declared length (here 15, from 30 and 45), so
  a duration that does not divide it cannot exist.
- **`isPool`**: correct. The rounds are `round-robin`, which both the old
  comparison and the new `isGroupFormat` read as pool play — **`06` was never
  triggered by this data**.
- **Blocked periods**: the config's seven stale `Net Adjust` blocks are filtered
  and regenerated (`generate.ts`), not accumulated.

The actual cause is a third thing: **net-height scarcity in the last layer.**
Four matches are ready at 16:15 and two of them need 2.24 m, but only one court
is standing at 2.24 m. One of the two must eat a net change, and at the end of
the last day there are no minutes left to absorb it.

### The trap is set upstream, and it is avoidable

`assign.ts:230` is a single forward pass over `grid.slots`, placing only the
matches ready *at* that slot by minimum-cost assignment. It never asks what net
heights it will need two layers from now, and it does not backtrack. So the
15:30 layer leaves three courts at 2.43 m without knowing that two 2.24 m
matches fall due at 16:15.

That the day is long enough is provable: with `netChange` weighted 1000 instead
of its default 260 (`types.ts:76`), the **same venue, same day, same lunch
places all 54** — and with *fewer* back-to-back matches, 6 against 9
([`assets/01-compare.ts`](../assets/01-compare.ts)). Nothing about the event is
too small. The default pricing simply walks into a corner it cannot leave.

And the pricing has a specific hole. `cost.ts:182`:

```ts
if (netChange && !staged) cost += w.netChange;
```

A net change is **free during the finals programme**. The comment states the
reasoning and the safeguard: an organizer will happily re-rig a net to get both
semifinals side by side, and *"the buffer a net change costs in minutes is still
charged, by the caller, as real court time"*. That safeguard is exactly what
fails here — the minutes are charged against a day that has none left, so the
match is refused rather than delayed. **The exemption assumes there is always
room to absorb the buffer.** At 16:15 on the last day there is not. This is now
[`11`](./11-net-change-is-free-in-the-endgame.md).

### What the organizer actually experiences

Two separate things, and only one of them is the generator's fault.

1. **The unplaced match.** `overflow` is `{ matchId, divisionId }` — a bare id,
   no reason. The organizer sees a missing match beside 45 minutes of visibly
   empty court and concludes the app is broken. It is not; it simply never says
   *"Court 4 is at 2.43 m and the net change leaves 35 minutes, not 45."* That
   report is `09`'s question one rung down, so `09` has been amended rather
   than a new ticket cut.
2. **"A lot of empty space."** Day utilisation is 86% and 85% — this event is
   not roomy, and charting's 43–79% idle finding does not describe it. The
   empty space is the **lunch break: `lunchStart 12:00`, `lunchEnd 15:30`**, a
   3½-hour stop that cuts each 09:00–17:00 day to 4½ playing hours (270
   playable minutes per court). That is stored configuration, not a generator
   decision. **Worth putting to the organizer** — if that is a typo, the
   overflow disappears on its own (measured: `lunchEnd 13:00` → 0 overflow).

### Effect on the map

**None structurally.** `01` was the one ticket that could still redraw the map;
it does not. It confirms two settled positions from a new direction:

- **`03` — a dedicated court is a reservation.** All three divisions are
  configured `dedicatedCourts: 2` on a 4-court venue. Had Women Open's courts
  actually been reserved to it, a 2.24 m court would have been standing at
  16:15 and the play-off would have fitted.
- **`08` — the endgame may run past the end time.** This is the cleanest fix
  for *this* match: under `08` it runs 16:25–17:10 and the organizer is asked
  to accept a ten-minute overrun instead of being handed a mystery.

Note that `02`–`04` do **not** fix this: the map has already settled that
reservations are for pool play only and the endgame uses what is free. The
endgame stays net-scarce under turn-taking, which is why `11` is its own ticket.

No source was changed by this ticket, so there is no regression test to write.
The seam for one exists — the solver is pure and `lib/schedule/generate.test.ts`
already drives it directly — and whoever takes `08` or `11` should lock this
scenario down there.
