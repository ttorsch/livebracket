# Directive: Test Schedule Generator

## Purpose
Run exhaustive combinatorial testing on the LiveBracket schedule generator across varieties of division counts, team counts, day counts, court capacities, net heights, and competition formats (Single Elimination and Double Elimination under current UI behavior). Audit schedule quality with particular focus on court packing and verifying that no empty spaces exist except for legitimate staging matches and dependency rest buffers.

## Inputs
- Database connection via `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Schedule generator engine in `lib/schedule/generate.ts`
- Schedule validator in `lib/schedule/validate.ts`
- Draw generation logic in `app/api/tournaments/[slug]/divisions/[divisionId]/draw/route.ts`
- Organizer account: `00000000-0000-0000-0001-000000000001` (Khao Lak Volley)

## Outputs
- Exhaustive combinatorial test execution across 40+ scenarios
- 5 live test tournaments persisted to Supabase and accessible on `/dashboard/tournament/[id]/schedule`
- Invariants validation report (no court double-booking, no team overlap, strict dependency ordering)
- Timeline empty space audit report (classifying every court gap as Lunch, Net Buffer, Staging Hold, Feeder Rest, or Unjustified)
- Live UI verification confirming HTTP 200 on all schedule pages
- Comprehensive walkthrough artifact
