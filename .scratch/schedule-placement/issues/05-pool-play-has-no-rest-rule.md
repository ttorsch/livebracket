# Pool play is exempt from the rest rule, and invisible in the report

Type: grilling
Status: closed
Assignee: Claude
Blocked by: —

## Question

`assign.ts` applies the rest filter only to matches that are not pool play:

```ts
if (!node.isPool && t.lastEnd !== -Infinity && slot.abs - t.lastEnd < r.minRestMinutes) return false;
```

The comment defends it: rest is hard in the knockout, a price in pool play,
*"a court left empty to protect a gap helps nobody."* Under `02` and `04` that
premise is gone — the court is not left empty, another division takes it.

Two consequences, both measured:

1. **`restIsHard` does not do what it says.** It is documented as *"never break
   the rest rule, overflowing instead"*, and it does not protect pool play at
   any rung of the ladder. An organizer who declared rest non-negotiable still
   gets back-to-back pool play.
2. **Pool back-to-back never appears in the relaxation report.** Because it is
   never a relaxation, only a cost. Measured: **48 back-to-back matches
   reported as `relaxations: (none)`.** The generator's whole claim to
   trustworthiness is that it names the promise it broke, and here it stays
   silent about the promise the organizer cares most about.

The second is the worse defect and is arguably independent of the redesign: a
schedule that breaks a promise without saying so is worse than one that refuses
to be generated. Whether pool rest becomes hard (following `02`) or stays
priced, **it has to be reported either way**.

## Notes

The `backToBack` relaxation rung exists and only ever affects knockout matches
today, which makes the report actively misleading rather than merely
incomplete.


---

## Resolution

The ticket's premise was half wrong in a way that matters: **the back-to-back
matches are not invisible, they arrive too late.** `validate.ts` already raises
a `shortRest` problem for every genuine zero-gap pair, pool play included. But
the page runs it over `allMatches` — the *saved* data — and never over
`preview.assignments`. So the organizer generates, reads `48 back-to-back` as an
unwarned prose fragment between the net-change count and a note about the first
round, saves, and only then does the grid light up with 48 faults. Not silence:
**whiplash.** And `preview.backToBack` *is* on screen, just without the
AlertTriangle the given-up-promises line beside it gets.

Also found: **`restIsHard` has no control anywhere in the UI**, and neither does
`minRestSlots`. Both are settings only the API can set and nothing does. So
consequence #1 as written — "an organizer who declared rest non-negotiable still
gets back-to-back pool play" — describes a state no organizer can currently
reach. It is a trap, not a live defect.

### Rest is two-state, and the middle state was an artefact of arithmetic

The organizer's rule: **a whole match between two of a team's matches, or no
rest at all.** Nothing in between, and no rest manufactured by holding court
time empty on purpose.

`minRestSlots` already stores this — a count of *matches*, defaulting to **1**,
which is exactly the rule. The damage is the conversion: multiplied by
`blockMinutes` and compared against elapsed minutes, it invents a third state,
"not quite enough", that the rule says cannot exist. That artefact is where
`restIsHard`'s ladder rung lives, where `restDeficitSlots` and
`averageRestMinutes` live, and where validate's *"whoever wins this only gets 20
min"* message lives. It goes, everywhere. Two states, checked as
`was there a whole match between these two?`

Losing the middle state costs nothing on screen: `tightestRestMinutes`,
`averageRestMinutes` and `restDeficitSlots` are computed and shown to **nobody**.

### Rest waits; it never refuses

The distinction the ticket and the code both missed. The knockout's hard filter
is not a refusal — it is a **wait**: the match is not dropped, it is tried in
the next slot, and the next. It only becomes a refusal when the day runs out.
So *"rest can be skipped, just flag it"* and *"hold the match back"* are not
opposed — the second is how the first almost never happens.

Settled: **the wait applies everywhere**, pool play included, once divisions
take turns. A final starting twenty minutes later is free — `08` already grants
the endgame an uncapped overrun. A final whose winner walked straight off
another court is not free, and no flag repairs it. Where there is no time left,
the wait turns into exactly the flag the organizer asked for.

