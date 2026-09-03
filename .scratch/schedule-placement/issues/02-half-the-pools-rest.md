# Restore "half the pools rest"

Type: task
Status: resolved
Blocked by: — (was 06, now resolved)

## Question

`poolplay.ts` computes the court count a division is comfortable at:

```
optimalCourts = ⌊teams per pool ÷ 2⌋ × pools ÷ 2
```

That trailing **÷ 2** is the whole back-to-back guarantee: half the pools on
court, half resting. It is reported to the organizer and **never used**. The
number actually used is:

```
poolsAtOnce = max(1, min(poolCount, ⌊courts ÷ perPool⌋))
```

which takes as many pools as the courts will hold. Measured: 8/8, 12/12 and
16/16 teams on court at once. The only thing that ever creates rest today is
the venue being too small.

The change is to cap `poolsAtOnce` so the rotation always splits into **at
least two groups**, i.e. `poolsAtOnce ≤ ⌈poolCount ÷ 2⌉`. Odd counts fall out
correctly without a special case: 3 pools becomes {A,B} then {C}, and every
team still gets a full turn off.

The comment above the current line records why the ÷ 2 was removed — on a
four-court venue a division wanting two courts left two standing empty. That
reasoning was sound and is now obsolete: under `03` and `04` the courts a
resting half gives up are taken by another division. **Restoring the ÷ 2
without `03` and `04` would reintroduce exactly the idle venue it was deleted
to fix**, which is why this ticket is worthless alone and why the map's
destination is all three together.

Settled: the rule is half and half. Open here is only how it is expressed, and
what the reported `optimalCourts` becomes once the two numbers agree.

## Notes

`optimalCourts` is currently used for wave ordering and for the organizer's
"what your draw wants" display. Once the two numbers agree, one of them should
go — two names for one quantity is how they drifted apart.

### Unblocked by `06` — and the blocking rationale was void

`06` is resolved, so this is takeable. But it did not resolve the way this
ticket assumed, and the difference matters:

- **The blocker was never real.** This ticket was blocked on the theory that
  divisions configured as `'pool'` never reached the rotation, so a rotation
  rule would not apply to them. `06` found that **nothing ever wrote that
  format** — no dropdown offered it, no row held it. There were no such
  divisions. The hole was latent, not live, and it is now closed by deletion
  (migration `0010_drop_pool_round_format.sql`).
- **The inputs moved.** The handover from page to solver is no longer inline in
  `app/dashboard/tournament/[id]/schedule/page.tsx`; it is
  `lib/schedule/schedulableDivisions.ts`, with 17 tests. `isPool`, `pool` and
  `pools` are all derived there, and `pools` now falls back to **1** when no
  draw exists. Read that module before changing the rotation — it is where the
  rotation's inputs are decided, and `10` (a one-pool division cannot rest) now
  has a second way to be reached through that fallback.
- **Pool play is the draw's pool count, not a format.** `06` settled this in
  `CONTEXT.md`: one pool is a round robin, four pools is pool play, both are
  `'round-robin'`. So this ticket's "half the pools" is a statement about the
  *draw*, and a division can arrive with a pool count of 1 through the fallback
  above as well as through the organizer's choice.

### What `05` handed this ticket

`05` resolved that **rest is two-state** — a whole match between a team's
matches, or none — and that **rest waits, it never refuses**: the knockout's
filter defers a match rather than dropping it. It handed the rule itself to
`04`, explicitly noting that `04` *"cannot ship before `02` gives the resting
half's courts to another division."*

So this ticket is now on the critical path for two others, and the ÷ 2 is no
longer only about back-to-back — it is what makes `04`'s waiting rule
affordable. `05` also found `restIsHard` and `minRestSlots` have no control
anywhere today, so do not treat either as a live input when restoring the rule.

---

## Answer

Restored, and it needed **two** changes rather than the one the ticket
specified. The cap alone is a regression.

### The ceiling, and what it is a ceiling on

`optimalCourts` is **the most courts a division can be given while no team
plays back to back**. A ceiling, not a target: fewer is always safe and simply
takes longer, more can only be filled by putting the resting half back on court.
The organizer's derivation, confirmed against their own worked examples —

```
optimalCourts = ⌊poolCount ÷ 2⌋ × ⌊teams per pool ÷ 2⌋
```

