// Unit tests for the schedule generator.
//
// Run with:  npm test
//
// Every phase is a pure function, so these assert on real invariants rather
// than on snapshots: no team in two places, no dependency played out of order,
// no court double-booked, and the promises the config makes actually kept.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_SCHEDULE_CONFIG,
  buildGraph,
  buildGrid,
  generateSchedule,
  hungarian,
  normaliseConfig,
  projectSchedule,
  scheduleInventory,
  type SchedulableDivision,
  type SchedulableMatch,
  type ScheduleConfig,
} from './generate.ts';
import { DAY_SPAN } from './grid.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

/** A division with `teams` teams: a full round-robin, then a knockout that
 *  halves down to a final. Mirrors how the app builds a bracket. */
function makeDivision(
  id: string,
  teams: number,
  opts: { netHeight?: string; gender?: string; pools?: number; duration?: number } = {},
): SchedulableDivision {
  const matches: SchedulableMatch[] = [];
  const teamIds = Array.from({ length: teams }, (_, i) => `${id}-t${i + 1}`);

  for (let a = 0; a < teams; a++) {
    for (let b = a + 1; b < teams; b++) {
      matches.push({
        id: `${id}-p${a}-${b}`,
        teamA: teamIds[a],
        teamB: teamIds[b],
        isPool: true,
        roundIndex: 0,
        durationMinutes: opts.duration,
      });
    }
  }

  // Knockout: 4 → 2 → 1.
  let round = 1;
  for (const size of [4, 2, 1]) {
    for (let i = 0; i < size; i++) {
      matches.push({
        id: `${id}-k${round}-${i}`,
        teamA: null,
        teamB: null,
        isPool: false,
        roundIndex: round,
        durationMinutes: opts.duration,
      });
    }
    round++;
  }

  return {
    id,
    label: id.toUpperCase(),
    pools: opts.pools ?? 2,
    netHeight: opts.netHeight ?? null,
    gender: opts.gender ?? null,
    matches,
  };
}

function config(over: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return normaliseConfig({ courtCount: 4, ...over });
}

/** Every invariant a schedule must satisfy no matter what. If any of these
 *  fail the schedule is simply wrong, whatever it costs. */
function assertSound(
  result: ReturnType<typeof generateSchedule>,
  label: string,
): void {
  const placed = new Map(result.placements.map(p => [p.matchId, p]));

  // 1. A court hosts one match at a time.
  const blocks = new Set<string>();
  for (const p of result.placements) {
    for (let k = 0; k < p.span; k++) {
      const key = `${p.slot.day}:${p.courtIndex}:${p.slot.index + k}`;
      assert.ok(!blocks.has(key), `${label}: court double-booked at ${key}`);
      blocks.add(key);
    }
  }

  // 2. A team is in one place at a time.
  const byTeam = new Map<string, { s: number; e: number; id: string }[]>();
  for (const p of result.placements) {
    const node = result.graph.nodes.get(p.matchId)!;
    for (const team of [node.teamA, node.teamB, node.refereeTeam]) {
      if (!team) continue;
      const list = byTeam.get(team) ?? [];
      list.push({ s: p.startAbs, e: p.endAbs, id: p.matchId });
      byTeam.set(team, list);
    }
  }
  for (const [team, list] of byTeam) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i].s >= list[i - 1].e,
        `${label}: ${team} plays ${list[i].id} before ${list[i - 1].id} has finished`,
      );
    }
  }

  // 3. Dependencies are respected — a feeder always finishes first.
  for (const p of result.placements) {
    const node = result.graph.nodes.get(p.matchId)!;
    for (const dep of node.deps) {
      const d = placed.get(dep);
      if (!d) continue;
      assert.ok(
        d.endAbs <= p.startAbs,
        `${label}: ${p.matchId} starts before its feeder ${dep} finishes`,
      );
    }
  }

  // 4. Everything sits inside the playing window.
  for (const p of result.placements) {
    const startOfDay = p.slot.day * DAY_SPAN;
    assert.ok(p.startAbs - startOfDay >= result.grid.dayStart, `${label}: match before opening time`);
    assert.ok(p.endAbs - startOfDay <= result.grid.dayEnd, `${label}: match past closing time`);
    assert.ok(p.slot.day < result.grid.days, `${label}: match on a day that doesn't exist`);
  }

  // 5. Nothing is lost: every match is either placed or reported as overflow.
  const accounted = result.placements.length + result.overflow.length;
  assert.equal(accounted, result.graph.nodes.size, `${label}: matches went missing`);
}