### What this ticket settles, and what it hands on

**The rule half is `04`'s**, not this ticket's. Dropping `!node.isPool` cannot
ship alone — the comment above that line is right that a resting half strands
courts until another division walks onto them. The rule is already settled on
the map; only its timing was open, and timing is turn-taking's problem. What was
genuinely undecided, and is decided here, is **the telling** — the half worth
fixing *first*, because it is how anyone will know whether the redesign worked.

Decisions:

1. **The preview runs the full check.** Not a rest-only check and not a separate
   back-to-back report — the same validator, over `preview.assignments`, so
   "what you are about to save" and "what you saved" are judged by one set of
   rules. `10`'s shared-predicate precedent and `13`'s *"solver and display
   cannot disagree about the day again"*, turned onto faults. This makes the
   ticket's complaint vanish as a **side effect**: 48 pool back-to-backs become
   48 visible problems with no new ladder rung and no change to `assign.ts`.
2. **Only a genuine no-rest is a problem.** validate's existing threshold and
   its measured reason both survive — warning on every short gap *"put a warning
   on half the cards and buried the problems that actually need looking at"*.
   Under a two-state rule there is no short gap left to warn about anyway. Same
   lesson as `19`'s "18 identical warnings would bury the 7 real ones".
3. **Two lists, one volume.** A given-up promise and a problem answer different
   questions — *why does the schedule look like this* versus *what is wrong with
   this match* — and merging them would put "gave up on rest gaps" beside "Team
   A plays straight after Match 12" as the same kind of item. They stay two.
   What changes is that they stop being shown at two different volumes: the
   back-to-back count becomes a warning at the same weight as the promises line,
   with the problem count beside it. Attaching *causes* to problems is `09`'s
   business, which is why `09` waited on this one — it needed the pool problems
   to exist before it could explain them.
4. **The ladder loses a rung.** Two of its steps are about rest — "let gaps be
   short", then "let teams play with no gap at all". Under a two-state rule the
   first can never accomplish anything, so the generator spends a step that buys
   it nothing and then reports having given up on rest at a point where it gave
   up nothing. That is the same lie this ticket is about, from the other end.
   Collapse to one rest step, kept **last**, where it is.
5. **`restIsHard` stays uncontrolled.** Putting a control on a switch that does
   not do what it claims would ship the lie to more people. Its machinery is
   correct code behind the wrong filter; it becomes honest under `04`, and
   *that* is when it has earned a control. Direction of travel is deletion —
   under "rest waits, never refuses" there is nothing left for it to mean.
   Recorded as fog, not decided here.
6. **The card treatment.** A faulted card already carries a red border and a
   faint red wash, in both views, sharing one vocabulary on purpose. That stays
   as the **permanent** mark. The blink is a **brief pulse fired when you jump
   to a problem from the list** — the card you landed on announces itself, then
   settles. Continuous blinking was rejected at the organizer's own scale: 48
   cards pulsing at once is the wall of noise that made the app stop warning
   about short gaps in the first place, and it is the one effect that can make
   the page unusable for someone with motion sensitivity. Degrades correctly —
   with animation off the card is still marked and still scrolled to.

### Vocabulary

*Rest*, *back-to-back*, *given-up promise* and *problem* added to the root
`CONTEXT.md`. The glossary had **none** of the four, though all carry weight
across both maps and two of them are the whole of decision 3. *Given-up promise*
is deliberately not "relaxation": the code's word names the mechanism, the
organizer needs the meaning.

### Consequences to carry

- validate's comment defending the exemption — *"a 20-minute turnaround between
  20-minute matches is the expected shape of a round robin"* — becomes false
  under `02`/`04` and must go with the rule.
- The dependency message *"whoever wins X gets only 20 min"* can no longer
  happen. It is either nothing, or "walks straight back on".

The build is [Show the problems before you save](12-show-problems-before-you-save.md).
