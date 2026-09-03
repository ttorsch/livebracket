# Placement is a court queue, not a wave

Type: task
Status: specified (not built)
Assignee: —
Blocked by: — (supersedes the unbuilt half of 03 and all of 04)

## Question

Placement today is four generations of rules stacked on each other — an
auction, then court affinity to stop the auction scattering divisions, then a
day plan to stop it front-loading, then waves to stop affinity being ignored.
Nothing was removed when its replacement arrived, so the layers argue and the
special cases in `assign.ts` are where you can watch them arguing.

This ticket replaces the whole of pool-play placement with one rule an
organizer can read off a wall chart.

---

## Answer

### The shape

The venue is **N independent court queues**. Each court is a column, filled
downward. A court's next match starts the minute the previous one ends. There
are no waves, no all-or-nothing group bookings, no pace plan and no relaxation
ladder — a court asks one question, gets one answer, and moves on.

This is a **preview for an organizer**, not a live simulation. Nothing waits
for a real court to free; the generator walks courts 1…N in order, gives each
one its next match, and comes back round again.

---

### 1. Appetite — how many courts a division wants

    appetite = ceil( pools x floor(teamsPerPool / 2) / 2 )

Half of the division's maximum simultaneous matches. That is the rest
guarantee, and it comes out of the court maths rather than out of a rule: with
`appetite` courts running, exactly half the division is on court and half is
resting.

| Draw | pools x per-pool | appetite | on court |
|---|---|---|---|
| 4 pools of 4 (16 teams) | 4 x 2 = 8 | 4 | 8/16 = 50% |
| 3 pools of 4 (12 teams) | 3 x 2 = 6 | 3 | 6/12 = 50% |
| 2 pools of 4 (8 teams)  | 2 x 2 = 4 | 2 | 4/8  = 50% |
| 2 pools of 6 (12 teams) | 2 x 3 = 6 | 3 | 6/12 = 50% |
| 3 pools of 3 (9 teams)  | 3 x 1 = 3 | 2 | 4/9  = 44% |
| 1 pool of 4 (4 teams)   | 1 x 2 = 2 | 1 | 2/4  = 50% |

Rounded **up** on an odd product. Never exceeds half by more than one court.

Replaces `optimalCourts = floor(pools/2) x perPool` in `poolplay.ts`, which
floors the pool pairing first and so under-serves an odd pool count (3 pools of
4 gets 2 courts instead of 3).

**Appetite is not an organizer setting.** It is derived from the draw and
nothing else. `autoDedicatedCourts` is deleted, the per-division
`dedicatedCourts` override is deleted, its control comes off the setup page and
`divisionOverrides` comes out of the schedule PATCH route. The column can stay
in the database unread, or go in a migration — either way nothing reads it.

**Appetite sizes pool play only.** After the pool round, the block width is the
limit: eight round-of-16 matches on a four-court block run in two halves, four
quarter-finals on four courts run at once. Dependencies already force the rest
between knockout rounds, so no second formula is needed.

**A one-pool division cannot rest.** Six matches on one court, and no ordering
of a 4-team round robin avoids back-to-back — the three rounds are {AB,CD},
{AC,BD}, {AD,BC}, and two consecutive disjoint matches must be partners in the
same round, so a run of three is impossible. Warn, don't fix. (See `10`.)

---

### 2. The queue and the pair

Divisions form a queue: gendered divisions first, biggest appetite first, then
non-gendered.

**Two divisions run at a time** — the front two of the queue. Their appetites
are fitted to the venue: the **bigger keeps its number**, the **smaller absorbs
the whole difference**.

The queue order is not a preference, it is **roster overlap**. A Mixed team
draws its players from the Men's and Women's draws, so the same human is in two
divisions — but they are two unrelated team ids and the solver cannot see the
connection. Nothing in the graph or the cost function can detect the clash, so
the only protection is that the two never run at once. Add *roster overlap* to
`CONTEXT.md`.

Gender labels only catch the obvious case. A junior playing both U18 and Open
is the same clash between two divisions the label rule would happily run in
parallel, so **the organizer declares which divisions share players**, and a
declared pair never runs in parallel. That is a new setup field and a new
column, not a solver change — worth scoping separately. Gendered-before-
non-gendered stays as the default ordering when nothing is declared.

    slack = courts - (bigA + bigB)
    bigB' = bigB + slack        (clamped to >= 1)

| Courts | 4 + 3 = 7 | Result |
|---|---|---|
| 6 | -1 | Men 4, Women **2** |
| 7 |  0 | Men 4, Women 3 |
| 8 | +1 | Men 4, Women **4** |

Courts are handed out in **contiguous blocks** — Men take 1…4, Women take
5…8 — and each block's nets are rigged to its division's height in the morning.

