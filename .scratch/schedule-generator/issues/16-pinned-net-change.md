# Should a hand-placed match pay for a net change?

Type: grilling
Status: resolved
Blocked by: —

## Question

A pin is a hard constraint, so the solver puts it exactly where the organizer
said — `startAbs: slot.abs`, `netChange: false`, span from the duration alone
(`assign.ts:297-307`). It never consults `optionFor`, so it never pays the net
buffer and never even records that a change happened.

That was invisible while the buffer was charged everywhere else too. [A net
change must not eat the start of a day](14-net-buffer-eats-day-start.md) has now
stated the rule out loud — *the buffer is the wait between the previous match
ending and this one starting* — and pins are the one placement exempt from it.
So an organizer can drag a 2.43 m match into the slot straight after a 2.24 m
match on the same court, and the schedule says it starts on time.

`validateSchedule` does not catch it either: nothing in `validate.ts` reads
`netHeight`. It checks court clashes, team clashes, rest, blocked periods and
lunch, and a net change with no time to make it passes unremarked.

Open decisions:

1. **Should a pin be moved, or reported?** Moving it contradicts what a pin is.
   Reporting it — a `PinConflict`, or a validation warning on a hand edit — keeps
   the pin hard and tells the organizer what it costs. A third option is that
   this is fine: the organizer looked at the court and decided.
2. **If reported, at which seam?** `assign.ts` sees pins the solver was given;
   `validate.ts` sees a hand-edited schedule coming back from the page. `14`'s
   rule lives in `assign.ts` and would have to be shared, not duplicated, or the
   two will drift.
3. **Does a pinned match's height change what follows it?** It does today —
   `occupy` sets `courts[].height` from any placement — so the cost of a pin is
   already partly paid by the *next* match. Whether that is the right place for
   the whole cost to land is the question underneath 1.

## Notes

Surfaced by [A net change must not eat the start of a day](14-net-buffer-eats-day-start.md),
which found it while separating the buffer's two meanings and deliberately left
pins alone: they were exempt before that ticket and are exempt after it, so it
is not a regression it introduced.

Sits next to the map's open fog on **drift / live projection vs. hand edits** —
both are about what an organizer's manual placement is allowed to override.

## Resolution

**The ticket's premise was one layer off: the live path is the hand edit, not
the pin.** `generateSchedule` accepts `options.pins`, but the only caller in the
app passes none (`page.tsx:607`), and the page says so on purpose — hand edits
are *"deliberately **not** pins"*, and `handleGenerate` calls `clearEdits()`.
So no organizer act produces a `PinnedPlacement` today, and the pin branch in
`assign.ts` is a solver capability with no caller.

What an organizer *can* do is drag a 2.43 m match under a 2.24 m one, and that
went through `validateSchedule`, which never read `netHeight`. It could not
have: the page builds its own graph for validation, and `buildGraph` set
`netHeight: null` with *"filled by the caller; see generate.ts"* — a seam only
`generate.ts` ever crossed. **Every node in the validation path had a null
height, so every net-change check there is would have passed.**

So this ticket settled the hand edit, and the pin question graduated to
[Should an organizer be able to pin a placement?](18-organizer-pinning.md).
That split is not deferral: what a pin *costs* cannot be decided before what a
pin *promises*, and the `matches.pinned` column already in the schema says the
promise is half-designed rather than abandoned.

### The three open decisions

**1. Report, never move, never block.** Moving a hand-placed match contradicts
what a hand edit is — the organizer typed a time. Blocking it contradicts
`validate.ts`'s whole premise: *"nothing here blocks anything"*, because the
organizer knows things the solver does not. Accepting it silently was the real
temptation, and it loses to one specific property: **this is the only fault on
the list that is invisible on screen.** A court clash is two cards overlapping.
A net change is two cards sitting neatly nose to tail that happen to need a crew
and ten minutes between them, and nothing in the drawing says so. That is
exactly the case a validator earns its keep on.

**2. The seam is a shared kernel, not a shared function.** `optionFor` asks
*when can this start* (a time); the validator asks *is this wrong* (a boolean).
Those are different questions, so what they share is smaller than either:
`lib/schedule/netChange.ts` holds the state a court presents to an arriving
match and the arithmetic over it, and the two callers ask it from their own
directions (`netReadyAt` / `netShortfall`). Following `10`'s `scheduleGate.ts`
precedent one layer down. `validate.ts` still imports nothing from the solver,
which its own header promises.