/** The gap between a match and the match it feeds — i.e. the rest the winner of
 *  the feeder actually gets. Both sides of a knockout match are TBD when the
 *  schedule is generated, so this rest is invisible to any team-based check;
 *  it has to be measured through the dependency edge instead. */
function tightestFeederGap(result: ReturnType<typeof generateSchedule>): number {
  const byId = new Map(result.placements.map(p => [p.matchId, p]));
  let worst = Infinity;
  for (const p of result.placements) {
    for (const dep of result.graph.nodes.get(p.matchId)!.deps) {
      const feeder = byId.get(dep);
      if (feeder) worst = Math.min(worst, p.startAbs - feeder.endAbs);
    }
  }
  return Number.isFinite(worst) ? worst : Infinity;
}

// ── Graph ─────────────────────────────────────────────────────────────────

describe('dependency graph', () => {
  it('makes pool matches independent and knockout matches dependent', () => {
    const graph = buildGraph([makeDivision('m', 4)], 45);
    const pool = [...graph.nodes.values()].filter(n => n.isPool);
    assert.ok(pool.length > 0);
    for (const n of pool) assert.equal(n.deps.length, 0, 'pool matches depend on nothing');

    const firstKo = [...graph.nodes.values()].find(n => n.id === 'm-k1-0')!;
    assert.equal(firstKo.deps.length, pool.length, 'first knockout waits on all of pool play');

    const final = [...graph.nodes.values()].find(n => n.id === 'm-k3-0')!;
    assert.equal(final.depth, 0, 'the final has nothing after it');
    assert.deepEqual(final.deps.sort(), ['m-k2-0', 'm-k2-1'], 'the final is fed by both semis');
  });

  it('measures the critical path, which no amount of courts can shorten', () => {
    const graph = buildGraph([makeDivision('m', 4, { duration: 30 })], 30);
    // One pool match + three knockout rounds = 4 matches back to back.
    assert.equal(graph.criticalPathMatches, 4);
    assert.equal(graph.criticalPathMinutes, 120);
  });

  it('orders every match after everything it depends on', () => {
    const graph = buildGraph([makeDivision('a', 5), makeDivision('b', 4)], 45);
    const seen = new Set<string>();
    for (const id of graph.order) {
      for (const dep of graph.nodes.get(id)!.deps) {
        assert.ok(seen.has(dep), `${id} came before its dependency ${dep}`);
      }
      seen.add(id);
    }
    assert.equal(graph.order.length, graph.nodes.size);
    assert.equal(graph.brokenEdges.length, 0);
  });
});

// ── Feasibility ───────────────────────────────────────────────────────────