**Rounding up past a division's pool count is fine.** Women on 4 courts with 3
pools means one pool supplies two simultaneous matches. Those four teams then
rest together. No special case: the spare court runs the same assessment as
every other court, and if the best candidate it can find is a back-to-back, it
takes it.

**Rounding down below 1** means the smaller division does not start. It waits
its turn.

**The venue is always fully allotted.** A lone division at the front of the
queue takes every court, not just its appetite — so on eight courts a 4-appetite
division runs eight wide and its rest guarantee is gone from the first minute.
Deliberate: an idle court an organizer can see is worse than a back-to-back
they can fix with the buffer tool. The allotment can exceed what a division can
physically fill — 16 teams can never run more than 8 matches at once — and
those courts idle on the team filter rather than by rule.

---

### 3. The rhythm of a round robin — measured, and not what was specified

The ticket originally said: take the opening match of **each pool**, one per
court. Built and measured, that destroys the rest guarantee it exists to serve.

Once a pool of four has played `AB` and `CD`, every match it has left pairs one
of `A,B` with one of `C,D` — so the third row *must* reuse whoever played in
the second. Four pools of four across four courts:

| Opening row | Back-to-back | Rows used |
|---|---|---|
| one match per pool | **8** | 6 |
| whole pools alternating | **0** | 6 |

Same six rows, same finish time, eight fewer back-to-backs. So the rule is
**pools already on court finish before new ones start**: a whole pool goes up
across the courts it needs, plays its round, and sits down while the next group
plays.

    09:00  A1vA2  A3vA4  B1vB2  B3vB4     <- pools A and B, whole
    09:20  C1vC2  C3vC4  D1vD2  D3vD4     <- C and D, while A and B rest
    09:40  A1vA3  A2vA4  B1vB3  B2vB4     <- A and B again, rested
    ...

It falls out of one tie-break (`poolLastStart`, ranked descending) rather than
a rule of its own, and needs no concept of a "group": the score refuses a
back-to-back, so a pool that has just played cannot come straight back up even
though the tie-break would like it to.

An **odd pool count cannot pair evenly** — three pools of four on three courts
leaves one pool sharing a court group with half of another, and measures 2
back-to-back. Reported, not fixed.

---

### 4. Every match after that

Walk courts 1…N in order. For each court, in this order:

**a. Build the candidate set.** Matches still unplaced in the division's
current round; if that round is empty, matches in the next round.

*Round = the database round.* A division's pool stage is one round — all pools,
all matches. Pool membership is a property of the match, not a sub-round. There
is no synchronised round-robin turn inside it.

**b. Filter out what cannot legally go there.** These are not scored, they are
refused:

- **Feeders not finished.** A semi-final is not a candidate until both
  quarter-finals have ended.
- **A team is already on court** at that moment, in either match. Referee duty
  is **not** counted — `refereeTeam` leaves the placement model entirely for
  now. Referees are assigned by hand after the schedule exists, so the organizer
  is the one who keeps a refereeing team off court. `discardCost` and the UI
  keep their own use of `referee_team_id`; only the solver stops reading it.
- **It does not fit.** The match may overrun **lunch or the end of the day** by
  at most **20% of its own duration** (4 minutes on a 20-minute match, 9 on a
  45). Beyond that it waits for the far side of the boundary. A **blocked
  period is hard** — a ceremony on a named court is a thing actually happening
  there, not a soft boundary. The endgame keeps its own rule from `08` — no
  ceiling, and the overrun blocks saving.
- **A net change costs real minutes.** If the court is rigged to 2.24 and the
  match needs 2.43, the crew walks on and the match starts `netBufferMinutes`
  later. Charged as clock time, on top of the score below.

**c. Score what is left.**

| Criterion | Points |
|---|---|
| Same division as the match before it on this court | +3 |
| No back-to-back for either team | +2 |
| No net change | +2 |
| Same pool as a match already played on this court | +1 |

**d. Break ties.** They will be constant — six candidates scoring 8 is normal.
In order:

1. Longest-rested teams (earliest last-finish).
2. The pool that has waited longest since its last match.
3. The match's own order within its pool.
4. Match id.

Fully deterministic. The same input always produces the same schedule.

**e. Place the highest scorer** immediately after the previous match on that
court. **A court never voluntarily idles** — if the only candidate is a
back-to-back and a net change, it takes it. Fixing that is the organizer's job
by hand, not the generator's.

A court with an empty candidate set idles and is re-asked on the next pass.

---

### 5. Handover

A division's block is released when its round is finished. The freed courts
then run the same assessment as always — so the handover is emergent, not a
separate rule.

What that produces in practice:

- **The next round of the same division** wins by default (+3 same division,
  +2 no net change), which is what puts the knockout onto the courts its own
  pool play just vacated.
