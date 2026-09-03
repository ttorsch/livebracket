# A dedicated court is a reservation, not a hint

Type: task
Status: resolved
Assignee: Antigravity
Blocked by: —

## Question

*Dedicated courts* is the organizer's mechanism for keeping a division on its
own courts, and today it is a **preference worth 26 points**. A net change
costs 260. So the generator will move a division off its own courts ten times
sooner than it will move a net — the exact inversion of what the setting is
for.

Settled: during a division's turn, its reserved courts are **its own**, and no
other division may be placed on them.

What this ticket decides is the shape of the reservation:

1. **Where it is enforced.** Legality lives in `assign.ts`, preference in
   `cost.ts`. A reservation is legality, so `divisionSpread` stops being a
   weight and becomes a filter on the candidate set. That is a one-way door for
   the cost function and should be taken deliberately.
2. **How many courts a division reserves.** Three sources disagree today:
   the organizer's override, the rotation's appetite (`poolsAtOnce × perPool`),
   and `autoDedicatedCourts(pools) = ⌈pools ÷ 2⌉`. After `02` the rotation's
   number is the true one; the other two need to defer to it or be deleted.
3. **What happens to a court a division reserves but cannot fill.** A division
   reserving four courts for a round with three matches leaves one idle. Is the
   reservation the *right* to the court, or the *use* of it?
4. **When the reservation is released.** `04` says "when the round finishes",
   but a round finishes court by court. Released per court as it frees, or all
   at once at the handover?

## Notes

`courtAffinity` in `dayplan.ts` currently has three branches (a gender-cohort
branch, a fits-concurrently branch, a wave branch) that allocate overlapping
court sets by cursor rotation. Under a reservation model at most one of those
survives.

---

## Answer

A dedicated court is a **structural reservation** during pool play, not a soft cost.

### 1. Where it is enforced: Legality in `assign.ts`
- Reservations are a hard candidate filter during pool play. A match from a division in pool play can only be placed on that division's reserved courts.
- No other division may be placed on those reserved courts, with one strict exception for venue efficiency: an idle court may only be borrowed by another ready match if they share the **exact same net height** (zero net changes).
- `divisionSpread` in `cost.ts` is eliminated for pool play because cross-court contamination is illegal by definition.
- In the endgame (knockouts and medal rounds), reservations cease and matches use whatever courts are free, governed by staging.

### 2. Court count calculation
- **Single source of truth**: The rotation appetite (`poolsAtOnce × perPool`), where `poolsAtOnce = max(1, min(⌈poolCount ÷ 2⌉, ⌊courts ÷ perPool⌋))`.
- **Organizer override**: An explicit `dedicatedCourts` setting is honoured up to `⌈poolCount ÷ 2⌉ × perPool` (bounded by the rest invariant to prevent an override from forcing 100% of teams on court simultaneously).
- `autoDedicatedCourts` is deleted as redundant/divergent arithmetic.

### 3. Idle court underfill inside a turn
- Under `02`'s formula (`optimalCourts = ⌈pools ÷ 2⌉ × perPool`), every pool in the active half produces `perPool` matches per slot. The division fills 100% of its reserved courts in every slot of its turn. Inside a turn, court underfill cannot occur by construction.

### 4. Release and Handover
- In planned schedule generation, all matches within a pool round have identical durations and start on the same slot, so courts naturally finish and release simultaneously.
- At the end of the turn (when the pool round/stage finishes), the reservation is released and the entire block of courts is handed over together to the incoming division (or the open endgame pool). Net changes happen simultaneously during this handover buffer.

### Vocabulary
*Reservation* and *Handover* added to the root `CONTEXT.md`.
