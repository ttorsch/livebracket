/* Repro for issue 01: "an unscheduled match, and the time shown will fit".
 *
 * Runs the real solver against the organizer's real tournament, exactly as the
 * schedule screen builds it: getTournamentDetail -> toSchedulableDivisions ->
 * generateSchedule. Then, for every overflowed match, asks the question the
 * ticket asks — was there a free court-slot it could have taken, at or after
 * the moment its dependencies were done?
 *
 * Run with:
 *   node --experimental-strip-types \
 *     --import ./.scratch/schedule-placement/assets/ts-resolve-register.mjs \
 *     --env-file=.env.local \
 *     .scratch/schedule-placement/assets/01-real-tournament-repro.ts
 */
import { getTournamentDetail } from '../../../lib/data.ts';
import { labelDivisions, toSchedulableDivisions } from '../../../lib/schedule/schedulableDivisions.ts';
import { generateSchedule } from '../../../lib/schedule/generate.ts';
import { courtOpen, slotSpan, DAY_SPAN } from '../../../lib/schedule/grid.ts';

const slug = process.argv[2] ?? 'test-tournament';
const detail = await getTournamentDetail(slug);
if (!detail) throw new Error(`no tournament ${slug}`);

const labels = labelDivisions(detail.divisions);
const divisions = toSchedulableDivisions(detail.divisions, labels);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.trunc(m) % 60).padStart(2, '0')}`;

console.log(`=== ${detail.title} (${slug}) — ${detail.dayCount} day(s) ===`);
console.log(`config: ${JSON.stringify(detail.scheduleConfig)}`);
for (const d of divisions) {
  const byRound = new Map<number, number>();
  for (const m of d.matches) byRound.set(m.roundIndex, (byRound.get(m.roundIndex) ?? 0) + 1);
  console.log(`  ${d.label}: ${d.matches.length} schedulable matches, pools=${d.pools}, net=${d.netHeight}, dedicated=${d.dedicatedCourts}`);
  console.log(`     rounds: ${[...byRound].map(([r, n]) => `r${r}=${n}${d.matches.find(m => m.roundIndex === r)!.isPool ? '(pool)' : ''}×${d.matches.find(m => m.roundIndex === r)!.durationMinutes}m`).join(' ')}`);
}

const r = generateSchedule(divisions, detail.scheduleConfig, detail.dayCount);
const { grid, graph, placements } = r;

console.log(`\n--- outcome ---`);
console.log(`placed ${placements.length}, OVERFLOW ${r.overflow.length}, back-to-back ${r.backToBack}, net changes ${r.pivots}`);
console.log(`grid: ${grid.days}d × ${grid.slotsPerDay} slots × ${grid.courts.length} courts, slotMinutes=${grid.slotMinutes}, block=${grid.blockMinutes}`);
console.log(`      day starts: ${grid.slotStarts.map(hhmm).join(' ')}`);
console.log(`playable/court/day ${grid.playableMinutesPerCourt}m; court-minutes/day ${grid.courtMinutesPerDay}`);
console.log(`relaxations: ${r.relaxations.length ? JSON.stringify(r.relaxations) : '(none)'}`);
for (const c of r.capacity) console.log(`  day ${c.day}: ${c.matches} matches, ${c.matchMinutes}/${c.courtMinutes} court-min used (${(100 * c.matchMinutes / c.courtMinutes).toFixed(0)}%)`);

/* Occupancy: [day][courtIndex][slotIndex] taken by a placed match. */
const busy: boolean[][][] = Array.from({ length: grid.days }, () =>
  Array.from({ length: grid.courts.length }, () => Array.from({ length: grid.slotsPerDay }, () => false)));
const courtIdx = new Map(grid.courts.map((c, i) => [c.name, i]));
const endAbs = new Map<string, number>();
for (const p of placements) {
  const node = graph.nodes.get(p.matchId)!;
  const span = slotSpan(node.durationMinutes, grid.slotMinutes);
  const ci = courtIdx.get(p.courtName)!;
  for (let k = 0; k < span; k++) busy[p.slot.day][ci][p.slot.index + k] = true;
  endAbs.set(p.matchId, p.startAbs + node.durationMinutes);
}

const freeSlots = busy.flatMap((day, di) => day.flatMap((court, ci) =>
  court.map((b, si) => (!b && !grid.blocked[di]?.[ci]?.[si] ? { day: di, court: grid.courts[ci].name, ci, si } : null))))
  .filter(Boolean) as { day: number; court: string; ci: number; si: number }[];
console.log(`\nfree (unblocked, unused) court-slots across the event: ${freeSlots.length} of ${grid.days * grid.courts.length * grid.slotsPerDay}`);

if (!r.overflow.length) { console.log('\nNo overflow — nothing to explain.'); process.exit(0); }

console.log(`\n--- each overflowed match, and whether it had somewhere to go ---`);
for (const o of r.overflow) {
  const node = graph.nodes.get(o.matchId)!;
  const depEnds = node.deps.map(d => endAbs.get(d));
  const unplacedDeps = node.deps.filter(d => !endAbs.has(d));
  const ready = depEnds.some(e => e === undefined)
    ? null
    : Math.max(grid.slots[0].abs, ...(depEnds as number[]), grid.slots[0].abs);
  const span = slotSpan(node.durationMinutes, grid.slotMinutes);
  console.log(`\n[${node.divisionLabel}] ${node.id} round=${node.roundIndex} pool=${node.isPool} dur=${node.durationMinutes}m span=${span} net=${node.netHeight}`);
  console.log(`   deps: ${node.deps.length ? node.deps.map(d => `${d.slice(0, 8)}${endAbs.has(d) ? `@end ${endAbs.get(d)! % DAY_SPAN ? hhmm(endAbs.get(d)! % DAY_SPAN) : '00:00'} d${Math.floor(endAbs.get(d)! / DAY_SPAN)}` : ' UNPLACED'}`).join(', ') : '(none)'}`);
  if (unplacedDeps.length) { console.log(`   -> cannot judge: ${unplacedDeps.length} dependency also unplaced`); continue; }
  const openings = freeSlots.filter(f => {
    const slot = grid.slots[f.day * grid.slotsPerDay + f.si];
    if (slot.abs < ready!) return false;
    if (!courtOpen(grid, f.ci, slot, span)) return false;
    for (let k = 0; k < span; k++) if (busy[f.day][f.ci][f.si + k]) return false;
    return true;
  });
  console.log(`   ready from ${hhmm(ready! % DAY_SPAN)} day ${Math.floor(ready! / DAY_SPAN)}`);
  console.log(`   FREE PLACES IT COULD HAVE TAKEN: ${openings.length}`);
  for (const f of openings.slice(0, 6)) console.log(`      day ${f.day} ${f.court} @ ${hhmm(grid.slotStarts[f.si])}`);
}

/* ── The board, so the refusal can be read off it ── */
const label = (id: string) => {
  const n = graph.nodes.get(id)!;
  return `${n.divisionLabel.split(' ')[0]}/r${n.roundIndex}#${n.indexInRound}${n.isPool ? `-${n.pool}` : ''}[${n.netHeight}]`;
};
for (let d = 0; d < grid.days; d++) {
  console.log(`\n--- day ${d} ---`);
  const header = grid.courts.map(c => c.name.padEnd(24)).join('');
  console.log('     ' + header);
  for (let si = 0; si < grid.slotsPerDay; si++) {
    const row = grid.courts.map((_, ci) => {
      const p = placements.find(p => p.slot.day === d && courtIdx.get(p.courtName) === ci && p.slot.index === si);
      if (p) return (label(p.matchId) + ` ${graph.nodes.get(p.matchId)!.durationMinutes}m`).padEnd(24);
      const covered = placements.some(p => {
        if (p.slot.day !== d || courtIdx.get(p.courtName) !== ci) return false;
        const span = slotSpan(graph.nodes.get(p.matchId)!.durationMinutes, grid.slotMinutes);
        return si > p.slot.index && si < p.slot.index + span;
      });
      if (covered) return '  |'.padEnd(24);
      if (grid.blocked[d]?.[ci]?.[si]) return '  ##BLOCKED'.padEnd(24);
      return '  .'.padEnd(24);
    }).join('');
    console.log(`${hhmm(grid.slotStarts[si])} ${row}`);
  }
}
