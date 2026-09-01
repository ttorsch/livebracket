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
import { DAY_SPAN, courtOpen } from './grid.ts';
import { planPoolPlay } from './poolplay.ts';
import { buildStaging } from './staging.ts';
import { validateSchedule, type EditedPlacement } from './validate.ts';

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

/** The same division, plus the play-off for 3rd: drawn last, fed by the two
 *  losing semifinals, and flagged so the scheduler knows to run it before the
 *  final rather than alongside it. Mirrors what the draw route now writes. */
function withThirdPlace(div: SchedulableDivision): SchedulableDivision {
  const semis = div.matches.filter(m => m.roundIndex === 2).map(m => m.id);
  const final = div.matches.find(m => m.roundIndex === 3);
  assert.equal(semis.length, 2, 'fixture should have two semifinals');
  assert.ok(final, 'fixture should have a final');
  return {
    ...div,
    matches: [
      ...div.matches.map(m => (m.id === final.id ? { ...m, dependsOn: semis } : m)),
      {
        id: `${div.id}-3rd`,
        teamA: null,
        teamB: null,
        isPool: false,
        isThirdPlace: true,
        roundIndex: 4,
        dependsOn: semis,
      },
    ],
  };
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

  it('still rests the knockout, where a short gap ends someone’s tournament', () => {
    // Pool play now fills the courts and prices rest rather than protecting it
    // absolutely — but the knockout does not. A tired team there plays a match
    // that knocks somebody out, so rest stays a hard filter and a court is
    // allowed to sit idle for it.
    const result = generateSchedule([makeDivision('m', 6)], config({ courtCount: 3 }), 2);
    assertSound(result, 'rest');
    assert.equal(result.overflow.length, 0);

    const byId = new Map(result.placements.map(p => [p.matchId, p]));
    for (const p of result.placements) {
      const node = result.graph.nodes.get(p.matchId)!;
      if (node.isPool) continue;
      for (const dep of node.deps) {
        const feeder = byId.get(dep);
        if (!feeder) continue;
        assert.ok(
          p.slot.abs - feeder.endAbs >= result.grid.blockMinutes,
          `${p.matchId} followed ${dep} after only ${p.slot.abs - feeder.endAbs} min`,
        );
      }
    }
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

    // Staging off: this is about the rest owed along a dependency edge, not
    // about the medal-round programme, which would otherwise reshape the
    // endgame and change what is being measured.
    const result = generateSchedule(
      [knockout('Women', 8, '2.24m'), knockout('Men', 8, '2.43m')],
      config({ courtCount: 3, stageFinals: false }),
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
    // Staging off: every final shares one court by design, so two divisions on
    // different heights *must* re-rig it between them. That cost belongs to the
    // programme and is asserted there; here the question is only whether court
    // affinity keeps the nets still during the bulk of the event.
    const packed = generateSchedule(divisions, config({ courtCount: 4, stageFinals: false }), 2);
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
  it('offers no slot inside the break, on any court', () => {
    const grid = buildGrid(config({ courtCount: 4, lunchStart: '12:00', lunchEnd: '13:00' }), 1);
    assert.ok(grid.lunch, 'the configured lunch window was not read');
    for (const slot of grid.slots) {
      assert.ok(
        slot.startMin >= grid.lunch!.end || slot.startMin + grid.slotMinutes <= grid.lunch!.start,
        `slot at ${slot.startMin} overlaps the lunch window`,
      );
    }
  });

  it('resumes play at the configured end of lunch, not at the next block boundary', () => {
    // 09:00 + 45-minute blocks does not divide a 12:00–13:00 lunch. A lattice
    // anchored at the day's start could only resume at 13:30; restarting the
    // run at lunchEnd is what makes the banner's "13:00" true.
    const grid = buildGrid(config({ startTime: '09:00', endTime: '18:00', blockMinutes: 45 }), 1);
    const afterLunch = grid.slotStarts.filter(m => m >= grid.lunch!.end);
    assert.equal(afterLunch[0], grid.lunch!.end, 'play did not resume when lunch ended');
    const beforeLunch = grid.slotStarts.filter(m => m < grid.lunch!.start);
    assert.equal(
      beforeLunch[beforeLunch.length - 1] + grid.slotMinutes <= grid.lunch!.start,
      true,
      'the last morning slot runs into lunch',
    );
  });

  it('does not let a match span the break', () => {
    // A 90-minute match on a 45-minute grid needs two adjacent ordinals. The
    // last morning slot and the first afternoon slot are consecutive ordinals
    // an hour apart, so that pair must be refused.
    const grid = buildGrid(config({ courtCount: 2, blockMinutes: 45 }), 1);
    const lastBefore = grid.slotStarts.findLastIndex(m => m < grid.lunch!.start);
    const straddle = grid.slots.find(s => s.day === 0 && s.index === lastBefore)!;
    assert.equal(courtOpen(grid, 0, straddle, 2), false, 'a match was allowed across lunch');
    assert.equal(courtOpen(grid, 0, straddle, 1), true, 'the morning slot itself should be usable');
  });

  it('never schedules a match over the break', () => {
    const result = generateSchedule([makeDivision('m', 6)], config({ courtCount: 3 }), 1);
    const { lunch } = result.grid;
    assert.ok(lunch);
    for (const p of result.placements) {
      const from = p.slot.startMin;
      const to = from + p.span * result.grid.slotMinutes;
      assert.ok(from >= lunch!.end || to <= lunch!.start, `${p.matchId} runs through lunch`);
    }
  });

  it('treats a lunch window outside the playing day as no lunch at all', () => {
    const grid = buildGrid(config({ lunchStart: '20:00', lunchEnd: '21:00' }), 1);
    assert.equal(grid.lunch, null);
    for (let i = 1; i < grid.slotStarts.length; i++) {
      assert.equal(grid.slotStarts[i] - grid.slotStarts[i - 1], grid.slotMinutes);
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

// ── Staged endgame ────────────────────────────────────────────────────────

describe('medal-round programme', () => {
  const divisions = () => [
    makeDivision('w', 4, { netHeight: '2.24m', gender: 'Women' }),
    makeDivision('m', 4, { netHeight: '2.43m', gender: 'Men' }),
  ].map(withThirdPlace);

  /** start/end of a division's matches at a round index. */
  const span = (r: ReturnType<typeof generateSchedule>, ids: string[]) => {
    const ps = r.placements.filter(p => ids.includes(p.matchId));
    if (ps.length === 0) return null;
    return {
      n: ps.length,
      start: Math.min(...ps.map(p => p.slot.abs)),
      end: Math.max(...ps.map(p => p.endAbs)),
      courts: new Set(ps.map(p => p.courtName)),
    };
  };
  const semisOf = (d: string) => [`${d}-k2-0`, `${d}-k2-1`];
  const thirdOf = (d: string) => [`${d}-3rd`];
  const finalOf = (d: string) => [`${d}-k3-0`];

  // Five waves run strictly one after another — two semifinal blocks, the
  // play-offs, then two finals — and because every final shares one court, the
  // net is re-rigged between them at a buffer's cost apiece. That is a long,
  // narrow tail, so the fixture is given a long day rather than more courts:
  // extra courts do not help a queue.
  const run = (over = {}) => {
    const r = generateSchedule(divisions(), config({ courtCount: 4, endTime: '20:00', ...over }), 2);
    assert.deepEqual(r.relaxations, [], 'the programme should hold without relaxing anything');
    assertSound(r, 'medal rounds');
    return r;
  };

  it('runs one division\u2019s semifinals at a time, both matches side by side', () => {
    const r = run();
    const w = span(r, semisOf('w'))!;
    const m = span(r, semisOf('m'))!;
    assert.equal(w.n, 2, 'both women\u2019s semifinals placed');
    assert.equal(m.n, 2, 'both men\u2019s semifinals placed');
    assert.equal(
      new Set(r.placements.filter(p => semisOf('w').includes(p.matchId)).map(p => p.slot.abs)).size,
      1,
      'women\u2019s semifinals should start in the same slot',
    );
    assert.ok(w.courts.size === 2 && m.courts.size === 2, 'each pair uses two courts');
    // One division at a time: the two blocks must not overlap.
    assert.ok(
      w.end <= m.start || m.end <= w.start,
      `semifinal blocks overlap: women ${w.start}-${w.end}, men ${m.start}-${m.end}`,
    );
  });

  it('holds every 3rd-place play-off until every semifinal is done, then runs them together', () => {
    const r = run();
    const lastSemi = Math.max(span(r, semisOf('w'))!.end, span(r, semisOf('m'))!.end);
    const w = span(r, thirdOf('w'))!;
    const m = span(r, thirdOf('m'))!;
    assert.ok(w.start >= lastSemi, 'women\u2019s play-off started before the semifinals finished');
    assert.ok(m.start >= lastSemi, 'men\u2019s play-off started before the semifinals finished');
    assert.equal(w.start, m.start, 'the play-offs should run at the same time');
    assert.equal(new Set([...w.courts, ...m.courts]).size, 2, 'on two different courts');
  });

  it('plays every final one at a time on a single court, after the play-offs', () => {
    const r = run();
    const lastThird = Math.max(span(r, thirdOf('w'))!.end, span(r, thirdOf('m'))!.end);
    const w = span(r, finalOf('w'))!;
    const m = span(r, finalOf('m'))!;
    assert.ok(w.start >= lastThird && m.start >= lastThird, 'a final started before the play-offs finished');
    assert.equal(
      new Set([...w.courts, ...m.courts]).size,
      1,
      `finals should share one court, got ${[...w.courts, ...m.courts].join(' + ')}`,
    );
    assert.ok(
      w.end <= m.start || m.end <= w.start,
      `finals overlap: women ${w.start}-${w.end}, men ${m.start}-${m.end}`,
    );
  });

  it('is the staging that does it \u2014 switching it off breaks the programme', () => {
    const loose = generateSchedule(divisions(), config({ courtCount: 4, endTime: '20:00', stageFinals: false }), 2);
    assertSound(loose, 'unstaged');
    const w = span(loose, finalOf('w'))!;
    const m = span(loose, finalOf('m'))!;
    const lastSemi = Math.max(span(loose, semisOf('w'))!.end, span(loose, semisOf('m'))!.end);
    const thirdStart = Math.min(span(loose, thirdOf('w'))!.start, span(loose, thirdOf('m'))!.start);
    const kept =
      new Set([...w.courts, ...m.courts]).size === 1 && thirdStart >= lastSemi;
    assert.ok(!kept, 'unstaged run happened to satisfy the programme \u2014 the tests above prove nothing');
  });

  it('drops the programme rather than deadlocking when the venue is too small', () => {
    // One court cannot start a two-match semifinal wave, ever.
    const r = generateSchedule(divisions(), config({ courtCount: 1 }), 6);
    assertSound(r, 'single court');
    assert.ok(r.placements.length > 0, 'a one-court event should still be scheduled');
  });
});

// ── Grid resolution ───────────────────────────────────────────────────────

describe('grid resolution', () => {
  it('gives a 20-minute match twenty minutes, not a whole nominal block', () => {
    const div = makeDivision('m', 4, { duration: 20 });
    const result = generateSchedule([div], config({ courtCount: 2, blockMinutes: 45 }), 2);
    assertSound(result, 'short matches');
    assert.equal(result.grid.slotMinutes, 5, 'the grid should step in 5s for 20 and 45');

    const pool = result.placements
      .filter(p => result.graph.nodes.get(p.matchId)!.isPool)
      .sort((a, b) => a.startAbs - b.startAbs);
    for (const p of pool) {
      assert.equal(p.endAbs - p.startAbs, 20, 'a 20-minute match should run 20 minutes');
    }
    // The next start is off the nominal 45-minute lattice entirely — which is
    // the whole point. (It is 65 here: a 20-minute match plus the rest its
    // teams are owed, which the old grid could only round up to 90.)
    const gap = pool[2].startAbs - pool[0].startAbs;
    assert.equal(gap % 5, 0, 'starts land on the 5-minute grid');
    assert.notEqual(gap % 45, 0, 'and are no longer forced onto 45-minute boundaries');
  });

  it('leaves a single-length event exactly as it was', () => {
    const result = generateSchedule([makeDivision('m', 4, { duration: 45 })], config(), 2);
    assert.equal(result.grid.slotMinutes, 45, 'all-45 stays on a 45-minute grid');
  });
});

// ── Pool-play rotation ────────────────────────────────────────────────────

describe('pool-play rotation', () => {
  /** A division of `pools` pools × `per` teams, full round robin in each. */
  function pooled(id: string, pools: number, per: number, net?: string): SchedulableDivision {
    const matches: SchedulableMatch[] = [];
    for (let p = 0; p < pools; p++) {
      const name = String.fromCharCode(65 + p);
      const teams = Array.from({ length: per }, (_, i) => `${id}-${name}${i + 1}`);
      for (let a = 0; a < per; a++) {
        for (let b = a + 1; b < per; b++) {
          matches.push({
            id: `${id}-${name}-${a}${b}`,
            teamA: teams[a],
            teamB: teams[b],
            isPool: true,
            pool: name,
            roundIndex: 0,
            durationMinutes: 45,
          });
        }
      }
    }
    return { id, label: id.toUpperCase(), pools, netHeight: net ?? null, gender: null, matches };
  }

  it('wants ⌊teams/2⌋ × pools ÷ 2 courts', () => {
    const plan = (pools: number, per: number, courts: number) =>
      planPoolPlay(
        'd',
        [...buildGraph([pooled('d', pools, per)], 45).nodes.values()].filter(n => n.isPool),
        courts,
      )!;

    assert.equal(plan(4, 4, 4).optimalCourts, 4, '4 pools of 4 → 4 courts');
    assert.equal(plan(2, 4, 4).optimalCourts, 2, '2 pools of 4 → 2 courts');
    assert.equal(plan(4, 6, 6).optimalCourts, 6, '4 pools of 6 → 6 courts');
    assert.equal(plan(4, 5, 4).optimalCourts, 4, '5 a pool → ⌊5/2⌋ = 2 each, one team rests');
  });

  it('plays half the pools at full capacity, then the other half', () => {
    const plan = planPoolPlay(
      'd',
      [...buildGraph([pooled('d', 4, 4)], 45).nodes.values()].filter(n => n.isPool),
      4,
    )!;
    assert.equal(plan.poolsAtOnce, 2, 'two pools at a time');
    for (const wave of plan.waves) {
      assert.equal(wave.length, 4, 'each turn fills all four courts');
      assert.equal(new Set(wave.map(id => id.split('-')[1])).size, 2, 'two pools per turn');
    }
  });

  it('narrows to whole pools when there are fewer courts than it wants', () => {
    const plan = planPoolPlay(
      'd',
      [...buildGraph([pooled('d', 4, 4)], 45).nodes.values()].filter(n => n.isPool),
      3,
    )!;
    assert.equal(plan.optimalCourts, 4, 'it still wants four');
    assert.equal(plan.poolsAtOnce, 1, 'but runs one pool at a time on three courts');
    for (const wave of plan.waves) assert.equal(wave.length, 2, 'two matches, one pool');
  });

  it('gives every team a rest between pool matches', () => {
    const result = generateSchedule([pooled('d', 4, 4)], config({ courtCount: 4 }), 2);
    assertSound(result, 'pool rotation');
    assert.equal(result.backToBack, 0, 'no team should play back to back');
    assert.ok(
      result.metrics.tightestRestMinutes >= 45,
      `tightest rest was ${result.metrics.tightestRestMinutes} min`,
    );
  });

  it('uses the courts it has rather than leaving them bare', () => {
    // Four pools of four on six courts. The rotation is comfortable at four, but
    // two courts standing empty for the whole round robin is worse than a short
    // gap, so it widens to fill them.
    const result = generateSchedule([pooled('a', 4, 4, '2.43m')], config({ courtCount: 6 }), 2);
    assertSound(result, 'wide rotation');

    const bySlot = new Map<number, number>();
    for (const p of result.placements) bySlot.set(p.slot.abs, (bySlot.get(p.slot.abs) ?? 0) + 1);
    const busiest = Math.max(...bySlot.values());
    assert.ok(busiest > 4, `only ${busiest} courts ever in use out of 6`);
  });

  it('lets one division finish its round robin before another starts, so nets stay put', () => {
    // Two heights, so a court used by both divisions is re-rigged exactly once,
    // when the venue changes hands. That handover is the floor — what taking
    // turns buys is that it happens once per court instead of every turn.
    const result = generateSchedule(
      [pooled('a', 4, 4, '2.43m'), pooled('b', 2, 4, '2.24m')],
      config({ courtCount: 4 }),
      2,
    );
    assertSound(result, 'division blocks');

    const byCourt = new Map<string, typeof result.placements>();
    for (const p of [...result.placements].sort((x, y) => x.startAbs - y.startAbs)) {
      const list = byCourt.get(p.courtName);
      if (list) list.push(p);
      else byCourt.set(p.courtName, [p]);
    }
    let flips = 0;
    for (const ps of byCourt.values()) {
      let height: number | null = null;
      for (const p of ps) {
        const h = result.graph.nodes.get(p.matchId)!.netHeight;
        if (h == null) continue;
        if (height != null && height !== h) flips++;
        height = h;
      }
    }
    assert.ok(
      flips <= result.grid.courts.length,
      `pool play should re-rig each court at most once, needed ${flips} changes over ${result.grid.courts.length} courts`,
    );

    // And the handover really is a handover: one division's round robin is over
    // before the other's begins.
    const window = (prefix: string) => {
      const ps = result.placements.filter(p => p.matchId.startsWith(prefix));
      return { start: Math.min(...ps.map(p => p.startAbs)), end: Math.max(...ps.map(p => p.endAbs)) };
    };
    const a = window('a-');
    const b = window('b-');
    assert.ok(
      a.end <= b.start || b.end <= a.start,
      `the two round robins overlap: a ${a.start}-${a.end}, b ${b.start}-${b.end}`,
    );
  });

  it('schedules the division that exactly fills the venue first', () => {
    // Four pools of four wants exactly four courts; two pools of four wants two.
    // With four courts on offer the first is the one that can be dense *and*
    // back-to-back free, so it should be planned before the other.
    const graph = buildGraph([pooled('small', 2, 4), pooled('exact', 4, 4)], 45);
    const staging = buildStaging(graph, 4, true);
    assert.equal(
      staging.poolPlans[0].divisionId,
      'exact',
      'the division whose optimum matches the venue should be planned first',
    );
  });
});

// ── Hand edits ────────────────────────────────────────────────────────────

describe('validating a hand-edited schedule', () => {
  const div = makeDivision('m', 4, { duration: 45 });
  const graph = buildGraph([div], 45);
  const grid = buildGrid(normaliseConfig({ courtCount: 2 }), 2, [45]);
  const at = (matchId: string, court: string, startMin: number, day = 0): EditedPlacement =>
    ({ matchId, court, day, startMin, durationMinutes: 45 });
  const check = (ps: EditedPlacement[]) =>
    validateSchedule(ps, graph, grid, { targetRestMinutes: 45 });

  it('passes a sound arrangement silently', () => {
    const problems = check([at('m-p0-1', 'Court 1', 540), at('m-p2-3', 'Court 2', 540)]);
    assert.deepEqual(problems, [], `expected no problems, got ${JSON.stringify(problems)}`);
  });

  it('catches two matches put on one court at once', () => {
    const problems = check([at('m-p0-1', 'Court 1', 540), at('m-p2-3', 'Court 1', 555)]);
    const clash = problems.find(p => p.kind === 'courtClash');
    assert.ok(clash, `expected a court clash, got ${JSON.stringify(problems)}`);
    assert.match(clash.message, /Court 1 is still busy/);
  });

  it('catches a team dragged onto two courts at once', () => {
    // Both matches involve m-t1.
    const problems = check([at('m-p0-1', 'Court 1', 540), at('m-p0-2', 'Court 2', 555)]);
    assert.ok(problems.some(p => p.kind === 'teamClash'), 'expected a team clash');
  });

  it('names the match a knockout is still waiting on', () => {
    // The final dragged in front of a semifinal that feeds it.
    const problems = check([at('m-k2-0', 'Court 1', 600), at('m-k3-0', 'Court 2', 540)]);
    const dep = problems.find(p => p.kind === 'dependency');
    assert.ok(dep, `expected a dependency problem, got ${JSON.stringify(problems)}`);
    assert.equal(dep.matchId, 'm-k3-0');
    assert.equal(dep.otherMatchId, 'm-k2-0');
    assert.match(dep.message, /has not finished yet/);
  });

  it('reports a short gap without calling it impossible', () => {
    const problems = check([at('m-p0-1', 'Court 1', 540), at('m-p0-2', 'Court 2', 585)]);
    assert.ok(problems.some(p => p.kind === 'shortRest'), 'expected a short-rest problem');
    assert.ok(!problems.some(p => p.kind === 'teamClash'), 'back to back is tight, not impossible');
  });

  it('catches a match dragged off the end of the day', () => {
    const problems = check([at('m-p0-1', 'Court 1', 1050)]); // 17:30 + 45 = past 18:00
    assert.ok(problems.some(p => p.kind === 'outsideDay'), 'expected an outside-day problem');
  });

  it('catches a match dropped on blocked-out time', () => {
    const blockedGrid = buildGrid(
      normaliseConfig({
        courtCount: 2,
        blocks: [{ court: 'Court 1', day: 0, start: '11:00', end: '11:30', label: 'net repair' }],
      }),
      2,
      [45],
    );
    const problems = validateSchedule([at('m-p0-1', 'Court 1', 660)], graph, blockedGrid, {});
    assert.ok(
      problems.some(p => p.kind === 'blocked'),
      `expected a blocked-time problem, got ${JSON.stringify(problems)}`,
    );
    // The same slot on the other court is fine — a block is per court.
    assert.deepEqual(validateSchedule([at('m-p0-1', 'Court 2', 660)], graph, blockedGrid, {}), []);
  });

  it('keeps blocked time free when generating, too', () => {
    const result = generateSchedule(
      [makeDivision('m', 4)],
      config({
        courtCount: 2,
        blocks: [{ court: null, day: null, start: '10:00', end: '12:00', label: 'ceremony' }],
      }),
      2,
    );
    assertSound(result, 'blocked');
    for (const p of result.placements) {
      const startOfDay = p.slot.day * DAY_SPAN;
      const from = p.startAbs - startOfDay;
      const to = p.endAbs - startOfDay;
      assert.ok(to <= 600 || from >= 720, `${p.matchId} runs ${from}-${to}, inside the blocked window`);
    }
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

// ── Net changes ───────────────────────────────────────────────────────────

describe('net changes', () => {
  /** Test Tournament's shape, which is what surfaced this: two divisions at
   *  2.43m and one at 2.24m over four courts, each in two pools of four, so
   *  somebody must stray onto a court seeded for a height they do not play at.
   *  `makeDivision` builds one flat round-robin and does not reproduce it. */
  function pooledDivision(id: string, netHeight: string): SchedulableDivision {
    const matches: SchedulableMatch[] = [];
    for (const pool of ['A', 'B']) {
      const teams = Array.from({ length: 4 }, (_, i) => `${id}-${pool}${i + 1}`);
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          matches.push({
            id: `${id}-${pool}-${a}${b}`,
            teamA: teams[a],
            teamB: teams[b],
            isPool: true,
            pool,
            roundIndex: 0,
            durationMinutes: 30,
          });
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      matches.push({ id: `${id}-sf${i}`, teamA: null, teamB: null, isPool: false, roundIndex: 1, durationMinutes: 45 });
    }
    matches.push({ id: `${id}-f`, teamA: null, teamB: null, isPool: false, roundIndex: 2, durationMinutes: 45 });
    return { id, label: id.toUpperCase(), pools: 2, netHeight, gender: null, matches };
  }

  const testTournamentShape = (): SchedulableDivision[] => [
    pooledDivision('men', '2.43 m'),
    pooledDivision('mixed', '2.43 m'),
    pooledDivision('women', '2.24 m'),
  ];

  const netConfig = config({ courtCount: 4, endTime: '17:00', blockMinutes: 45 });

  /** Every court's first match of a day, as { placement, node }. */
  function firstOfEachCourtDay(result: ReturnType<typeof generateSchedule>) {
    const first = new Map<string, (typeof result.placements)[number]>();
    for (const p of result.placements) {
      const key = `${p.slot.day}:${p.courtIndex}`;
      const held = first.get(key);
      if (!held || p.slot.abs < held.slot.abs) first.set(key, p);
    }
    return [...first.values()];
  }

  it('never charges a net change against the first match of a court-day', () => {
    // The seeded height (generate.ts rigs each court for the division whose
    // affinity claims it) used to be charged as court time, so a court could
    // open fifteen minutes late having hosted nothing — and the running height
    // crossed the overnight break, so on day two every court did.
    const result = generateSchedule(testTournamentShape(), netConfig, 2);
    assertSound(result, 'first match of a court-day');

    for (const p of firstOfEachCourtDay(result)) {
      assert.equal(
        p.startAbs,
        p.slot.abs,
        `${p.matchId} opens ${p.courtName} on day ${p.slot.day + 1} and must start when the slot does`,
      );
    }
  });

  it('still charges a net change that a match is actually waiting for', () => {
    // One court and two heights: they have to interleave, so the net really
    // does move mid-play and the buffer is real court time. Guards against
    // fixing the first-match case by never charging the buffer at all.
    const divisions = [
      makeDivision('men', 4, { netHeight: '2.43m', gender: 'Men' }),
      makeDivision('women', 4, { netHeight: '2.24m', gender: 'Women' }),
    ];
    const cfg = config({ courtCount: 1, stageFinals: false });
    const result = generateSchedule(divisions, cfg, 3);
    assertSound(result, 'net change mid-day');

    const heightOf = (id: string) => result.graph.nodes.get(id)!.netHeight;
    const byCourtDay = new Map<string, typeof result.placements>();
    for (const p of result.placements) {
      const key = `${p.slot.day}:${p.courtIndex}`;
      byCourtDay.set(key, [...(byCourtDay.get(key) ?? []), p]);
    }

    let charged = 0;
    for (const run of byCourtDay.values()) {
      const order = [...run].sort((a, b) => a.slot.abs - b.slot.abs);
      for (let i = 1; i < order.length; i++) {
        const before = order[i - 1];
        const after = order[i];
        const ha = heightOf(before.matchId);
        const hb = heightOf(after.matchId);
        if (ha == null || hb == null || ha === hb) continue;
        assert.ok(
          after.startAbs >= before.endAbs + cfg.netBufferMinutes,
          `${after.matchId} follows ${before.matchId} at a different height and must leave ${cfg.netBufferMinutes}min to move the net`,
        );
        if (after.startAbs > after.slot.abs) charged++;
      }
    }
    assert.ok(charged > 0, 'at least one net change delayed play, or this asserts nothing');
  });

  it('keeps divisions on their own courts once the buffer stops being charged at the start of a day', () => {
    // The seeding the first test defuses exists to cluster divisions onto their
    // own courts. It is now a cost-function term only, and it must still work.
    const divisions = [
      makeDivision('men', 4, { netHeight: '2.43m', gender: 'Men' }),
      makeDivision('women', 4, { netHeight: '2.24m', gender: 'Women' }),
    ];
    const result = generateSchedule(divisions, config({ courtCount: 4, stageFinals: false }), 2);
    assertSound(result, 'clustering survives');
    assert.ok(result.pivots <= 2, `expected almost no net changes, got ${result.pivots}`);
  });
});
