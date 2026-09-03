/* What a global "all round robins finish before any bracket starts" barrier
 * costs, and which lever pays for it. */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail('test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
const hhmm = (m: number) => `d${Math.floor(m / 1440)} ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function run(label: string, over: Record<string, unknown>) {
  const r = generateSchedule(divisions, { ...detail.scheduleConfig, ...over }, detail.dayCount);
  let feeder = 0;
  const by = new Map(r.placements.map(p => [p.matchId, p]));
  for (const p of r.placements) for (const dep of r.graph.nodes.get(p.matchId)!.deps) {
    const d = by.get(dep); if (d && d.endAbs === p.startAbs) feeder++;
  }
  const finish = Math.max(...r.placements.map(p => p.endAbs));
  const late = r.placements.filter(p => p.endAbs - p.day * 1440 > r.grid.dayEnd).length;
  console.log(`${label.padEnd(34)} finish ${hhmm(finish).padEnd(9)} overflow ${String(r.overflow.length).padStart(2)}  b2b ${String(r.backToBack).padStart(2)}  straight-back-on ${String(feeder).padStart(2)}  nets ${String(r.pivots).padStart(2)}  past-close ${late}`);
}

const barrier = process.env.POOL_BARRIER ? 'barrier ON ' : 'barrier off';
run(`${barrier} as configured`, {});
run(`${barrier} finals concurrent`, { stageFinals: false });
run(`${barrier} 5 courts`, { courtCount: 5 });
run(`${barrier} break ends 14:00`, { lunchEnd: '14:00' });
run(`${barrier} 5 courts + concurrent finals`, { courtCount: 5, stageFinals: false });
