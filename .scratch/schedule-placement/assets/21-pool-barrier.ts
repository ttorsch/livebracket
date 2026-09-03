/* Measures the cost of a global barrier: no knockout anywhere until every
 * division's round robin is finished. Run with and without POOL_BARRIER. */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail(process.argv[2] ?? 'test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
const r = generateSchedule(divisions, detail.scheduleConfig, detail.dayCount);
const hhmm = (m: number) => `d${Math.floor(m / 1440)} ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const pools = r.placements.filter(p => r.graph.nodes.get(p.matchId)!.isPool);
const knock = r.placements.filter(p => !r.graph.nodes.get(p.matchId)!.isPool);
let feederB2B = 0;
for (const p of r.placements) {
  const n = r.graph.nodes.get(p.matchId)!;
  for (const dep of n.deps) {
    const d = r.placements.find(x => x.matchId === dep);
    if (d && d.endAbs === p.startAbs) feederB2B++;
  }
}
const used = r.placements.reduce((t, p) => t + (p.endAbs - p.startAbs), 0);
const finish = Math.max(...r.placements.map(p => p.endAbs));
const supply = r.grid.courtMinutesPerDay * r.grid.days;
console.log(`barrier=${process.env.POOL_BARRIER ? 'ON ' : 'off'} placed=${r.placements.length} overflow=${r.overflow.length} b2b=${r.backToBack} feederB2B=${feederB2B} nets=${r.pivots}`);
console.log(`  last pool ${hhmm(Math.max(...pools.map(p => p.endAbs)))} | first knockout ${hhmm(Math.min(...knock.map(p => p.startAbs)))} | finish ${hhmm(finish)}`);
console.log(`  court-minutes used ${used} of ${supply} (${Math.round((used / supply) * 100)}%)`);