describe('feasibility', () => {
  it('accepts an event that comfortably fits', () => {
    const inv = scheduleInventory([makeDivision('m', 4)], config({ courtCount: 6 }), 2);
    assert.equal(inv.verdict, 'fits');
    assert.deepEqual(inv.reasons, []);
  });

  it('rejects an event with more matches than court time, and says how to fix it', () => {
    const divisions = Array.from({ length: 6 }, (_, i) => makeDivision(`d${i}`, 8));
    const inv = scheduleInventory(divisions, config({ courtCount: 2 }), 1);
    assert.equal(inv.verdict, 'overflow');
    assert.ok(inv.reasons.length > 0);
    const kinds = inv.levers.map(l => l.kind);
    assert.ok(kinds.includes('addCourt'), 'offers more courts');
    assert.ok(kinds.includes('addDay'), 'offers more days');
  });

  it('knows when more courts cannot help, because the chain is too long', () => {
    // A day only long enough for two matches, but a four-match chain.
    const inv = scheduleInventory(
      [makeDivision('m', 4, { duration: 60 })],
      config({ courtCount: 40, startTime: '09:00', endTime: '12:00', lunchStart: '00:00', lunchEnd: '00:00' }),
      1,
    );
    assert.equal(inv.verdict, 'overflow');
    assert.ok(
      inv.reasons.some(r => r.includes('extra courts cannot help')),
      'names the critical path as the blocker',
    );
  });
});

// ── The solver ────────────────────────────────────────────────────────────

