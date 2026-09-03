/* Throwaway: does the extracted handover hand the solver exactly what the
 * schedule screen used to, on real tournament data?
 *
 * The old derivation is reproduced verbatim below from the memo that lived in
 * app/dashboard/tournament/[id]/schedule/page.tsx before this ticket. Both are
 * run over every tournament in the database and compared field by field, and
 * then both inputs are put through the real solver and the placements compared.
 *
 * Run with:
 *   node --experimental-strip-types \
 *     --import ./.scratch/schedule-placement/assets/ts-resolve-register.mjs \
 *     .scratch/schedule-placement/assets/06-handover-parity.ts
 */

import { getTournamentDetail, type DetailDivision } from '../../../lib/data.ts';
import { labelDivisionMatches, loserFeedersOf, type MatchLabel } from '../../../lib/divisionMatches.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule, normaliseConfig } from '../../../lib/schedule/generate.ts';
import type { SchedulableDivision } from '../../../lib/schedule/types.ts';

/** The memo exactly as it stood before the extraction. */
function oldHandover(
  divisions: DetailDivision[],
  labelsByDivision: Map<string, Map<string, MatchLabel>>,
  overrides: Record<string, number | null>,
): SchedulableDivision[] {
  return divisions.map(d => {
    const losers = loserFeedersOf(d);
    return {
      id: d.id,
      label: d.label,
      pools: d.drawConfig?.pools ?? 1,
      netHeight: d.netHeight,
      gender: d.gender,
      dedicatedCourts: overrides[d.id] ?? d.dedicatedCourts ?? null,
      matches: d.bracket.flatMap((r, rIdx) =>
        r.matches
          .filter(m => !labelsByDivision.get(d.id)?.get(m.id)?.bye)
          .map(m => ({
            id: m.id,
            teamA: m.teamAId,
            teamB: m.teamBId,
            isPool: r.format === 'round-robin',
            pool: labelsByDivision.get(d.id)?.get(m.id)?.pool ?? null,
            durationMinutes: r.durationMinutes,
            roundIndex: rIdx,
            ...(losers[m.id] ? { isThirdPlace: true, dependsOn: losers[m.id] } : {}),
          })),
      ),
    };
  });
}

const SLUGS = ['test-tournament', 'summer-beach', 'test-touney', 'sideout-beach-volleyball-tournament'];

let failures = 0;

for (const slug of SLUGS) {
  const detail = await getTournamentDetail(slug);
  if (!detail) { console.log(`${slug}: not found`); continue; }

  const divisions = detail.divisions;
  const oldLabels = new Map<string, Map<string, MatchLabel>>();
  divisions.forEach(d => oldLabels.set(d.id, labelDivisionMatches(d)));

  const before = oldHandover(divisions, oldLabels, {});
  const after = toSchedulableDivisions(divisions, labelDivisions(divisions), {});

  const same = JSON.stringify(before) === JSON.stringify(after);
  const matchCount = after.reduce((n, d) => n + d.matches.length, 0);
  const poolCount = after.reduce((n, d) => n + d.matches.filter(m => m.isPool).length, 0);
  const formats = [...new Set(divisions.flatMap(d => d.bracket.map(r => r.format)))].sort();

  console.log(
    `${slug}: ${divisions.length} divisions, ${matchCount} matches ` +
    `(${poolCount} pool), formats [${formats.join(', ')}] — handover ${same ? 'IDENTICAL' : 'DIFFERS'}`,
  );
  if (!same) {
    failures++;
    console.log('  before:', JSON.stringify(before, null, 2).slice(0, 2000));
    console.log('  after: ', JSON.stringify(after, null, 2).slice(0, 2000));
    continue;
  }

  if (matchCount === 0) { console.log('  (no matches drawn — solver skipped)'); continue; }

  // Same input, so the solver must produce the same placements. Run it on both
  // anyway: the point is the whole chain, not just the handover.
  const config = normaliseConfig({
    startDate: detail.date,
    endDate: detail.endDate ?? detail.date,
    courts: 4,
  } as never);
  const a = generateSchedule(before, config);
  const b = generateSchedule(after, config);
  const key = (r: typeof a) =>
    JSON.stringify(r.assignments.map(p => [p.matchId, p.court, p.day, p.time]).sort());
  const placementsSame = key(a) === key(b);
  console.log(
    `  solver: ${a.assignments.length} placed — placements ${placementsSame ? 'IDENTICAL' : 'DIFFER'}`,
  );
  if (!placementsSame) failures++;
}

console.log(failures === 0 ? '\nALL IDENTICAL' : `\n${failures} MISMATCH(ES)`);
