import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';

const detail = (await getTournamentDetail(process.argv[2] ?? 'test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
for (const d of divisions) {
  const pool = d.matches.filter(m => m.isPool);
  const ids = new Set<string>();
  for (const m of pool) { if (m.teamA) ids.add(m.teamA); if (m.teamB) ids.add(m.teamB); }
  const nulls = pool.filter(m => !m.teamA || !m.teamB).length;
  console.log(`${d.label}: ${pool.length} pool matches, ${ids.size} distinct team ids, ${nulls} with a missing side`);
  console.log(`   ids: ${[...ids].map(i => i.slice(0, 13)).join(' ')}`);
}