describe('generateSchedule', () => {
  it('places a single division soundly', () => {
    const result = generateSchedule([makeDivision('m', 5)], config(), 1);
    assertSound(result, 'single division');
    assert.equal(result.overflow.length, 0);
  });

  it('is deterministic — the same input gives byte-identical output', () => {
    const divisions = [makeDivision('a', 5), makeDivision('b', 4, { netHeight: '2.24m' })];
    const first = generateSchedule(divisions, config(), 2);
    const second = generateSchedule(divisions, config(), 2);
    assert.deepEqual(first.assignments, second.assignments);
    assert.equal(first.metrics.totalCost, second.metrics.totalCost);
  });

  it('handles every court count from 1 to 20, odd and even alike', () => {
    for (let courts = 1; courts <= 20; courts++) {
      const result = generateSchedule(
        [makeDivision('a', 4), makeDivision('b', 4)],
        config({ courtCount: courts }),
        3,
      );
      assertSound(result, `${courts} courts`);
    }
  });

  it('handles 1 to 10 divisions across 1 to 10 days', () => {
    for (const days of [1, 3, 7, 10]) {
      for (const divisionCount of [1, 4, 10]) {
        const divisions = Array.from({ length: divisionCount }, (_, i) =>
          makeDivision(`d${i}`, 4, { netHeight: i % 2 === 0 ? '2.43m' : '2.24m' }),
        );
        const result = generateSchedule(divisions, config({ courtCount: 8 }), days);
        assertSound(result, `${divisionCount} divisions × ${days} days`);
      }
    }
  });

  it('gives teams rest instead of sending them straight back on court', () => {
    // Six teams can only fill three courts at once, so packing every slot would
    // mean everybody playing continuously. With room to breathe the solver
    // should leave courts idle rather than do that.
    const result = generateSchedule([makeDivision('m', 6)], config({ courtCount: 3 }), 2);
    assertSound(result, 'rest');
    assert.equal(result.overflow.length, 0);
    assert.equal(result.metrics.backToBack, 0, 'nobody plays with no gap at all');
    assert.ok(
      result.metrics.tightestRestMinutes >= result.grid.blockMinutes,
      `tightest gap was ${result.metrics.tightestRestMinutes} min`,
    );
  });

  it('rests the winner of a match before its next one, even though that team has no name yet', () => {
    // Khao Lak Open 2026: two knockout divisions, three courts, two days. The
    // schedule put "Winner of W2" on court at 09:45 when W2 itself ran
    // 09:00–09:45. Both sides of a knockout match are TBD at generation time,
    // so no team track exists and every team-based rest check passes happily —
    // the constraint only exists along the dependency edge.
    const knockout = (id: string, firstRound: number, netHeight: string): SchedulableDivision => {
      const matches: SchedulableMatch[] = [];
      let round = 0;
      for (let size = firstRound; size >= 1; size /= 2) {
        for (let i = 0; i < size; i++) {
          matches.push({
            id: `${id}-r${round}-${i}`,
            teamA: round === 0 ? `${id}-t${2 * i + 1}` : null,
            teamB: round === 0 ? `${id}-t${2 * i + 2}` : null,
            isPool: false,
            roundIndex: round,
          });
        }
        round++;
      }
      return { id, label: id, pools: 2, netHeight, gender: id, matches };
    };

    const result = generateSchedule(
      [knockout('Women', 8, '2.24m'), knockout('Men', 8, '2.43m')],
      config({ courtCount: 3 }),
      2,
    );
    assertSound(result, 'knockout rest');
    assert.equal(result.overflow.length, 0);
    assert.deepEqual(result.relaxations, []);
    assert.ok(
      tightestFeederGap(result) >= result.grid.blockMinutes,
      `winner of a match got only ${tightestFeederGap(result)} min before playing again`,
    );
    assert.ok(
      result.metrics.tightestFeederGapMinutes >= result.grid.blockMinutes,
      'the metric reports the same gap the schedule actually has',
    );
  });

  it('says so when the venue is too tight to give anyone rest', () => {
    // The same division squeezed into one day: the chain of pool play plus
    // three knockout rounds cannot fit while resting teams, so the solver has
    // to break the rest promise — and must admit it.
    const result = generateSchedule([makeDivision('m', 6)], config({ courtCount: 3 }), 1);
    assertSound(result, 'rest impossible');
    assert.ok(
      result.relaxations.includes('restIsHard') || result.overflow.length > 0,
      'either it reports breaking the rest rule, or it reports what did not fit',
    );
  });

  it('keeps the net still when divisions are split across courts', () => {
    const divisions = [
      makeDivision('men', 4, { netHeight: '2.43m', gender: 'Men' }),
      makeDivision('women', 4, { netHeight: '2.24m', gender: 'Women' }),
    ];
    const packed = generateSchedule(divisions, config({ courtCount: 4 }), 2);
    assertSound(packed, 'net heights');
    // Four courts and two heights: each division can own its own tracks, so the
    // nets should barely move.
    assert.ok(packed.pivots <= 2, `expected almost no net changes, got ${packed.pivots}`);
  });

  it('holds every division final for the last day', () => {
    const divisions = [makeDivision('a', 4), makeDivision('b', 4)];
    const result = generateSchedule(divisions, config({ courtCount: 6 }), 3);
    assertSound(result, 'finals');
    assert.deepEqual(result.relaxations, [], 'no promise had to be broken');

    for (const div of divisions) {
      const finalId = `${div.id}-k3-0`;
      const placement = result.placements.find(p => p.matchId === finalId);
      assert.ok(placement, `${finalId} was placed`);
      assert.equal(placement.slot.day, 2, `${div.id} final is on the last day`);
    }
  });

  it('keeps every division moving on every day of a multi-day event', () => {
    const divisions = Array.from({ length: 3 }, (_, i) => makeDivision(`d${i}`, 6));
    const result = generateSchedule(divisions, config({ courtCount: 6 }), 3);
    assertSound(result, 'parallel days');

    for (const div of divisions) {
      const days = new Set(
        result.placements
          .filter(p => result.graph.nodes.get(p.matchId)!.divisionId === div.id)
          .map(p => p.slot.day),
      );
      assert.equal(days.size, 3, `${div.id} plays on all three days`);
    }
  });

  it('reports overflow rather than silently dropping matches', () => {
    const divisions = Array.from({ length: 8 }, (_, i) => makeDivision(`d${i}`, 8));
    const result = generateSchedule(divisions, config({ courtCount: 2 }), 1);
    assertSound(result, 'overflow');
    assert.ok(result.overflow.length > 0, 'the impossible part is reported');
    assert.equal(result.inventory.verdict, 'overflow');
  });

  it('names the promises it had to break when a schedule is tight', () => {
    // Enough court time only if finals are allowed off the last day.
    const result = generateSchedule(
      [makeDivision('m', 7)],
      config({ courtCount: 1, restIsHard: true, minRestSlots: 3 }),
      2,
    );
    assertSound(result, 'relaxation');
    if (result.overflow.length === 0) {
      assert.ok(result.relaxations.length > 0, 'says which rule it gave up');
    }
  });
});