- **A same-height division** costs nothing to hand over to — Women 2.24 to
  Mixed 2.24 is a zero-net-change handover, and scores 0+2+2+0 = 4.
- **A different-height division** costs a net change in both points and
  minutes, so it only happens when nothing else is available.

**A court may only be borrowed by another division at zero net change** — a
foreign division must score at least 4. Mixed can slide onto a Women's court
for free (both 2.24); Men at 2.43 can never invade one mid-session. This keeps
a division from being pushed off its own block by a neighbour, which is what
`divisionSpread` failed to do as a 26-point preference.

**Block release is not a per-match net change.** The two are different events
and only one of them is a defect:

- *Per-match* — the crew walks on mid-session for a single match. Expensive,
  scored against, avoided.
- *Block release* — a division is **completely finished**. Its whole block is
  re-rigged once, in a single buffer, and joins the block of whichever division
  takes it. That is what an organizer actually does at a changeover, and
  without it a finished division's courts sit idle at the wrong height for the
  rest of the day.

So Men finishing at 13:00 releases four courts, re-rigged to 2.24 in one
buffer, and the division still running expands onto all eight.

**A round that does not finish by the end of the day holds its courts and
resumes on them tomorrow.** Blocks persist across days, and **every block
re-rigs free on each morning** — nets are set before play starts, so no court
pays a change for the overnight gap. The current solver gets this wrong: the
running height carries across the break and every court opens late on day two.

**The endgame programme is unchanged**: semifinals one division at a time,
every division's 3rd-place play-off together, finals one after another on one
court.

---

### 6. What "+3 same division" costs

Worst case, stated plainly so it is a choice and not a surprise:

A court will **never lend itself to another division to spare a team a
back-to-back.** Men's queue has one match left and it is a back-to-back
(3 + 0 + 2 + 1 = **6**). Women has a rested match at the same net height
(0 + 2 + 2 + 0 = **4**). The back-to-back wins.

Narrow in practice, because a foreign division usually also means a net change
(0 + 2 + 0 + 0 = 2 against a same-division worst case of 4), so +3 is rarely
the deciding term. Accepted deliberately: parallelism and low net-change count
matter more than perfect rest, and rest is the organizer's to fix by hand.

---

### 7. Deleted

| Goes | Why |
|---|---|
| Pool-play waves in `staging.ts` | Replaced by court queues |
| `courtAffinity`'s three branches in `dayplan.ts` | Replaced by contiguous blocks |
| `divisionSpread`, `paceDeviation`, `courtChurn`, `depthUrgency` | Replaced by the 4-point score |
| The relaxation ladder in `assign.ts` | Nothing left to relax |
| The repair pass (`repair.ts`) | Accepts zero improvements on every measured run |
| `quota` in `dayplan.ts`, `restDeficit` in `types.ts` | Already dead |
| `autoDedicatedCourts` | Superseded by appetite |
| `dedicatedCourts` override — setup control, `divisionOverrides`, `CourtOverrides` | Appetite is derived, not configured |
| `refereeTeam` in `teamsOf` / the placement model | Referees are assigned by hand after the schedule exists |
| The relaxation report (`Relaxation[]`) | Replaced by the validator's problem list |
| The Hungarian matcher | Was solving "which match on which court"; now one court asks for one match |

Kept: the grid, the dependency graph, the day plan's finals-on-last-day rule,
the endgame staging programme, `netChange.ts`, `validate.ts`.

---

### 8. What the organizer is told

Deleting the ladder deletes the relaxation report, and nothing replaces it.
There is still bad news to deliver — back-to-backs from expansion, idle courts,
an event running past the end of the day, unplaced matches — and the
**validator's problem list from `12` is now the only report**. One list instead
of two, run over the preview before save.

---

### 9. Expansion — settled

**When a running division has fewer legal matches than it has courts, that
division expands past its appetite.** Its teams start playing back-to-back,
capped by the hard "team already on court" filter — Women on 7 courts runs 6
matches at once and nobody rests. That is accepted: the organizer has a manual
buffer tool and fixes it by hand.

The alternative — starting the next division early on the freed block — is
**refused**, and not on utilisation grounds. It breaks roster overlap. Six
Women's teams on court while Mixed starts means the same people are booked
twice, and the generator cannot see it because they are different team ids.

Expansion is also what *enforces* the sequencing: if the running division
always absorbs its own freed courts, the venue drains division by division and
the next division physically cannot start early, because there is never an
empty block for it to start on. The rule chosen for utilisation is the same
rule that protects the roster.

---

### 10. Built — four corrections the first build forced

