// Unit tests for bracket crossing.
//
// Run with:  npm test

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { crossBracket } from './crossing.ts';

/* The opening round as "A1 v C2" pairs; "—" is a bye seat. */
function pairs(crossing: string, counts: number[]): string[] {
  const { slotsA, slotsB } = crossBracket(crossing, counts);
  const name = (s: { pool: string; rank: number } | null) => (s ? `${s.pool}${s.rank}` : '—');
  return slotsA.map((a, i) => `${name(a)} v ${name(slotsB[i] ?? null)}`);
}

describe('crossBracket', () => {
  it('keeps the fixed crossings where they can draw the field', () => {
    assert.deepEqual(pairs('fivb', [2, 2, 2, 2]), ['A1 v C2', 'B1 v D2', 'C1 v A2', 'D1 v B2']);
    assert.deepEqual(pairs('static', [2, 2, 2, 2]), ['A1 v D2', 'B1 v C2', 'C1 v B2', 'D1 v A2']);
    assert.deepEqual(pairs('fivb', [2, 2]), ['A1 v B2', 'B1 v A2']);
  });

  it('never pairs two teams out of the same pool', () => {
    // FIVB crosses only winners and runners-up; 3rd and 4th used to be
    // dropped in pool order, which drew A3 v A4.
    for (const crossing of ['fivb', 'static']) {
      for (const counts of [[4, 4], [4, 4, 4, 4], [3, 3, 3, 3], [2, 2, 2, 2, 2, 2, 2, 2]]) {
        for (const p of pairs(crossing, counts)) {
          const [a, b] = p.split(' v ');
          assert.ok(a === '—' || b === '—' || a[0] !== b[0], `${crossing} ${JSON.stringify(counts)}: ${p}`);
        }
      }
    }
  });

  it('leaves no match empty when the field fills the bracket', () => {
    // The static charts exist for four pools only; elsewhere they left seats
    // with nobody in them.
    for (const counts of [[4, 4], [2, 2], [4, 4, 4, 4], [2, 2, 2, 2, 2, 2, 2, 2]]) {
      for (const p of pairs('static', counts)) assert.ok(!p.includes('—'), `${JSON.stringify(counts)}: ${p}`);
    }
  });

  it('puts a pool winner and its runner-up in opposite halves', () => {
    // A1 and A2 can only meet in the final; the first two matches are one half.
    assert.deepEqual(pairs('fivb', [4, 4]), ['A1 v B4', 'B2 v A3', 'B1 v A4', 'A2 v B3']);
    assert.deepEqual(pairs('static', [4, 4]), ['A1 v B4', 'B2 v A3', 'B1 v A4', 'A2 v B3']);
  });

  it('gives the byes to the pool winners when the field is short', () => {
    assert.deepEqual(pairs('fivb', [3, 3]), ['A1 v —', 'B2 v A3', 'B1 v —', 'A2 v B3']);
  });

  it('spreads four pools of four one to a quarter', () => {
    const { slotsA, slotsB } = crossBracket('fivb', [4, 4, 4, 4]);
    for (let q = 0; q < 4; q++) {
      const pools = [slotsA[2 * q], slotsB[2 * q], slotsA[2 * q + 1], slotsB[2 * q + 1]].map(s => s?.pool).sort();
      assert.deepEqual(pools, ['A', 'B', 'C', 'D'], `quarter ${q + 1}`);
    }
  });
});
