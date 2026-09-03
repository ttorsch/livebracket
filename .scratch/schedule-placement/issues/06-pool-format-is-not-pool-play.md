# A round set up as "Pool Play" is not pool play to the solver

Type: task
Status: resolved
Blocked by: —

## Question

`app/dashboard/tournament/[id]/schedule/page.tsx:866`:

```ts
isPool: r.format === 'round-robin',
```

The schema allows four round formats — `'pool' | 'round-robin' | 'single' |
'double'` (migration 0001) — and `lib/roundFormat.ts` labels `'pool'` as
**"Pool Play"** in the organizer's own dropdown. `isGroupFormat` in that same
file treats `'pool'` and `'round-robin'` as the same kind of thing. The
schedule page does not.

So a division whose round the organizer configured as *Pool Play* produces
`isPool: false` for every one of its matches, and therefore:

- `planPoolPlay` filters on `n.isPool`, gets nothing, returns null — **no
  rotation and no court appetite** for that division;
- `courtAffinity` falls back to `autoDedicatedCourts(pools)` instead of the
  rotation's number, so the division is sized wrong;
- `buildStaging` builds no pool waves for it;
- `assign.ts` applies the **knockout** rest filter to every pool match, since
  that branch keys off `!node.isPool`.

Measured on identical tournaments differing only in the format string: the
`'pool'` path produced **0** back-to-back matches and the `'round-robin'` path
**48**, because the `'pool'` path accidentally lands in the hard-rest branch.
The right behaviour is arriving for the wrong reason, on a code path nobody
designed, for the format with the more obvious name.

Blocks `02`, because a rotation rule means nothing for divisions that never
reach the rotation.

## Notes

`isPool` is set from real data in exactly one place, which is why this is
small. Check `sortBySlots` and the draw route for whether `'pool'` and
`'round-robin'` differ anywhere else before collapsing them.

## Answer

**Pool play is not a round format, so `'pool'` is gone.** Whether a round robin
is played in pools is the *pool count on the draw*, not the format string: one
pool is a round robin, four pools is pool play, and both are `'round-robin'`.
`'pool'` was a second name for a thing that already had one, and the two names
were not treated alike — which is the whole defect. Removed from `RoundFormat`,
from the label map, and from the schema in
[migration 0010](../../../supabase/migrations/0010_drop_pool_round_format.sql).
Added to the root `CONTEXT.md` as **Round format**.

Free to do, because the value was never reachable. The ticket says
`lib/roundFormat.ts` "labels `'pool'` as **Pool Play** in the organizer's own
dropdown" — it does not. The setup page has its own `ROUND_FORMATS` list
offering round robin, single and double, and its own `RoundFormat` type that
already excluded `'pool'`; `ROUND_FORMAT_LABEL` is read in exactly one place,
the public page's round name. Confirmed against the database: `single` × 16,
`round-robin` × 5, `pool` × 0. So this was a **latent hole, not a live defect** —
the 0-vs-48 measurement in the ticket came from a hand-made format string, not
from anything an organizer could produce.

### The hole was wider than the one line

`isPool` was set in one place, but "is this a group round?" was **asked in six**,
and they did not agree:

| Where | Asked as |
|---|---|
| `lib/roundFormat.ts` | `'round-robin' \|\| 'pool'` |
| `lib/divisionMatches.ts` | `'single' \|\| 'double'` — a second copy of `isKnockoutFormat` |
| schedule page | `=== 'round-robin'` |
| dashboard page | `=== 'round-robin'` × 4, `'single' \|\| 'double'` × 3 |
| draw route | `=== 'round-robin'` × 3, `'single' \|\| 'double'` × 3 |
| setup page | its own `RoundFormat` type and its own label map |

All of them now go through `isGroupFormat` / `isKnockoutFormat`, and the
duplicate `isKnockoutRound` reads the shared one. Deleting `'pool'` closes
today's hole; the single predicate is what stops a fifth format reopening it.
Two more duplicates fell out on the way: the dashboard's `FORMAT_LABELS` (a
third copy of the label map) is gone, and the setup page's format cards are now
built from `RoundFormat` exhaustively rather than hand-listed — a format the
schema allows but the picker forgets is a format nobody can choose and every
reader still has to handle.

Two spots the hole also reached, neither in the ticket:

- **The draw route** looked for the pool round by the same exact string, so a
  `'pool'` round meant `hasRoundRobin === false` and the division would have
  been drawn as a **pure elimination bracket** — not just scheduled wrong,
  *drawn* wrong.
- **The division PUT route** matches saved scoring rules to rounds by format
  and falls back to `formatRounds[0]` when nothing matches, so a `'pool'` round
  would have silently taken another round's match length.

### No validation guard

Asked whether the division route should reject an unrecognised format on
arrival. **No** — the format picker is the only way a round gets a format, and
it is a fixed list. The check constraint stays the backstop. (Noted because it
was a live question, not an oversight.)

### The handover is out of the page and tested

The step that turns a drawn bracket into the solver's input lived inside the
schedule screen's render, mixed in with the code that draws the grid, and
nothing checked it. It is now
[`lib/schedule/schedulableDivisions.ts`](../../../lib/schedule/schedulableDivisions.ts):
a pure function over plain data, with 17 tests.

This is the seam worth protecting, because everything the generator knows about
a tournament arrives through it, and **no later phase can tell that a fact it
was handed was wrong**. A mis-derived `isPool` reshapes the pool rotation, the
court appetite, the staging waves and which rest rule applies — all silently,
all at once, and the schedule that comes out still looks plausible. The tests
pin the three things derived rather than copied (pool flag, pool name,
third-place feeders), the two dropped (byes), and the three that must not be
guessed (an undrawn division is *one* pool not zero; a cleared court override
is *not* an override of zero; an unrecognised format is *not* pool play).

### Behavioural check — done

**Parity on real data.** The old memo was reproduced verbatim and run beside the
extracted function over every tournament in the database
([`assets/06-handover-parity.ts`](../assets/06-handover-parity.ts)):

| Tournament | Divisions | Matches | Handover | Solver placements |
|---|---|---|---|---|
| test-tournament | 3 | 54 (36 pool) | identical | identical (50 placed) |
| sideout-beach-volleyball-tournament | 2 | 0 | identical | — |
| summer-beach | 0 | 0 | identical | — |
| test-touney | 0 | 0 | identical | — |

Byte-identical input, and the real solver run on both produces the same
placement for every match. This is stronger evidence than a screenshot for a
change that is entirely a pure data transform.

**Rendering.** The schedule, dashboard-tournament, setup and public tournament
pages all load with no console errors. The public page still reads "Round
Robin" / "Single Elimination" and still shows the advancing and crossing panels,
which hang off `isGroupFormat`.

**Migration.** Not applied — 0009 is written and unapplied too, so that is the
repo's convention. Verified it will validate: zero rows in `rounds` carry a
format outside the new list.

267 tests green (17 new), `tsc` and `eslint` clean on every file touched.

**Not exercised in a browser**: generating a schedule. The generator needs an
organizer session and I did not sign in. The parity run covers it more
precisely than clicking would — same solver, same real data, same placements.

### Surfaced, not fixed

On `test-tournament`, 54 matches went in and **50 came out placed** — four
unplaced. Not evidence for `01`: the court count in the parity script is
invented (4), not the tournament's saved venue, so this is very likely a
genuinely full venue rather than the idle-venue overflow `01` is hunting. Worth
one run against the real configuration when `01` is taken, and no more than
that.