| division | ⌊teams/2⌋ | pools | optimal |
|---|---|---|---|
| 2 pools of ≤3 | 1 | 2 | 1 |
| 4 pools of ≤3 | 1 | 4 | 2 |
| 2 pools of 4 | 2 | 2 | 2 |
| 4 pools of 4 | 2 | 4 | 4 |

**The pairing is floored, not the product.** The old arithmetic halved the
product — `⌊2 × 3 ÷ 2⌋ = 3` for three pools of four — and three courts is a
width the rotation can never run at, because pools are taken whole and each
wants two. Three pools make one pair and a spare; the spare joins the rotation
rather than earning courts of its own, so **three pools of four are comfortable
at two courts, exactly as two pools of four are**. Decided against rounding up:
the organizer's rule is a ceiling on courts, and 4 would give an odd division
courts it only half fills.

### `poolsAtOnce` is now derived from the ceiling, not from the venue

Rather than restating the ÷ 2 as a second cap — which is how the two numbers
drifted apart in the first place — the courts are clamped before dividing:

```ts
const usable = Math.min(courts, optimalCourts);
const fit = Math.max(1, Math.floor(usable / perPool));
```

The ÷ 2 now exists in exactly one place and `poolsAtOnce` reads it. They cannot
disagree, because one is computed from the other. The ticket's Notes asked for
one of the two names to go; this is better — they stop being two numbers.

### The cap alone makes it worse: the rotation was advisory

Measured on four pools of four, six courts:

| | busiest | back-to-back |
|---|---|---|
| baseline | 6/6 | 20 |
| **the cap alone, as this ticket specified it** | 6/6 | **24** |
| cap + turns held | 4/6 | **0** |

`assign.ts` exempted pool waves from being held: a turn that could not start as
a whole unit was **not** held back, so its matches fell through to the general
cost matcher and were placed out of turn, beside the turn already on court.

```ts
} else if (wave.phase !== 'pool') {   // ← pool waves were not held
```

So the rotation was a *hint*. Narrowing the turns without holding them only
handed the matcher more loose matches to scatter — which is why the cap alone
scores worse than doing nothing. The fix is that branch becoming `else`.

**This is not the `!node.isPool` rest filter at `assign.ts:476`** that `05`
handed to `04`. Different line, different mechanism: that one is about rest as a
hard constraint, this one is about whether a *turn* is placed as a unit. `04`
still has its half to do.

### Verified

- **270 tests pass**, `tsc` and `eslint` clean.
- **"More courts produce more back-to-back play" is gone.** Four pools of four
  at 4, 6, 8 and 12 courts now all give back-to-back 0 and the *same* 6-slot
  schedule. The map's headline measurement no longer reproduces.
- **Real tournament, day widened so the ladder keeps `poolBlocks`**: baseline
  12 back-to-back, now **0**; net changes 14 → 8 as a side effect, because a
  division stops straying off its own courts.
- **`men + women` on 8 courts** already run concurrently at 4 courts each with
  back-to-back 0 — the concurrency `04` is for, arriving early and for free.
- **One-pool division unchanged**: back-to-back 8, width unchanged. Unavoidable
  and `10`'s to warn about; the ceiling does not slow it down.

### The cost, and it is real

A division alone on a venue wider than its ceiling now leaves courts standing —
four pools of four on six courts uses four, all round robin. That is the idle
venue the ÷ 2 was deleted to fix, and it stays idle until `04` puts another
division on it. The test
`leaves the courts past its ceiling standing, for another division to take` is
the signpost, and names `04` as the ticket that must change it.

### On the organizer's tournament as configured, this changes nothing

Back-to-back stays 9. The ladder gives up `poolBlocks` — and with it the whole
rotation — before either change can matter, because the day is genuinely too
short. Neither fixed nor hidden by this ticket; handed to `09`.

### Vocabulary

*Rotation ceiling* and *rest partner* added to `CONTEXT.md`. **`turn` was
deliberately not defined**: the map and `04` already settle it as *one round*,
whereas the unit this ticket makes binding is the group of pools *within* a
round, which the code calls a wave. Two different things, and one word for both
would be the `optimalCourts`/`poolsAtOnce` mistake again. Noted on `04`.

### Files

- `lib/schedule/poolplay.ts` — the ceiling, the derivation, and the header
  comment that argued for the deleted rule.
- `lib/schedule/assign.ts` — one branch: pool turns are held like any other wave.
- `lib/schedule/generate.test.ts` — three tests added, two inverted.
