# Show the problems before you save, and make rest two-state

Type: task
Status: resolved
Assignee: Antigravity
Blocked by: —

## Question

The build behind [05](05-pool-play-has-no-rest-rule.md), which decided the
telling and handed the rule to `04`. Nothing here changes how a match is
placed; `assign.ts`'s `!node.isPool` filter is **not** touched by this ticket.

1. **Run the validator over the preview.** `page.tsx:1094` builds graph, grid,
   labels and team names already and then feeds them `allMatches` — the saved
   data. The preview's placements never reach it, which is why a generate says
   nothing and the save that follows lights up 48 faults. Map
   `preview.assignments` into `EditedPlacement[]` and validate the schedule the
   organizer is looking at. The full fault set, not rest only.
2. **Make rest two-state.** `minRestSlots` already means *matches* and already
   defaults to 1; the middle state is manufactured by
   `minRestSlots × blockMinutes` being compared against elapsed minutes. The
   question asked of a team becomes "was there a whole match between these
   two?" — no partial answer anywhere. `restDeficitSlots`,
   `averageRestMinutes` and the deficit half of `restCost` lose their subject;
   check each before pulling, all three are currently displayed **nowhere**.
   validate's *"whoever wins X gets only 20 min"* branch collapses into its
   `gap === 0` sibling.
3. **Collapse the ladder's two rest rungs into one.** `assign.ts:145` steps
   `minRestMinutes: 1` and `assign.ts:148` steps it to `0`. Under two-state
   rest the first buys nothing, so it reports a promise given up where none
   was. One rung, kept last, where `backToBack` is now.
4. **One volume for two lists.** `preview.backToBack` is prose between the net
   count and the first-round note; the given-up-promises line beside it carries
   an `AlertTriangle`. Give the back-to-back count the same weight, and put the
   problem count next to it now that the preview has one.
5. **Pulse a card on arrival from the problem list.** `matchItemFault` and
   `gridMatchCardFault` keep the red border and wash as the permanent mark.
   The pulse fires only on the card you jumped to, and only there. This file
   already has a `prefers-reduced-motion` block at `page.module.css:338` — the
   pulse belongs in it, and the jump must still mark and scroll with animation
   off.

## Notes

Deliberately **not** in this ticket: dropping the pool-play rest exemption
(that is `04`, and it strands courts until turns exist), giving `restIsHard` or
`minRestSlots` an organizer control (`05` decision 5), and attaching causes to
problems (`09`).

The rest-related tests in `generate.test.ts` assert on
`metrics.tightestRestMinutes >= 45` and on `relaxations` contents — both move
under 2 and 3. They are the check that this ticket did not change placement,
so update them deliberately rather than to make them pass.

## Answer

All five requirements have been implemented and verified:

1. **Validator over preview**: `page.tsx` now validates working-state placements drawn by the preview (`preview.assignments` merged with hand edits) using a safe base date fallback (`detail.startDate || '2026-01-01'`) in `allMatches`. The full schedule validation rules (rest, court collisions, feeder dependencies, net height buffers, venue time bounds) evaluate live against the preview before any save occurs.
2. **Two-state rest**: Rest is now strictly two-state across the solver and validator: either a team gets a whole match between two appearances, or they play back-to-back (`gap <= 0`).
   - Removed artificial fractional deficit metrics (`restDeficitSlots`, `averageRestMinutes`, and `deficit` cost surcharge in `cost.ts`).
   - In `validate.ts`, the feeder rest check collapsed into the `gap === 0` branch ("whoever wins X walks straight back on").
3. **Collapsed ladder rungs**: In `assign.ts`, removed the redundant intermediate `minRestMinutes: 1` rung (`restIsHard`), keeping only `minRestMinutes: 0` (`backToBack`) as the single final rest rung.
4. **Equal warning volume**: In `previewBar`, `preview.backToBack` is rendered as an `AlertTriangle` warning when `> 0`. Next to it, an interactive `{problems.length} problem{s}` trigger button is rendered whenever problems exist. The same interactive button is provided in `editBar`.
5. **Card pulse on jump**: Triggering any problem in the problem popover list switches to the appropriate day/division view if necessary, scrolls the target match card into view (`scrollIntoView({ block: 'center' })`), and triggers a 1.5s visual pulse (`faultPulse`) on both Grid View (`gridMatchCard`) and Court View (`matchItem`). The animation is disabled under `prefers-reduced-motion: reduce`, where the card simply scrolls and remains visibly highlighted.

### Verification
- Added test in `generate.test.ts`: `reports walk straight back on when feeder match ends at dependent match start`.
- Updated test in `generate.test.ts`: `says so when the venue is too tight to give anyone rest` asserting on `backToBack` relaxation.
- All 274 tests across the repository pass (`npm test`).
- Typecheck passes cleanly (`npx tsc --noEmit`).
