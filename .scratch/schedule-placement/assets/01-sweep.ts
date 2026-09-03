/* Is the one overflow avoidable at all under the configured day? Sweeps the
 * knobs that change placement without changing the venue or the day.
 *
 * Run with the loader, as 01-real-tournament-repro.ts documents:
 *   node --experimental-strip-types \
 *     --import ./.scratch/schedule-placement/assets/ts-resolve-register.mjs \
 *     --env-file=.env.local \
 *     .scratch/schedule-placement/assets/01-sweep.ts
 */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';

const detail = (await getTournamentDetail('test-tournament'))!;
const divisions = toSchedulableDivisions(detail.divisions, labelDivisions(detail.divisions));
const base = detail.scheduleConfig as Record<string, unknown>;
const W = ['restDeficit','backToBack','netChange','venueSpan','paceDeviation','depthUrgency','showCourtMisuse','courtChurn','divisionSpread'];

let best = 99, bestName = '';
const run = (name: string, over: Record<string, unknown>) => {
  const r = generateSchedule(divisions, { ...base, ...over }, detail.dayCount);
  if (r.overflow.length < best) { best = r.overflow.length; bestName = name; }
  return r.overflow.length;
};

for (const sf of [true, false]) for (const fl of [true, false]) for (const dp of ['parallel-daily', 'compress-division']) {
  const n = run(`sf=${sf} fl=${fl} ${dp}`, { stageFinals: sf, finalsOnLastDay: fl, dayPlan: dp });
  console.log(`stageFinals=${String(sf).padEnd(5)} finalsOnLastDay=${String(fl).padEnd(5)} ${dp.padEnd(18)} overflow=${n}`);
}
console.log('\n--- netChange weight sweep (steer away from the 2.43 trap) ---');
for (const w of [0, 100, 260, 1000, 5000, 20000]) {
  console.log(`  netChange weight ${String(w).padStart(5)}: overflow=${run(`nw${w}`, { weights: { netChange: w } })}`);
}
console.log('\n--- repairIterations ---');
for (const it of [0, 4000, 50000]) console.log(`  repairIterations ${String(it).padStart(6)}: overflow=${run(`it${it}`, { repairIterations: it })}`);
console.log(`\nbest seen: ${best} overflow (${bestName})`);
