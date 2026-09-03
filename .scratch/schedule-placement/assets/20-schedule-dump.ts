/* Prints the generated schedule for a real tournament, day by day, and says
 * where every back-to-back pair came from. */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail(process.argv[2] ?? 'test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
const r = generateSchedule(divisions, detail.scheduleConfig, detail.dayCount);
const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const short = (id: string) => (r.graph.nodes.get(id)!.divisionLabel.split(' ')[0]);

for (let day = 0; day < detail.dayCount; day++) {
  console.log(`\n=== day ${day} ===`);
  const rows = new Map<number, string[]>();
  for (const p of r.placements.filter(p => p.day === day)) {
    const n = r.graph.nodes.get(p.matchId)!;
    const tag = n.isPool ? `pool${n.pool ?? ''}` : `r${n.roundIndex}`;
    (rows.get(p.startAbs) ?? rows.set(p.startAbs, []).get(p.startAbs)!).push(`${p.courtName.replace('Court ', 'C')}:${short(p.matchId)}-${tag}`);
  }
  for (const [t, list] of [...rows].sort((a, b) => a[0] - b[0])) console.log(`  ${hhmm(t)}  ${list.sort().join('  ')}`);
}

console.log('\n=== back-to-back ===');
const last = new Map<string, { end: number; id: string }>();
let pool = 0, knockout = 0;
for (const p of [...r.placements].sort((a, b) => a.startAbs - b.startAbs)) {
  const n = r.graph.nodes.get(p.matchId)!;
  for (const t of [n.teamA, n.teamB]) {
    if (!t) continue;
    const prev = last.get(t);
    if (prev && prev.end === p.startAbs) {
      n.isPool ? pool++ : knockout++;
      console.log(`  ${hhmm(p.startAbs)} d${p.day} ${short(p.matchId)} ${n.isPool ? 'pool' : 'r' + n.roundIndex} — ${t.slice(0, 8)} straight from ${prev.id.slice(0, 8)}`);
    }
    last.set(t, { end: p.endAbs, id: p.matchId });
  }
}
console.log(`  pool ${pool}, knockout ${knockout}`);
