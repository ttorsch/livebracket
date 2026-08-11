// Unit tests for deriving which side won the most recent point.
//
// Run with:  npm test
//
// The court board tints a team when it just scored, and the referee only
// ever sends whole state — so every "who scored" answer comes out of this
// diff. It can't be exercised through the UI without a reachable Redis and
// a match in progress, so the invariants are asserted directly here.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { deriveLastScorer, type Tally } from './lastScorer.ts';

const tally = (a: number, b: number, sets: [number, number][] = []): Tally => ({
  sets: sets.map(([x, y]) => ({ a: x, b: y })),
  a,
  b,
});

describe('deriveLastScorer', () => {
  it('names the side whose score went up', () => {
    assert.equal(deriveLastScorer(tally(4, 3), tally(5, 3)), 'a');
    assert.equal(deriveLastScorer(tally(4, 3), tally(4, 4)), 'b');
  });

  it('treats the first point of a match as that side scoring', () => {
    assert.equal(deriveLastScorer(null, tally(1, 0)), 'a');
    assert.equal(deriveLastScorer(undefined, tally(0, 1)), 'b');
  });

  it('holds the previous scorer when nothing changed', () => {
    const prev = { ...tally(7, 5), lastScorer: 'b' as const };
    assert.equal(deriveLastScorer(prev, tally(7, 5)), 'b');
  });

  it('holds the previous scorer when a point is undone', () => {
    // Correcting a mis-tap must not hand the marker to the other team —
    // they didn't score, and the board is still showing their old total.
    const prev = { ...tally(8, 5), lastScorer: 'a' as const };
    assert.equal(deriveLastScorer(prev, tally(7, 5)), 'a');
  });

  it('does not swing when a set closes and the score resets', () => {
    // 20-18, A takes the set: current score resets to 0-0 and 21-18 moves
    // into the finished list. Compared per-set that reads as B gaining 18.
    const prev = { ...tally(20, 18), lastScorer: 'b' as const };
    const next = tally(0, 0, [[21, 18]]);
    assert.equal(deriveLastScorer(prev, next), 'a');
  });

  it('carries no scorer for a match that has not started', () => {
    assert.equal(deriveLastScorer(null, tally(0, 0)), null);
  });

  it('survives live state written before lastScorer existed', () => {
    // Keys already in Redis have no lastScorer field at all.
    assert.equal(deriveLastScorer(tally(6, 6), tally(6, 6)), null);
  });
});
