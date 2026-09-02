# Should an organizer be able to pin a placement?

Type: grilling
Status: open
Blocked by: —

## Question

The solver has honoured pins since it was written: `assignMatches` takes
`PinnedPlacement[]`, places them before it sees the grid, and reports what it
could not honour as `pinConflicts` rather than dropping it. `repair.ts:80`
refuses to trade a pinned match away — *"pins are the organizer's word"*. The
database has a `matches.pinned` column.

**Nothing produces one.** The only caller of `generateSchedule` in the app
passes no options (`page.tsx:607`), and the page is explicit that this is
deliberate: hand edits are *"deliberately **not** pins"*, and `handleGenerate`
throws them away with `clearEdits()`. So a whole half of the feature is built
and unreachable, and the half that would reach it has been consciously declined.

The question is what a pin *promises*, before anything about what it costs:

1. **Is a pin a distinct organizer act, or a property of a hand edit?** Today a
   hand edit is a throwaway: move things, see what breaks, discard. That is a
   real and good property — *"keeping them separate from both sources is what
   lets the organizer move things about and still throw it all away."* Pinning
   is the opposite promise, so it probably wants its own gesture rather than
   changing what a move means.
2. **What survives, exactly?** A pin fixes court, day and time. A regenerate
   that honours one is solving a different problem from the one it solved
   before — [14](14-net-buffer-eats-day-start.md) and the map's out-of-scope
   entry on carrying placements across a redraw both bear on this: a schedule
   is a whole, not a bag of matches.
3. **What does a pin cost?** Left over from
   [16](16-pinned-net-change.md). A pin never consults `optionFor`, so it never
   pays the net buffer and writes `netChange: false` regardless. That flag is
   inert for metrics (`evaluate` recomputes pivots from placements), but the
   solver placing a match with no time to move the net is a real gap. Whether
   it should be moved, reported as a `pinConflict`, or accepted is downstream
   of 1 and 2.
4. **Does a pin survive a redraw?** The map has already ruled carrying
   placements across a redraw out of scope, and called pinning *"the honest
   version of this — an explicit organizer act, not a guess at intent."* That
   sentence assumes pinning exists; this ticket is where it has to be made true
   or withdrawn.

## Notes

Graduated from [Should a hand-placed match pay for a net change?](16-pinned-net-change.md),
which found the pin path unreachable while settling the hand-edit half. `16`
also corrected `CONTEXT.md`, which had defined *pinned placement* as *"what
makes manual edits survive regeneration"* — a thing no code does.

Sits next to the map's open fog on **drift / live projection vs. hand edits**:
both are about what an organizer's manual placement is allowed to override.