**The kernel owns the look-back, and that is the point.** `precedingOn` does
*two* backwards walks, deliberately: the court frees when the **last** match
ends, but the net sits at the height of the last match that **declared** one.
The rule that drifts between two copies is never the subtraction — it is which
two things you subtracted. Adjacent-pairs-only would have let a division with no
declared height act as a laundering step: drop one in between and the fault
disappears from the report while the crew still has to move the net.

**3. Both ends of a net change are flagged, and it falls out for free.** A
stateless pairwise scan over each court's day flags the intruder *and* whoever
wants the net back. Flagging only the match the organizer touched would make the
warning depend on edit history rather than on the schedule — the same
arrangement reading differently depending on how you got there. This also
answers the ticket's third question: `occupy` setting `courts[].height` from any
placement is right, because per `14` that scalar is the physical state of the
net, and a net that moved has moved.

An overlap is left to `courtClash` alone: one mistake, one fault. You cannot
schedule a net change until the overlap is gone, so it is not the one to fix
first.

### Two things settled by looking rather than deciding

- **Pinned placements already count as pivots.** `evaluate` (`cost.ts:331`)
  recomputes net changes by walking placements, independent of
  `Placement.netChange`. The `netChange: false` the pin branch writes is inert
  bookkeeping — a stored falsehood, not a metrics bug. It goes with `18`.
- **`validateSchedule` was already per-court-per-day.** `byCourt` keys on
  `${p.day}|${p.court}`, which is `14`'s *"only ever bills a real predecessor on
  that court that day"* arriving for free. No day-boundary case here either.

### What landed

- `lib/schedule/netChange.ts` — the kernel. `netStateBefore` consumes a lazy
  iterable and stops at the first declared height, so the solver's backwards
  slot walk costs what it always did.
- `buildGraph` fills `netHeight` from the division; `generate.ts:137-145`
  deleted. **The seam is what made this invisible, so closing it is the fix** —
  every caller now gets heights, not just the one that remembered.
- `validateSchedule` gains a `netChange` kind and a `netBufferMinutes` option.
  Rendering is kind-agnostic, so no new styling.
- `insertBuffer`'s prompt opens at `netBufferMinutes` on a card carrying the
  fault, rather than at a whole match's length. One line, no new UI — and it
  points at the right act, because a `Buffer` block is venue configuration and
  survives the next generate, unlike the hand edit that caused the fault.
- `CONTEXT.md`: *net change* and *net buffer* added; *pinned placement* and
  *hand edit* corrected — the glossary claimed manual edits survive
  regeneration, which no code does.

### Verified

232 tests pass (27 new in `netChange.test.ts`), `tsc --noEmit` clean, eslint
clean on all six touched files. `14`'s committed repro still reports 0 late
courts, so folding `optionFor` onto the kernel changed none of its behaviour.
The round-trip test is the one that matters long-term: a generated schedule is
fed straight back through `validateSchedule` and must trip nothing, which is
what would catch the two rules drifting apart.

**Seen end to end on `test-tournament`.** The saved schedule has no net change
to find — courts split cleanly 2.43/2.43/2.24/2.24, which is the affinity
working — so one had to be forced by hand. Walking Men Open's M13 onto Court 4
put a 2.43 m match immediately in front of Women Open's W16, and the card drew:

> ⚠ the net is at 2.43 m after M13 and this starts straight after — changing it
> to 2.24 m needs 10 min

(10 rather than 15 because that tournament's `netBufferMinutes` is 10.) The
fault renders through the existing kind-agnostic fault list, beside the
`blocked` warning the same move produced by pushing W16 into lunch.

**And it exposed something else on the way.** The first attempt was made in the
`Wed, Sep 2` section and reported nothing, correctly placed and all. That
fixture is configured Sep 3–4, so its Sep 2 matches carry day index `-1` — and
the page's validation memo filters on `m.day >= 0`. **Twenty-five of its
thirty-four matches are validated by nothing at all**, not by this check and not
by any of the five that predate it. `12` decided the grid draws *"any day a
match actually sits on"*; the validator never followed. Pre-existing, older than
this ticket, and now
[Matches on an off-event day are drawn but never validated](19-validate-off-event-days.md).
