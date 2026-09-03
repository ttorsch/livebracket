import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail('test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));

for (const [label, over] of [
  ['as configured        ', {}],
  ['stageFinals off      ', { stageFinals: false }],
  ['finalsOnLastDay off  ', { finalsOnLastDay: false }],
  ['both off             ', { stageFinals: false, finalsOnLastDay: false }],
] as const) {
  const r = generateSchedule(divisions, { ...detail.scheduleConfig, ...over }, detail.dayCount);
  const byDiv = new Map<string, number>();
  for (const o of r.overflow) byDiv.set(o.divisionId, (byDiv.get(o.divisionId) ?? 0) + 1);
  const names = [...byDiv].map(([id, n]) => `${divisions.find(d => d.id === id)?.label}:${n}`).join(' ');
  console.log(`${label} placed=${String(r.placements.length).padStart(2)} overflow=${String(r.overflow.length).padStart(2)} b2b=${r.backToBack} nets=${r.pivots}  ${names}`);
}
