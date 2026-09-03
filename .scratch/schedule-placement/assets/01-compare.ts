/* The last two slot-layers of day 1, at the default netChange weight and at
 * 1000 — the same venue, the same day, one placeable and one not.
 *
 * Run with the loader, as 01-real-tournament-repro.ts documents:
 *   node --experimental-strip-types \
 *     --import ./.scratch/schedule-placement/assets/ts-resolve-register.mjs \
 *     --env-file=.env.local \
 *     .scratch/schedule-placement/assets/01-compare.ts
 */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail('test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
const base = detail.scheduleConfig as Record<string, unknown>;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

for (const w of [undefined, 1000]) {
  const r = generateSchedule(divisions, w ? { ...base, weights: { netChange: w } } : base, detail.dayCount);
  console.log(`\n===== netChange weight ${w ?? 'default(260)'} — placed ${r.placements.length}, overflow ${r.overflow.length}, b2b ${r.backToBack}, nets ${r.pivots} =====`);
  console.log(`relaxations: ${r.relaxations.join(' | ') || '(none)'}`);
  const g = r.grid;
  const ci = new Map(g.courts.map((c, i) => [c.name, i]));
  console.log('       ' + g.courts.map(c => c.name.padEnd(22)).join(''));
  for (let si = 10; si < g.slotsPerDay; si++) {
    const row = g.courts.map((_, i) => {
      const p = r.placements.find(p => p.slot.day === 1 && ci.get(p.courtName) === i && p.slot.index === si);
      if (!p) return '  .'.padEnd(22);
      const n = r.graph.nodes.get(p.matchId)!;
      return `${n.divisionLabel.split(' ')[0]}/r${n.roundIndex} ${n.netHeight}`.padEnd(22);
    }).join('');
    console.log(`${hhmm(g.slotStarts[si])}  ${row}`);
  }
  for (const o of r.overflow) {
    const n = r.graph.nodes.get(o.matchId)!;
    console.log(`  UNPLACED: ${n.divisionLabel} round ${n.roundIndex} (${n.netHeight} m, ${n.durationMinutes}m)`);
  }
}
