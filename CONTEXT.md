# Live Bracket

A real-time tournament bracket manager and live-scoring dashboard. This glossary
fixes the words the codebase uses for tournament structure, the draw, and
scheduling — the areas where several plausible words exist for one thing and
picking the wrong one has caused real confusion.

## Language

### Tournament structure

**Tournament**:
One event, owned by an organizer, holding one or more divisions.

**Phase**:
Where a tournament sits in its lifecycle: draft → announced → open → closed.
Cancelled and archived are *not* phases — they are separate timestamps, so a
cancelled event keeps the phase it was cancelled from.

**Division**:
A competition within a tournament with its own format, fee and team cap. Teams
belong to a division, never to the tournament directly.
_Avoid_: Category, bracket (a bracket is one part of a division).

**Team**:
An entrant in a division. Holds a seat unless it is on the waitlist.

**Seat**:
One place against a division's `division_team_cap`. Waitlisted teams hold none.

**Round**:
An ordered stage within a division — pool play first, then the knockout rounds.

**Match**:
One fixture between two sides. A side may be unknown: a team, a pool position,
or nothing yet.

**Bye**:
A knockout pairing with one side and one empty seat. Settled before it starts,
so it is never played and never scheduled.

### The draw

**Draw**:
The act of deciding which team sits at which seed, plus the pool and crossing
configuration that turns seeds into pools and a bracket. It is the tournament's
fairness ceremony.
_Avoid_: Allocation, assignment (both mean court/time elsewhere in this codebase).

**Seed**:
A team's rank within its division. Pool membership is *derived* from seed order,
never stored — so the seeds are the draw, and everything else follows.

**Pool**:
A round-robin group within a division, named by letter. Which teams are in it is
a function of seed order and pool count.

**Pool position**:
A place in a pool by finishing rank — "#1 Pool A". How a knockout slot is
described before pool play has decided it.

**Draw lock**:
The mark that a draw is *final*, not merely generated. Generating and
regenerating an unlocked draw is a working act; changing a locked one is a
visible one. The lock is per division.
_Avoid_: Published, confirmed, finalised.

### Scheduling

**Court**:
A playing surface for the length of the event, with its own attributes (net
height, whether it is the show court). Not a number.

**Show court**:
The centre court, kept for late-stage matches when anything else would do.

**Court roster**:
The venue's courts, as configured — the calendar view's horizontal axis, and
the counterpart of the *time axis*. Like the time axis it is a property of the
configuration, never of the matches on screen: filtering changes which cards are
drawn, never which courts exist. A court with nothing on it is the most useful
column in the view.

**Off-roster court**:
A court named by a placement that the venue no longer has — court names live on
the match, so shrinking the roster strands whatever was on the courts that went.
Shown past the roster and marked, never silently dropped, and never a place a
match can be moved *to*.

**Slot**:
One step of the time grid on one day. The generator starts every match on a slot
boundary — that is what makes a published schedule readable. A *hand edit* is not
bound by it: an organizer may type any time, and the calendar draws such a match
at its true minute rather than rounding it onto a slot.

**Run**:
A stretch of the day that play happens in. Lunch cuts the day in two, and each
run lays its slots from its own start — which is why play resumes at the
configured `lunchEnd` rather than at the next multiple of the block. The minutes
left at the tail of a run are too short to start anything in.

**Time axis**:
The calendar view's vertical ruler — the configured day, from `startTime` to
`endTime`, cut into rows. It is a property of the configuration, never of the
matches on screen, so filtering changes which cards are drawn and never where
the rows are. Its rows follow the day's *runs*: lunch has a row of its own, and
the afternoon's rows begin at `lunchEnd`.

**Pitch**:
How many minutes one *playing* row of the time axis is worth. Taken from the
solver's grid resolution: the largest step dividing every match length in the
event. Not every row is a pitch: the lunch row is the length of the break, and
the tail of a run is whatever is left over.
_Avoid_: Interval, granularity.

**Schedule**:
Every match in the tournament given a court and a start time.

**Placement**:
One match's court, day and time.

**Pinned placement**:
A placement the organizer has fixed by hand. A hard constraint on the next
generate — which is what makes manual edits survive regeneration.

**Hand edit**:
An organizer's change to a placement, made in the schedule editor and not yet
saved.
_Avoid_: Override (that word is taken by the per-round duration overrides).

**Preview**:
A generated schedule that has not been saved. Organizer-only and never seen by
players, which is why generating one needs no preconditions.

**Blocked period**:
Court time the organizer has taken off the board — a ceremony, a presentation, a
repair. Venue configuration, so it survives regeneration.

**Lunch**:
A venue-wide stop. Every court, every day, nobody plays.

**Overflow**:
A match the generator could not fit before the end of the last day. A reportable
outcome, not an error.

**Drift**:
The projection of a running event once matches start going long, against the
schedule as planned.
