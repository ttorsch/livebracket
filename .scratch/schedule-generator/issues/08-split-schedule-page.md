# Decide how to split the schedule page

Type: grilling
Status: open
Blocked by: 01, 02, 06

## Question

`app/dashboard/tournament/[id]/schedule/page.tsx` is 2,369 lines with ~25 pieces
of state (edit mode, block mode, drag/insert, nav, preview, overrides, filters,
view mode…), beside a 2,490-line stylesheet. Every symptom on this map lives in
it, and the contrast with `lib/schedule/*` — a clean, tested, documented pipeline
— is stark: the tested layer was green while all three reported bugs sat in the
untested one.

Deliberately blocked until `01`, `02` and `06` are done. Seams are learned by
editing, not by reading; after three fixes have landed there will be evidence
about which parts actually churn together rather than a guess.

Open questions for that session:

1. Which seams are real? Candidates visible now: the calendar derivation
   (`page.tsx:900-1030`, pure and testable today), the edit/drop layer
   (already partly extracted to `lib/schedule/dropPlan.ts`), the generate panel,
   and the two view renderers.
2. What becomes testable? The calendar derivation is a pure function of matches
   plus config and would have caught the floating-axis defect (`02`) as a unit
   test. That is the strongest argument for a seam there.
3. Does the CSS split along the same lines, or differently?
4. Is this worth doing at all, given the destination is working behaviour? A
   defensible answer is "extract only the calendar derivation and stop".

Consult `codebase-design` for the deep-module vocabulary. Consider whether the
result deserves an ADR — the three tests in `domain-modeling` (hard to reverse,
surprising without context, a real trade-off) plausibly all hold.
