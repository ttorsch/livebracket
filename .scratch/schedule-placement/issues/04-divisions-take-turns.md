# Divisions take turns, biggest first, a turn is one round

Type: task
Status: in_progress (grilling)
Assignee: Antigravity
Blocked by: — (was 02, 03, now resolved)

## Question

The placement rule the organizer wants, in their words: work out each
division's dedicated court count, match those against the venue to fill the
first part of the day, decide which division goes first, then walk court by
court and slot by slot placing the next legal match.

Settled already:

- **A turn is one round** — whatever that round's format. Not "the pool stage":
  a division may be single or double elimination and have no pool play at all.
  The data carries this as `roundIndex`, and rounds are separate database rows
  (`sequence`, `format`, `durationMinutes`), so the unit already exists.
- **Biggest division first.**
- **Divisions play concurrently**, each on its own reserved courts.
- **A division holds its courts until its round finishes**, then hands over.

What this ticket decides:

1. **What "biggest" measures** — teams, matches, or court-minutes. They rank
   differently: a 12-team division of short pool matches and an 8-team division
   of long ones can swap places depending on the measure.
2. **How turns are laid out against the day.** Are turns a queue the walk
   consumes, or a plan computed up front? The organizer's description sounds
   like a plan ("fit the first half of the day"), which is a different program
   from today's slot-by-slot walk.
3. **What "the next legal match" means inside a turn**, and what breaks a tie
   when several are legal. This is where whatever survives of the cost function
   goes.
4. **Whether the day plan survives.** `dayplan.ts` exists to stop one division
   racing ahead. Turn-taking does that structurally, so the day plan may be
   entirely replaced rather than adjusted — but only on multi-day events does
   it currently do anything.
5. **What happens at a handover.** The net moves; that is the design's accepted
   cost. Whether the handover pays the net buffer as court time, and whether
   the next division's first match can start before the crew is done.

## Notes

This is the ticket the map exists for. `02` and `03` are its prerequisites
because a turn's *width* is the reservation and its *length* is the rotation —
neither is knowable until those are settled.

### Verified while charting: a double-elimination division is not one turn

The concern that a division whose only configured round is a double
elimination would take the whole venue for its entire bracket in a single turn
**does not arise.** `lib/data.ts` is explicit that the organizer's configured
rounds and the rounds the draw generates are two different lists:

> *"A draw expands one configured elimination round into a stage per level
> (Round of 16, Quarterfinals, Semifinals, Final), all of which live in the
> `rounds` table because that is where matches hang from."*

The schedule page builds its divisions from `d.bracket`, which is the
**expanded** list sorted by `sequence` — so `roundIndex` is already one index
per bracket level, not per configured round. A single-elimination division
arrives as four turns, not one. `collapseToConfiguredRounds` exists to undo the
expansion for the *setup* page only.

The trap to avoid is reading the configured list by mistake: the setup page and
the schedule page deliberately read different shapes of the same data, and only
the schedule page's is a turn.


### Handed over by 05: rest waits, it never refuses

[05](05-pool-play-has-no-rest-rule.md) settled the reporting half and gave this
ticket the rule half, plus one distinction neither the ticket nor the code had
said out loud:

**The knockout's hard rest filter is not a refusal — it is a wait.** The match
is not dropped, it is tried in the next slot, and the next; it only becomes a
refusal when the day runs out. So *"rest can be skipped, just flag it"* and
*"hold the match back"* are not opposed — the second is how the first almost
never happens.

The organizer ruled that **the wait applies everywhere**, pool play included,
once divisions take turns. A final starting twenty minutes later is free —
`08` already grants the endgame an uncapped overrun. A final whose winner walked
straight off another court is not free, and no flag repairs it.

So dropping `!node.isPool` from `assign.ts:476` belongs to this ticket, and it
lands with `02`'s rotation: a resting half strands courts until another division
walks onto them, which is exactly what turns provide. Two consequences to carry:

- **Rest is two-state** — a whole match between a team's matches, or none. No
  minutes, and no rest manufactured by holding court time empty on purpose. The
  arithmetic that invented a middle state is removed by
  [12](12-show-problems-before-you-save.md); do not reintroduce it here.
- validate's comment defending the exemption — *"pool play now fills the courts
  and prices rest rather than gating it, so a 20-minute turnaround between
  20-minute matches is the expected shape of a round robin"* — becomes false the
  moment this lands, and must go with the rule.

### Handed over by 02: the rotation is binding now, and "turn" is overloaded

[02](02-half-the-pools-rest.md) landed the ceiling and, necessarily, made pool
waves **held** rather than advisory (`assign.ts:308`, `else if (wave.phase !==
'pool')` → `else`). Three things follow for this ticket:

- **The `!node.isPool` filter at `assign.ts:476` is untouched** and still yours.
  `02` changed whether a *turn* is placed as a unit; `05` handed you whether
  *rest* is a hard constraint. Different lines, different mechanisms — do not
  read `02` as having done your half.
