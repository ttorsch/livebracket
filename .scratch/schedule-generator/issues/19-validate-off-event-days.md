# Matches on an off-event day are drawn but never validated

Type: task
Status: resolved
Blocked by: —

## Question

The page's validation memo filters the schedule down before checking it:

```ts
const placed = allMatches.filter(m => !m.unscheduled && m.day >= 0 && /^\d{2}:\d{2}$/.test(m.time));
```

`day >= 0` silently drops every match sitting on a day the event's configuration
does not cover. That is not a hypothetical shape:
[12](12-anchor-grid-courts-and-days.md) decided the grid draws *"the event's
days plus any day a match actually sits on"* precisely because a saved schedule
can name a day the configuration no longer has — the same reasoning that keeps
an off-roster court on screen instead of dropping it.

So the two halves disagree. The grid draws the day; the validator pretends it is
not there. On `test-tournament` this is not an edge case at all: the tournament
is configured Sep 3–4 2026 and the saved schedule sits on Sep 2–3, so **25 of
its 34 matches are on day `-1` and none of them are checked** — no court clash,
no team clash, no dependency, nothing. The section that looks most like a normal
day is the one nothing is looking at.

Found while verifying [16](16-pinned-net-change.md): a hand edit deliberately
built to trip the new net-change fault landed correctly and reported nothing,
because it landed on that section.

What to decide and do:

1. **Should an off-event day be validated like any other?** The argument for is
   that `12` already settled the principle for drawing, and a fault the
   organizer cannot see is worse than one they can. The argument against is
   that `outsideDay` exists and might be the right single answer for the whole
   section rather than a fault on each card — though today it fires on neither.
2. **What does `outsideDay` mean once days can be off-event?** It currently
   checks only the time of day against `grid.dayStart`/`dayEnd`, so a match on a
   day outside the event passes it while a match at 08:00 on a real day does
   not.
3. **Is `day < 0` even the right encoding?** A negative index for "before the
   event" is doing double duty as a sentinel, and `Unscheduled` is separately a
   *dateless* section (settled by `17`). Whether these are two states or three
   wants saying out loud before more code branches on the sign of an integer.

Done when a match the grid draws is a match the validator checks, or the map
says in one line why not.

## Notes

Pre-existing, and older than either ticket that exposed it. Not introduced by
`16`, which only made it visible by adding a check that should have fired there
and did not.

Same species as `17`'s fog entry about the Unscheduled tray: a section the grid
knows how to draw but the rest of the page has no settled idea what it *is*.

## Answer

**A day is a signed offset, and it was being read as a sentinel.** That is the
whole finding. `dayIndexOf` differences two real dates, so `-1` means *the day
before the event* exactly as `1` means *the second day* — but `-1` was also
hardcoded for the two states that have no day at all (an *overflow*, and a match
with no date), and four separate places then read the **sign** to mean
"unplaced". Every symptom on this ticket is that one confusion.

The disambiguator already existed and was already in the file: the calendar memo
had hit this in `12` and switched to `m.date !== ''`, leaving a comment that
`day >= 0` *"silently emptied the whole view"*. It fixed itself and nothing else.
So the answer to question 1 was settled by precedent before the ticket was
written, and question 3 answers itself: **datelessness is the state, the sign of
an integer is not**. Extracted to `lib/schedule/placedMatch.ts` on `10`'s
precedent — what it owns is not the boolean but the fact that there is only one
of it.

**The validator was never the broken half.** `validateSchedule` is day-agnostic
and always was: `abs()` is `day * DAY_SPAN + startMin`, which orders negative
days correctly, and `hhmm` already carried a deliberate modulo guard for them.
The page filtered its input and handed it nothing. Nothing in `validate.ts`
changed.

### The half this ticket did not know about

The same predicate is on the **save** path, where it is destructive rather than
merely blind:

- `page.tsx` sent `{court: null, time: null}` for any `m.day < 0`, so pressing
  Save **deleted** 18 placements the grid was drawing on screen.
- `route.ts` clamped the day with `Math.max(0, …)`, so a correct page would have
  been overruled anyway — the match silently **moved** onto the first day of the
  event instead.

These had to go together: fixing the page alone converts "wipes the match" into
"moves it a day", which is worse for being plausible. Ruled in scope by the
organizer, on the grounds that it is one defect in one predicate and leaving
half of it keeps two answers in the codebase.

Two more readers of the sign went with them: `timeKey` sank a negative day to
the **end** of the sort (it is early, not missing — the sink is having no
*time*), and the By Court block expansion derived its day set with
`filter(d => d >= 0)`, which now asks `hasPlacement` and `isOffEventDay` so a
day-less blocked period means "every day *of the event*" in both views.

### What "outside the event" is allowed to say

`outsideDay` stays a statement about the **clock** — the playing hours — and is
untouched. Off-event is the **calendar**, a different axis with a different
remedy: move the card versus move the tournament's dates. Deliberately **not** a
new `ProblemKind`. A fault is per-card, and the realistic case is not a stray
match but a whole schedule left behind by a date change, where 18 identical
warnings would state one fact eighteen times and bury the seven real faults
underneath it in the same counter. So it is said **once, where the day is
drawn**: the section corner now reads *Outside the event* in place of the day
number, instead of being marked by the *absence* of a number nobody counts.

### Verified

`test-tournament` had drifted back on-event since this ticket was written, so
the condition was recreated the way an organizer creates it — by moving the
tournament's dates forward a day, stranding 18 of 34 matches on Sep 3.

- **The grid and the validator now agree.** 18 cards drawn under *Outside the
  event*, and 7 of them faulted — `shortRest` warnings that no check had ever
  looked at. Previously: 18 drawn, 0 checked.
- **The fault set is invariant to the event's dates.** With the schedule on
  day −1/0 and again on day 0/1, the page reports the *same* 15 problems with
  the *same* messages. That is the real end state: the validator no longer cares
  which side of the configured dates a match sits on.
- **Save is non-destructive.** The captured PUT body carries 34 assignments,
  **0 cleared**, 18 of them `day: -1` with their real court and time; the
  round-trip leaves 18 on Sep 3 and 16 on Sep 4, none wiped and none moved.
  Before, that request cleared 18 placements.
- `242` tests green (`+10`), `tsc` and `eslint` clean, no console errors. The
  fixture was snapshotted first and restored exactly — dates back to Sep 3–4 and
  the court distribution back to 4/5/5/4 and 6/3/5/2.

### Surfaced, not fixed

**Blocked periods do not reach an off-event day.** `grid.blocked` is indexed by
event day, so `blocked[-1]` is a miss and no `blocked` fault can fire there,
while *lunch* — checked against the window rather than the slot array — does
fire. An accidental asymmetry, newly reachable because these matches are now
checked at all. Quiet in practice (those matches were placed avoiding both), and
left alone rather than widened into grid internals on a ticket about a
predicate. It is the same species as the map's open fog on whether the
feasibility verdict should count blocked periods, and belongs with it.
