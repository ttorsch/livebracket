# A net change is free in the endgame, and that sets a trap on the last day

Type: grilling
Status: open
Blocked by: 08

## Question

`cost.ts:182` waives the net-change charge for any match in a staged wave:

```ts
const staged = ignoresCourtIdentity(ctx.staging.waveOf.get(node.id)?.phase ?? 'pool');
...
if (netChange && !staged) cost += w.netChange;
```

The comment states both the reasoning and the safeguard, and both deserve to
be taken seriously:

> Court identity stops mattering once a division reaches its medal rounds.
> There are only a handful of matches left, they have to run side by side, and
> an organizer will happily re-rig a net to get both semifinals on adjacent
> courts. **The buffer a net change costs in minutes is still charged, by the
> caller, as real court time: that one is physical and does not go away
> because the round matters.**

The safeguard is the load-bearing half, and
[`01`](./01-reproduce-unplaced-with-idle-venue.md) measured it failing. It
assumes there is always court time left to absorb the buffer. On the last
layer of the last day there is not — so the buffer is not *charged*, it is
*fatal*: the match is refused rather than delayed, and the organizer is shown
45 minutes of empty court with no explanation.

The mechanism is scarcity the solver never looks ahead to see. Four matches
were ready at 16:15 and two needed 2.24 m, but the 15:30 layer — placed with
net changes priced at zero — had left three of four courts at 2.43 m.
`assign.ts:230` is a single forward pass with no backtracking, so by the time
the shortage is visible there is nothing to be done about it.

What this ticket decides:

1. **Is the exemption right at all, or is it right only while the day has
   slack?** A charge that is waived because "the minutes are charged anyway"
   should probably come back the moment those minutes are the last ones.
2. **Or is pricing the wrong instrument here entirely?** The map has settled
   that reservations are for pool play and the endgame uses what is free
   ([`03`](./03-dedicated-court-is-a-reservation.md)). If the endgame is
   governed by staging rather than by price, then staging — not the cost
   function — should be the thing that knows two 2.24 m matches are coming and
   keeps a 2.24 m court standing for them.
3. **Whether the last layer of the event is special.** Everywhere else a net
   change delays a match; here it deletes one. That asymmetry may deserve a
   rule of its own rather than a weight.

Blocked by [`08`](./08-endgame-may-run-late.md): if the endgame may run past
the end time, a net change at 16:15 costs an overrun the organizer is asked to
accept rather than a match that vanishes. That changes what the exemption
*costs*, and this question cannot be priced until it is known.

## Notes

The default weight is `netChange: 260` (`types.ts:76`). Measured on the real
tournament: at 1000, all 54 matches place on the same venue and the same day,
with back-to-back down from 9 to 6. That is not a proposed fix — it works by
accidentally clustering the whole 2.24 m endgame out of the final layer, not
by reasoning about net heights — but it does prove the day is long enough and
the failure is one of pricing, not capacity.

Both halves of the map's fog patch *"minimising net changes as a placement
rule rather than a price"* meet here. This ticket is the endgame half of it;
`03` and `04` cover pool play.
