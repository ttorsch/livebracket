/* Repro for: A net change must not eat the start of a day (issue 14).
 *
 * Rebuilds Test Tournament's shape — two 2.43 m divisions and one 2.24 m, two
 * pools of four each, 4 courts, 09:00-17:00 over two days — and prints the first
 * match on every court of every day. Three of them start at 09:15 with the
 * buffer on and all of them start at 09:00 with it off, which is the finding.
 *
 * Run with:  node --experimental-strip-types .scratch/schedule-generator/assets/14-net-buffer-repro.ts
 */

import { generateSchedule, normaliseConfig, type SchedulableDivision, type SchedulableMatch } from '../../../lib/schedule/generate.ts';

/** Two pools of four: 6 matches per pool, 12 in all — as Test Tournament has. */
function poolDivision(id: string, netHeight: string): SchedulableDivision {
  const matches: SchedulableMatch[] = [];
  for (const pool of ['A', 'B']) {
    const t = Array.from({ length: 4 }, (_, i) => `${id}-${pool}${i + 1}`);
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
      matches.push({ id: `${id}-${pool}-${a}${b}`, teamA: t[a], teamB: t[b], isPool: true, pool, roundIndex: 0, durationMinutes: 30 });
  }
  for (let i = 0; i < 2; i++)
    matches.push({ id: `${id}-sf${i}`, teamA: null, teamB: null, isPool: false, roundIndex: 1, durationMinutes: 45 });
  matches.push({ id: `${id}-f`, teamA: null, teamB: null, isPool: false, roundIndex: 2, durationMinutes: 45 });
  return { id, label: id.toUpperCase(), pools: 2, netHeight, gender: null, matches };
}

/** Mixed Open: one pool match, then semis and a final. */
function mixed(): SchedulableDivision {
  const matches: SchedulableMatch[] = [
    { id: 'mixed-p', teamA: 'mx-1', teamB: 'mx-2', isPool: true, pool: 'A', roundIndex: 0, durationMinutes: 30 },
    { id: 'mixed-sf0', teamA: null, teamB: null, isPool: false, roundIndex: 1, durationMinutes: 45 },
    { id: 'mixed-sf1', teamA: null, teamB: null, isPool: false, roundIndex: 1, durationMinutes: 45 },
    { id: 'mixed-f', teamA: null, teamB: null, isPool: false, roundIndex: 2, durationMinutes: 45 },
  ];
  return { id: 'mixed', label: 'MIXED', pools: 2, netHeight: '2.43 m', gender: null, matches };
}

const divisions = [poolDivision('men', '2.43 m'), mixed(), poolDivision('women', '2.24 m')];
const base = normaliseConfig({
  startTime: '09:00', endTime: '17:00', courtCount: 4, blockMinutes: 45,
  lunchStart: '12:00', lunchEnd: '13:00', netBufferMinutes: 15,
  minRestSlots: 1, finalsOnLastDay: true, stageFinals: true,
  dayPlan: 'parallel-daily', repairIterations: 4000,
});

const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const run = (label: string, over: Record<string, unknown>) => {
  const r = generateSchedule(divisions, { ...base, ...over }, 2);
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const first = new Map<string, string>();
  for (const a of r.assignments) {
    const k = `day ${a.day} · ${a.court}`;
    if (!first.has(k) || min(a.time) < min(first.get(k)!)) first.set(k, a.time);
  }
  const late = [...first.entries()].filter(([, t]) => t !== '09:00');
  console.log(`\n--- ${label} ---`);
  console.log([...first.entries()].sort().map(([k, t]) => `${k}: ${t}${t === '09:00' ? '' : '  <-- LATE'}`).join('\n'));
  console.log(`late courts: ${late.length}`);
};

run('as configured (netBuffer 15)', {});
run('netBuffer 0', { netBufferMinutes: 0 });
run('netBuffer 15, no repair', { repairIterations: 0 });