// ── Pinning ───────────────────────────────────────────────────────────────

describe('pinned placements', () => {
  it('honours a pin and schedules around it', () => {
    const divisions = [makeDivision('m', 5)];
    const pin = { matchId: 'm-p0-1', court: 'Court 3', day: 0, time: '11:15' };
    const result = generateSchedule(divisions, config(), 1, { pins: [pin] });
    assertSound(result, 'pinned');

    const placed = result.placements.find(p => p.matchId === pin.matchId)!;
    assert.equal(placed.courtName, 'Court 3');
    assert.equal(placed.slot.day, 0);
    assert.equal(placed.pinned, true);
    assert.deepEqual(result.pinConflicts, []);
  });

  it('reports a pin it cannot honour instead of quietly moving it', () => {
    const result = generateSchedule([makeDivision('m', 4)], config(), 1, {
      pins: [{ matchId: 'm-p0-1', court: 'Court 99', day: 0, time: '10:00' }],
    });
    assert.equal(result.pinConflicts.length, 1);
    assert.match(result.pinConflicts[0].reason, /No court named/);
  });

  it('refuses two pins fighting over the same court and slot', () => {
    const result = generateSchedule([makeDivision('m', 5)], config(), 1, {
      pins: [
        { matchId: 'm-p0-1', court: 'Court 1', day: 0, time: '10:30' },
        { matchId: 'm-p0-2', court: 'Court 1', day: 0, time: '10:30' },
      ],
    });
    assert.equal(result.pinConflicts.length, 1);
    assert.match(result.pinConflicts[0].reason, /already taken/);
    assertSound(result, 'conflicting pins');
  });
});

// ── Lunch ─────────────────────────────────────────────────────────────────

describe('lunch', () => {
  it('staggers the break so the venue never fully stops', () => {
    const grid = buildGrid(config({ courtCount: 4, staggerLunch: true }), 1);
    for (let slotIndex = 0; slotIndex < grid.slotsPerDay; slotIndex++) {
      const allBlocked = grid.lunchBlocked.every(court => court[slotIndex]);
      assert.ok(!allBlocked, `every court was idle at slot ${slotIndex}`);
    }
  });

  it('stops the whole venue when staggering is off', () => {
    const grid = buildGrid(config({ courtCount: 4, staggerLunch: false }), 1);
    const anyFullStop = Array.from({ length: grid.slotsPerDay }, (_, i) =>
      grid.lunchBlocked.every(court => court[i]),
    ).some(Boolean);
    assert.ok(anyFullStop, 'unstaggered lunch stops every court together');
  });

  it('never schedules a match through a court’s own break', () => {
    const result = generateSchedule([makeDivision('m', 6)], config({ courtCount: 3 }), 1);
    for (const p of result.placements) {
      for (let k = 0; k < p.span; k++) {
        assert.ok(
          !result.grid.lunchBlocked[p.courtIndex][p.slot.index + k],
          'a match was placed over a lunch block',
        );
      }
    }
  });
});

// ── Drift ─────────────────────────────────────────────────────────────────

