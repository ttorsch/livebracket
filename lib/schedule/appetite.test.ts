// Unit tests for court appetite and the block allotment.
//
// Run with:  npm test
//
// The appetite formula *is* the rest guarantee — there is no other rule that
// keeps half a division off court — so what these test is the invariant rather
// than the arithmetic: for a division drawn into pools, the courts it is given
// never put more than half its teams on court at once.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { allotBlocks, appetiteOf, divisionQueue, type Appetite } from './appetite.ts';
import type { MatchNode } from './graph.ts';

/** A pool match between two named teams. */
function poolMatch(pool: string, a: string, b: string, id = `${pool}-${a}${b}`): MatchNode {
  return {
    id,
    divisionId: 'd',
    divisionLabel: 'D',
    teamA: a,
    teamB: b,
    refereeTeam: null,
    isPool: true,
    pool,
    isThirdPlace: false,
    durationMinutes: 20,
    roundIndex: 0,
    indexInRound: 0,
    netHeight: null,
    deps: [],
    dependents: [],
    level: 0,
    depth: 0,
    tailMinutes: 20,
  };
}

/** A complete round robin for one pool of `teams`. */
function pool(name: string, teams: string[]): MatchNode[] {
  const out: MatchNode[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      out.push(poolMatch(name, teams[i], teams[j], `${name}-${teams[i]}${teams[j]}`));
    }
  }
  return out;
}

/** `count` pools of `size` teams each, teams named uniquely across pools. */
function draw(count: number, size: number): MatchNode[] {
  const out: MatchNode[] = [];
  for (let p = 0; p < count; p++) {
    const name = String.fromCharCode(65 + p);
    out.push(...pool(name, Array.from({ length: size }, (_, t) => `${name}${t + 1}`)));
  }
  return out;
}

describe('appetiteOf', () => {
  it('gives four pools of four exactly half the venue they could fill', () => {
    const a = appetiteOf('d', draw(4, 4));
    assert.equal(a.pools, 4);
    assert.equal(a.perPool, 2);
    assert.equal(a.wideOpen, 8);
    assert.equal(a.appetite, 4);
  });

  it('does not under-serve an odd pool count', () => {
    // The old formula floored pools/2 first and gave this division 2 courts,
    // so a third of it sat down for the whole event.
    const a = appetiteOf('d', draw(3, 4));
    assert.equal(a.appetite, 3);
  });

  it('scales with pool size rather than pool count', () => {
    // Two pools of six is the same twelve teams as three pools of four, and
    // gets the same three courts.
    assert.equal(appetiteOf('d', draw(2, 6)).appetite, 3);
    assert.equal(appetiteOf('d', draw(3, 4)).appetite, 3);
  });

  it('never puts more than half a division on court', () => {
    for (const pools of [1, 2, 3, 4, 5, 6]) {
      for (const size of [3, 4, 5, 6]) {
        const a = appetiteOf('d', draw(pools, size));
        const teams = pools * size;
        const onCourt = 2 * a.appetite;
        assert.ok(
          onCourt <= teams / 2 + 2,
          `${pools} pools of ${size}: ${onCourt} of ${teams} teams on court`,
        );
      }
    }
  });

  it('gives a lone pool one court, and cannot rest it', () => {
    const a = appetiteOf('d', draw(1, 4));
    assert.equal(a.appetite, 1);
  });

  it('sizes a knockout-only division off its opening round', () => {
    const matches: MatchNode[] = Array.from({ length: 8 }, (_, i) => ({
      ...poolMatch('', 'x', 'y', `qf${i}`),
      isPool: false,
      pool: null,
      roundIndex: 0,
    }));
    const a = appetiteOf('d', matches);
    assert.equal(a.pools, 0);
    assert.equal(a.appetite, 4);
  });

  it('recovers the pool size of an undrawn division from its match count', () => {
    const undrawn = draw(2, 4).map(m => ({ ...m, teamA: null, teamB: null }));
    assert.equal(appetiteOf('d', undrawn).perPool, 2);
  });
});

describe('divisionQueue', () => {
  const app = (id: string, appetite: number): Appetite =>
    ({ divisionId: id, pools: 2, perPool: 2, wideOpen: appetite * 2, appetite });

  it('puts gendered divisions in front of non-gendered ones', () => {
    // Roster overlap: a Mixed team's players come from the gendered draws.
    const cohort = (id: string) => (id === 'mixed' ? 1 : 0);
    const order = divisionQueue([app('mixed', 9), app('men', 2)], cohort);
    assert.deepEqual(order, ['men', 'mixed']);
  });

  it('orders by appetite inside a cohort, biggest first', () => {
    const order = divisionQueue([app('w', 3), app('m', 4), app('j', 2)], () => 0);
    assert.deepEqual(order, ['m', 'w', 'j']);
  });

  it('is deterministic when appetites tie', () => {
    const order = divisionQueue([app('b', 3), app('a', 3)], () => 0);
    assert.deepEqual(order, ['a', 'b']);
  });
});

describe('allotBlocks', () => {
  const men: Appetite = { divisionId: 'men', pools: 4, perPool: 2, wideOpen: 8, appetite: 4 };
  const women: Appetite = { divisionId: 'women', pools: 3, perPool: 2, wideOpen: 6, appetite: 3 };

  it('fits the pair to a venue that is one court short', () => {
    const blocks = allotBlocks([men, women], 6);
    assert.deepEqual(blocks.map(b => b.divisionId), ['men', 'women']);
    assert.deepEqual(blocks[0].courts, [0, 1, 2, 3]);
    assert.deepEqual(blocks[1].courts, [4, 5]);
  });

  it('fits the pair to a venue that matches exactly', () => {
    const blocks = allotBlocks([men, women], 7);
    assert.deepEqual(blocks[0].courts, [0, 1, 2, 3]);
    assert.deepEqual(blocks[1].courts, [4, 5, 6]);
  });

  it('gives the whole surplus to the smaller division', () => {
    const blocks = allotBlocks([men, women], 8);
    assert.deepEqual(blocks[0].courts, [0, 1, 2, 3]);
    assert.deepEqual(blocks[1].courts, [4, 5, 6, 7]);
  });

  it('leaves no court without an owner, at any venue size', () => {
    for (const courts of [1, 2, 3, 4, 5, 6, 7, 8, 12, 20]) {
      const owned = allotBlocks([men, women], courts).flatMap(b => b.courts);
      assert.deepEqual([...owned].sort((a, b) => a - b), Array.from({ length: courts }, (_, i) => i));
    }
  });

  it('does not start the smaller division when it would get under one court', () => {
    const blocks = allotBlocks([men, women], 4);
    assert.deepEqual(blocks.map(b => b.divisionId), ['men']);
    assert.deepEqual(blocks[0].courts, [0, 1, 2, 3]);
  });

  it('gives a division running alone the whole venue', () => {
    const blocks = allotBlocks([women], 8);
    assert.deepEqual(blocks[0].courts, [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the bigger appetite whole when it is second in the queue', () => {
    const blocks = allotBlocks([women, men], 8);
    assert.deepEqual(blocks.map(b => b.divisionId), ['women', 'men']);
    assert.deepEqual(blocks[1].courts.length, 4); // men keep their four
    assert.deepEqual(blocks[0].courts.length, 4); // women absorb the rest
  });
});
