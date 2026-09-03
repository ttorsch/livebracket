/* Single-variable differentials against the real tournament, to decide which
 * hypothesis explains the one overflowed match. See 01-real-tournament-repro.ts.
 *
 * Run with the loader, as 01-real-tournament-repro.ts documents:
 *   node --experimental-strip-types \
 *     --import ./.scratch/schedule-placement/assets/ts-resolve-register.mjs \
 *     --env-file=.env.local \
 *     .scratch/schedule-placement/assets/01-variants.ts
 */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail(process.argv[2] ?? 'test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
const base = detail.scheduleConfig as Record<string, unknown>;

const run = (name: string, over: Record<string, unknown>) => {
  const r = generateSchedule(divisions, { ...base, ...over }, detail.dayCount);
  const over_ = r.overflow.map(o => `${r.graph.nodes.get(o.matchId)!.divisionLabel}/r${r.graph.nodes.get(o.matchId)!.roundIndex}`);
  console.log(`${name.padEnd(42)} overflow=${String(r.overflow.length).padStart(2)} ${over_.join(',').padEnd(18)} b2b=${String(r.backToBack).padStart(2)} nets=${r.pivots} relax=${r.relaxations.join('|') || '(none)'}`);
};

run('baseline (as configured)', {});
run('H1a netBufferMinutes: 0', { netBufferMinutes: 0 });
run('H1b netBufferMinutes: 5', { netBufferMinutes: 5 });
run('H1c endTime 17:15', { endTime: '17:15' });
run('H1d endTime 17:30', { endTime: '17:30' });
run('H3  endTime 18:00', { endTime: '18:00' });
run('H4a stageFinals: false', { stageFinals: false });
run('H4b finalsOnLastDay: false', { finalsOnLastDay: false });
run('ctl lunchEnd 13:00 (longer day)', { lunchEnd: '13:00' });
run('ctl restIsHard: true', { restIsHard: true });
run('ctl 6 courts', { courtCount: 6 });
