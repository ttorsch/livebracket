# Should the draw lock gate anything besides the schedule?

Type: grilling
Status: open
Blocked by: —

## Question

Graduated from the map's fog, which parked this as *"answerable once 10 lands"*.
It has landed, and it changed the premise.

[11](11-protect-schedule-on-unlock.md) found that `settings.draw.isLocked` was
read as a rule on **no** server write path at all — only ever written. It was
decoration, and `11` deliberately keyed its own gate on schedule cost rather
than lean on it. [10](10-gate-schedule-save.md) has now made it a real rule on
**exactly one** path: saving placements.

That asymmetry is the question. A lock that stops you saving a schedule but does
not stop you regenerating the draw underneath one is a strange object — it
guards the downstream artifact and not the thing it is a lock on. Today the draw
route will regenerate, reseed, or re-cross a locked draw without ever reading
`isLocked`; the only friction is `11`'s discard confirm, which triggers on the
saved schedule's existence, not on the lock.

Open decisions:

1. **Should the lock gate the draw route's own writes** — regenerate, reseed,
   apply-crossing — or is the ceremony purely social, with `11`'s cost-based
   confirm already the real protection?
2. **If it does gate them, what unlocks?** An explicit unlock step is the
   obvious answer, but `11` already put a confirm on the regenerate; two
   ceremonies in a row for one act is worse than one in the right place.
3. **Does anything else key off it?** Registration, seeding, team edits — a lock
   that means "final" arguably freezes the team list too, and CONTEXT.md's
   definition (*"changing a locked one is a visible one"*) does not say where it
   stops.
4. **Is `published` the same thing?** `setupReadiness.ts`'s `published` item is
   already `lockedCount === divisions.length`, labelled *"Bracket published"* —
   so the codebase is quietly using the lock to mean *published to players*.
   If that is what it means, the gate on the schedule is a special case of a
   bigger rule and should be named as one.

Consult `domain-modeling`: CONTEXT.md defines **draw lock** but not its reach,
and *published* is doing work here under a second name.