**The queue is about pool play, not about divisions.** Holding a queue slot
until a division was *entirely* finished deadlocked the event, and the cause
was a circular wait rather than a shortage of court time: the play-off for 3rd
waits on every division's semifinals, the last division could not reach its
semifinals because the first two still held both slots, so the first two could
never finish. Measured on the organizer's own tournament — 22 of 54 matches
stranded, one whole division plus both play-off/final pairs, with the venue
idle from midday on day one. A division now leaves the queue when its **round
robin** ends; its knockout competes for free courts like anything else. The
roster-overlap exposure is a non-gendered round robin against a gendered
*knockout*, where four of eight teams play rather than all of them.

**A non-gendered round robin waits for every gendered one, by the clock.** A
free slot is not an invitation: Mixed overlaps *both* gendered draws, so one of
them finishing early does not let it in. And the gate alone is not enough —
courts drift apart, so the block Mixed is given can stand free while the last
Men's pool match still runs beside it. It is a time floor as well as a gate.

**The reservation binds both ways.** Nobody else plays on a block whose owner
is mid-round-robin, *and* a round robin never spills off its own block. Leaving
either half open undoes the appetite arithmetic: a knockout at matching net
height took the block out from under the division about to use it, and a round
robin allowed onto the unreserved courts beside it ran four matches at once
instead of two — all eight of its teams on court, every one of them back to
back. Measured: 12 back-to-back matches, all one division spilling off its own
two courts. The zero-net-change borrow survives only for **unreserved** courts.

**The endgame may run past closing on the last day** (`08`). Only the medal
rounds: an event whose day is genuinely too short should show the organizer a
final at 17:55 and let them decide, where an unplaced final is just an absence.
Pool play gets no such licence — a round robin that does not fit *is* the event
not fitting, and inventing evening court time for it would hide the problem.

### Measured on the organizer's tournament

3 divisions x 18 matches, 4 courts, 2 days, 09:00-17:00 with a 12:00-15:30
heat break (270 playable minutes per court per day against 1,890 needed).

| | placed | overflow | back-to-back | net changes |
|---|---|---|---|---|
| first build | 32 | **22** | 2 | 0 |
| queue on pool play | 54 | 0 | 18 | 7 |
| + reservation both ways | 54 | 0 | 8 | 4 |
| + non-gendered floor | **54** | **0** | **0** | **4** |

---

### 11. The round is read across the event, not within a division

The organizer's own correction, and it is the better rule. Placement asks
"is there still a match in the current round?" — and that question is asked of
**every division at once**, not of one. So every round robin in the event is
finished before any bracket opens, and every quarter-final is played before any
semi-final is. The event advances as one field.

Reading it per division let a division race ahead: Women playing their
semi-finals while Mixed was still working through its round robin, which is not
a schedule anyone would write by hand.

Three places had to say it, because the medal rounds are ordered by *phase*
rather than by round index and would otherwise slip past the gate:

1. **The round gate itself** — `currentRound()` takes the lowest round index
   still outstanding anywhere, and pool play and the early bracket are held to
   it.
2. **No bracket opens until every round robin is played.** Said against
   `isPool`, because a short draw that runs straight from pools to semi-finals
   has no early round for the gate to hold it on.
3. **No medal round until every bracket round before it is played.** Without
   this the lockstep reached only as far as the round index gated: the score
   prefers to keep a court on the division that last used it, so Women's
   semi-finals went on while Men's quarter-finals had not been played at all.

A group whose *feeders* are unplaced now reports itself **waiting** rather than
crowded. It used to count against the group's patience, so every semifinal pair
dissolved long before its quarter-finals existed and was then laid down one
match at a time — the exact stagger the group exists to prevent.

### Measured, on the organizer's tournament

| | finish | back-to-back | walks straight back on | past close |
|---|---|---|---|---|
| per-division round | d2 18:40 | 8 | 16 | 2 |
| **round read globally** | d2 20:55 | **3** | **6** | 8 |
| round read globally, break ends 14:00 | d2 **17:55** | **1** | **2** | 1 |

It costs two and a quarter hours of finish time, all of it day one's afternoon:
nothing may run there but the round robin still owing, so two courts stand
idle. It buys back half the back-to-back play and two thirds of the
walk-straight-back-on, because a bracket no longer opens the instant the last
pool match ends.

The **heat break is the binding constraint** and not the rule: 12:00-15:30
leaves 270 playable minutes a day. Ending it at 14:00 pays for the lockstep
twice over.

---

## Open

- **A fifth court makes the schedule worse** — back-to-back 8 to 14 on the
  organizer's event. Surplus courts are handed to a division whose rotation
  cannot use them without putting every one of its teams on court. A block
  should never be cut wider than its appetite.
- **Whether the winner of a match is owed a whole match before playing again.**
  Measured, it takes the remaining walk-straight-back-on to zero and costs
  about ninety minutes of finish time. Not yet decided.
