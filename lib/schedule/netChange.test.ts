// Unit tests for what a net change costs.
//
// Run with:  npm test
//
// The thing under test is that the solver and the validator answer the *same*
// question the same way. `assign.ts` obeys the rule while it places, so its own
// output must never trip the validator — that round trip is the last test here
// and it is the one that would catch the two drifting apart.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  EMPTY_COURT,
  netMustMove,
  netReadyAt,
  netShortfall,
  netStateBefore,
  type NetPredecessor,
} from './netChange.ts';
import { buildGraph } from './graph.ts';
import { buildGrid, DAY_SPAN } from './grid.ts';
import { generateSchedule } from './generate.ts';
import { normaliseConfig, type SchedulableDivision } from './types.ts';
import { validateSchedule, type EditedPlacement } from './validate.ts';

const LOW = 2.24;
const HIGH = 2.43;

// ── The kernel ────────────────────────────────────────────────────────────

describe('netStateBefore', () => {
  it('reports an untouched court as free from the start of time', () => {
    const state = netStateBefore([]);
    assert.equal(state.freeAt, -Infinity);
    assert.equal(state.height, null);
    assert.deepEqual(state, EMPTY_COURT);
  });

  it('takes the free time from the most recent match, whatever it played at', () => {
    const previous: NetPredecessor[] = [
      { endAbs: 630, netHeight: null },
      { endAbs: 585, netHeight: LOW },
    ];
    assert.equal(netStateBefore(previous).freeAt, 630);
  });

  it('walks past a division that declared no height to find where the net is', () => {
    // The laundering case: an undeclared-height match in the middle must not
    // make the net change disappear. Nobody moved the net for it.
    const previous: NetPredecessor[] = [
      { endAbs: 630, netHeight: null },
      { endAbs: 585, netHeight: LOW },
    ];
    assert.equal(netStateBefore(previous).height, LOW);
  });

  it('stops at the most recent declared height, not the oldest', () => {
    const previous: NetPredecessor[] = [
      { endAbs: 630, netHeight: HIGH },
      { endAbs: 585, netHeight: LOW },
    ];
    assert.equal(netStateBefore(previous).height, HIGH);
  });

  it('stops consuming the walk once it has both halves', () => {
    // The solver hands this a backwards slot scan, so a walk that ran to the
    // start of every day would make every option more expensive to price.
    let yielded = 0;
    function* everything(): Generator<NetPredecessor> {
      for (let i = 0; i < 100; i++) {
        yielded++;
        yield { endAbs: 600 - i, netHeight: LOW };
      }
    }
    netStateBefore(everything());
    assert.equal(yielded, 1);
  });
});

describe('netMustMove', () => {
  it('is false when nothing has been rigged yet', () => {
    assert.equal(netMustMove(EMPTY_COURT, HIGH), false);
  });

  it('is false when the match declares no height of its own', () => {
    // A division with no declared height plays at whatever is already up.
    assert.equal(netMustMove({ freeAt: 600, height: LOW }, null), false);
  });

  it('is false at the same height and true at a different one', () => {
    assert.equal(netMustMove({ freeAt: 600, height: LOW }, LOW), false);
    assert.equal(netMustMove({ freeAt: 600, height: LOW }, HIGH), true);
  });
});

describe('the buffer as a wait rather than a flat charge', () => {
  const state = { freeAt: 600, height: LOW }; // court frees at 10:00

  it('costs the first match of a day nothing', () => {
    assert.equal(netReadyAt(EMPTY_COURT, HIGH, 15), -Infinity);
    assert.equal(netShortfall(540, EMPTY_COURT, HIGH, 15), 0);
  });

  it('costs nothing when the match already sits far enough after', () => {
    assert.equal(netShortfall(630, state, HIGH, 15), 0);
  });

  it('costs nothing at exactly the buffer', () => {
    assert.equal(netShortfall(615, state, HIGH, 15), 0);
  });

  it('reports what is missing when the match is too close', () => {
    assert.equal(netShortfall(605, state, HIGH, 15), 10);
    assert.equal(netShortfall(600, state, HIGH, 15), 15);
  });

  it('costs nothing when the net does not have to move at all', () => {
    assert.equal(netShortfall(600, state, LOW, 15), 0);
  });

  it('costs nothing at a venue that re-rigs instantly', () => {
    assert.equal(netShortfall(600, state, HIGH, 0), 0);
  });
});

// ── The validator ─────────────────────────────────────────────────────────

/** A division of standalone 45-minute matches: no shared teams and no
 *  dependencies, so nothing but the net can be at fault. */