describe('live drift', () => {
  it('pushes only the court that ran long', () => {
    const result = generateSchedule([makeDivision('m', 5)], config({ courtCount: 3 }), 1);
    const lane = result.placements
      .filter(p => p.courtIndex === 0)
      .sort((a, b) => a.startAbs - b.startAbs);
    assert.ok(lane.length >= 2, 'need at least two matches on the court to test propagation');

    const overran = lane[0];
    const drift = projectSchedule(
      result.placements,
      [{ matchId: overran.matchId, status: 'done', startAbs: overran.startAbs, endAbs: overran.endAbs + 30 }],
      result.graph,
      result.grid,
    );

    const next = drift.projections.get(lane[1].matchId)!;
    assert.ok(next.delayMinutes > 0, 'the next match on that court is pushed');

    for (const p of result.placements) {
      if (p.courtIndex === 0) continue;
      assert.equal(
        drift.projections.get(p.matchId)!.delayMinutes,
        0,
        'other courts keep their published time',
      );
    }
  });

  it('never projects a match earlier than it was published', () => {
    const result = generateSchedule([makeDivision('m', 5)], config({ courtCount: 3 }), 1);
    const first = result.placements[0];
    const drift = projectSchedule(
      result.placements,
      [{ matchId: first.matchId, status: 'done', startAbs: first.startAbs, endAbs: first.startAbs + 5 }],
      result.graph,
      result.grid,
    );
    for (const p of result.placements) {
      const proj = drift.projections.get(p.matchId)!;
      assert.ok(proj.projectedStartAbs >= p.startAbs || proj.status === 'done');
    }
  });

  it('warns when drift breaks a cross-court dependency instead of hiding it', () => {
    const result = generateSchedule([makeDivision('m', 4)], config({ courtCount: 4 }), 1);
    // Push every pool match far past the knockout that waits on it.
    const actuals = result.placements
      .filter(p => result.graph.nodes.get(p.matchId)!.isPool)
      .map(p => ({
        matchId: p.matchId,
        status: 'done' as const,
        startAbs: p.startAbs,
        endAbs: p.endAbs + 240,
      }));
    const drift = projectSchedule(result.placements, actuals, result.graph, result.grid);
    assert.ok(drift.warnings.length > 0, 'the broken dependency is surfaced');
    assert.ok(drift.warnings[0].byMinutes > 0);
  });
});

// ── The matching primitive ────────────────────────────────────────────────

describe('hungarian', () => {
  it('finds the minimum-cost assignment', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const assignment = hungarian(cost);
    const total = assignment.reduce((s, col, row) => s + cost[row][col], 0);
    assert.equal(total, 5); // 4 + 0 + ... best is rows→(0:1)=1, (1:0)=2, (2:2)=2
  });

  it('handles more matches than courts by leaving the extras unassigned', () => {
    const assignment = hungarian([[5, 1], [2, 9], [7, 3]]);
    const used = assignment.filter(c => c >= 0);
    assert.equal(used.length, 2, 'only two courts, so only two matches placed');
    assert.equal(new Set(used).size, 2, 'no court used twice');
  });

  it('handles more courts than matches', () => {
    const assignment = hungarian([[5, 1, 9, 2]]);
    assert.equal(assignment.length, 1);
    assert.equal(assignment[0], 1, 'takes the cheapest court');
  });
});

// ── Config compatibility ──────────────────────────────────────────────────

describe('config', () => {
  it('fills in fields an older stored config never had', () => {
    const stored = { startTime: '08:00', courtCount: 6 };
    const merged = normaliseConfig(stored);
    assert.equal(merged.startTime, '08:00');
    assert.equal(merged.courtCount, 6);
    assert.equal(merged.minRestSlots, DEFAULT_SCHEDULE_CONFIG.minRestSlots);
    assert.equal(merged.dayPlan, 'parallel-daily');
  });

  it('uses an explicit court roster over the plain count', () => {
    const result = generateSchedule(
      [makeDivision('m', 4)],
      config({
        courtCount: 99,
        courts: [
          { name: 'Centre', netHeight: 2.43, isShowCourt: true },
          { name: 'Outer 1', netHeight: 2.43 },
        ],
      }),
      2,
    );
    const names = new Set(result.placements.map(p => p.courtName));
    for (const n of names) assert.ok(['Centre', 'Outer 1'].includes(n), `unexpected court ${n}`);
  });
});