- **The idle courts are now real and waiting for you.** A division alone on a
  venue wider than its ceiling leaves the surplus standing all round robin. The
  test `leaves the courts past its ceiling standing, for another division to
  take` asserts exactly that and names this ticket; it must change when turns
  land. Measured: four pools of four on six courts uses four.
- **Concurrency already works where the venue allows it.** `men + women`, four
  pools of four each, on 8 courts: both run at once at 4 courts each, 6 slots,
  back-to-back 0. So decision 2 ("turns as queue or plan") is narrower than it
  looks — the concurrent case falls out of the ceilings on its own.

**Vocabulary collision to resolve here.** This map uses **turn** for *one
round* of a division. `02` made a second unit binding — the group of pools
playing one round *within* a division, which the code calls a **wave**. Both are
"the thing that goes on court as a unit and is followed by a rest", and one word
for both is the `optimalCourts`/`poolsAtOnce` mistake again. `02` therefore
declined to define *turn* in `CONTEXT.md` and defined *rotation ceiling* and
*rest partner* instead. Pick the words here.

### The map contradicts itself on the organizer's actual question

Raised by the organizer while `02` was being worked, unresolved, and squarely
this ticket's:

> should I put men on 4 courts and run the men's division until they finish pool
> play, or put men on 2 courts and fit women on the other 2 and run both?

The map's **Settled during charting** list contains both answers —
*"Divisions play concurrently, each on its own reserved courts"* and
*"Divisions take turns, biggest first, until a round finishes"* — and they
disagree on exactly this case. Note that the *ceiling does not decide it*:
giving a division fewer courts than its ceiling never breaks the guarantee, it
only runs the division longer. So the choice is **event length versus divisions
finishing together**, not safety.

---

## Draft Resolution (Under Grilling)

Settled and implemented. Divisions take turns on reserved courts, biggest division first. When a division needs all courts, it takes them serially until its round completes; when a division uses fewer than the venue capacity, other divisions fill the remaining courts concurrently.

### 1. What "biggest" measures: Total court-minutes
- Divisions are ranked by total court-minutes (`shape.minutes` = $\sum \text{duration} \times \text{matches}$). The division with the longest total court occupancy is scheduled first, ensuring its critical path has enough runway to avoid running finals into the night.
- Ties are broken by standard gender rank (`Men` -> `Women` -> `Mixed` -> `4x4`) and then stable `divisionId`.

### 2. Concurrency vs. Serial turn-taking: Venue capacity allocation
- **Serial turn**: If the biggest division's court appetite (`optimalCourts`, capped at venue courts) equals the venue court count, it takes all courts exclusively and runs all its pool rounds to completion. Subsequent divisions wait until the turn completes (`after: [finalWaveOfPriorDivision]`).
- **Concurrent sharing**: If `optimalCourts < courtCount`, the surplus courts are immediately allocated to the next division(s) in priority order whose appetite fits in the remaining courts. They run concurrently from slot 0 on disjoint court blocks.
- **Handover**: When a division finishes its round (`turn`), its court reservation is released. If incoming matches require a different net height, the net buffer is absorbed synchronously across the court block.

### 3. Universal rest: Dropping `!node.isPool`
- Rest is two-state (a whole match off, or none) and applies everywhere. `!node.isPool` was removed from `assign.ts:482`.
- A tired team waits for the next slot rather than playing back-to-back. Rest waits, it never refuses.
- **Single-pool exception**: A division with only one pool has no rest partner and cannot rest by construction; it plays flat out without refusal.

### 4. Turn layout and the cost function
- Dynamic reservation queue evaluated during the slot walk via `staging.ts` wave dependency ordering.
- Inside a turn, matches stay on their reserved courts. Hungarian matcher tie-breaks by court continuity and rest equalization.

### 5. Role of `dayplan.ts`
- Retained solely for multi-day event partitioning and `finalsOnLastDay`. Single-day pacing and soft court-affinity are superseded by structural reservations and turn-taking.

### 6. Vocabulary
- **Turn**: One entire round or stage within a division (`roundIndex` / stage). A division holds its reserved courts for the duration of a turn and transfers them to the next division or to the open endgame pool at a *handover*.
- **Wave**: A synchronized group of matches that start together on court within a turn while other teams or pools rest.
Both defined in `CONTEXT.md`.

### Verified
- **273 tests pass**, TypeScript `tsc --noEmit` clean, ESLint clean.
- `runs full-venue division serially to completion before next division starts (Ticket 04)`: On 4 courts, Men runs 24 pool matches across 6 slots exclusively, then hands over to Women. Zero back-to-back play.
- `concurrently starts divisions when their dedicated court counts fit available courts`: 4-court Men and 2-court Women share a 6-court venue concurrently from 09:00.
- `enforces rest as a hard filter in pool play when multiple pools exist (Ticket 04)`: Zero back-to-back matches, every team gets $\ge 45$ min rest.
- `absorbs net buffer across all reserved courts synchronously at handover (Ticket 04)`: Handover respects the 15-minute net change buffer across all 4 courts synchronously.
- `lets a single-pool division play flat out without refusal (Ticket 04 & 10)`: Single pool places all 6 matches flat out.