function heightDivision(id: string, netHeight: string | null, count = 3): SchedulableDivision {
  return {
    id,
    label: id.toUpperCase(),
    pools: 1,
    netHeight,
    gender: null,
    matches: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i}`,
      teamA: `${id}-t${i}a`,
      teamB: `${id}-t${i}b`,
      isPool: true,
      pool: 'A',
      roundIndex: 0,
      durationMinutes: 45,
      dependsOn: [],
    })),
  };
}

describe('validating a net change in a hand-edited schedule', () => {
  const divisions = [
    heightDivision('low', '2.24m'),
    heightDivision('high', '2.43m'),
    heightDivision('any', null),
  ];
  const graph = buildGraph(divisions, 45);
  const grid = buildGrid(normaliseConfig({ courtCount: 2 }), 1, [45]);
  const at = (matchId: string, court: string, startMin: number): EditedPlacement =>
    ({ matchId, court, day: 0, startMin, durationMinutes: 45 });
  const check = (ps: EditedPlacement[], netBufferMinutes = 15) =>
    validateSchedule(ps, graph, grid, { netBufferMinutes });

  it('fills the net height onto the graph from the division', () => {
    // The bug this whole check was invisible behind: `buildGraph` used to leave
    // this null for the caller, and the page never filled it.
    assert.equal(graph.nodes.get('low-0')?.netHeight, LOW);
    assert.equal(graph.nodes.get('high-0')?.netHeight, HIGH);
    assert.equal(graph.nodes.get('any-0')?.netHeight, null);
  });

  it('flags a match dropped straight after one at a different height', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('high-0', 'Court 1', 585)]);
    const fault = problems.find(p => p.kind === 'netChange');
    assert.ok(fault, `expected a net-change problem, got ${JSON.stringify(problems)}`);
    assert.equal(fault.matchId, 'high-0', 'the arriving match carries the fault');
    assert.equal(fault.otherMatchId, 'low-0', 'and names what it has to follow');
    assert.match(fault.message, /the net is at 2.24 m after low-0/);
    assert.match(fault.message, /changing it to 2.43 m needs 15 min/);
    assert.match(fault.message, /straight after/);
  });

  it('says how short the gap is when there is one', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('high-0', 'Court 1', 595)]);
    const fault = problems.find(p => p.kind === 'netChange');
    assert.ok(fault);
    assert.match(fault.message, /this starts 10 min later/);
  });

  it('stays quiet once there is time to move the net', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('high-0', 'Court 1', 600)]);
    assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
  });

  it('stays quiet at the same height', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('low-1', 'Court 1', 585)]);
    assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
  });

  it('stays quiet on a different court — the net is per court', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('high-0', 'Court 2', 585)]);
    assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
  });

  it('does not let an undeclared-height division launder a net change', () => {
    // low 09:00–09:45, any 09:45–10:30, high 10:30. Nobody moved the net for
    // the middle match, so the high one still arrives at a 2.24 m court.
    const problems = check([
      at('low-0', 'Court 1', 540),
      at('any-0', 'Court 1', 585),
      at('high-0', 'Court 1', 630),
    ]);
    const fault = problems.find(p => p.kind === 'netChange');
    assert.ok(fault, `expected the change to survive the middle match, got ${JSON.stringify(problems)}`);
    assert.equal(fault.matchId, 'high-0');
    assert.match(fault.message, /the net is at 2.24 m/);
  });

  it('leaves an overlap to the court clash rather than doubling up', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('high-0', 'Court 1', 555)]);
    assert.ok(problems.some(p => p.kind === 'courtClash'), 'expected a court clash');
    assert.ok(
      !problems.some(p => p.kind === 'netChange'),
      'one mistake should not put two faults on one card',
    );
  });

  it('says nothing at a venue that re-rigs instantly', () => {
    const problems = check([at('low-0', 'Court 1', 540), at('high-0', 'Court 1', 585)], 0);
    assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
  });

  it('costs the first match of the day nothing', () => {
    const problems = check([at('high-0', 'Court 1', 540)]);
    assert.deepEqual(problems, [], `expected silence, got ${JSON.stringify(problems)}`);
  });
});

// ── The round trip ────────────────────────────────────────────────────────

describe('the solver and the validator agree', () => {
  it('generates a schedule that trips no net-change fault', () => {
    // The test that catches the two rules drifting apart. `assign.ts` already
    // leaves room for every net change it makes, so a validator that flags one
    // of its placements is asking a different question than the solver
    // answered — and one of them is wrong.
    const divisions = [
      heightDivision('low', '2.24m', 8),
      heightDivision('high', '2.43m', 8),
      heightDivision('any', null, 4),
    ];
    const cfg = normaliseConfig({ courtCount: 3, netBufferMinutes: 15 });
    const result = generateSchedule(divisions, cfg, 2);

    assert.ok(result.placements.length > 0, 'nothing was placed');

    const placements: EditedPlacement[] = result.placements.map(p => ({
      matchId: p.matchId,
      court: p.courtName,
      day: p.slot.day,
      startMin: p.startAbs - p.slot.day * DAY_SPAN,
      durationMinutes: result.graph.nodes.get(p.matchId)!.durationMinutes,
    }));

    const problems = validateSchedule(placements, result.graph, result.grid, {
      netBufferMinutes: cfg.netBufferMinutes,
    });
    const netFaults = problems.filter(p => p.kind === 'netChange');
    assert.deepEqual(
      netFaults,
      [],
      `the solver's own output tripped the validator: ${JSON.stringify(netFaults)}`,
    );
  });
});
