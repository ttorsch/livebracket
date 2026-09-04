// Unit tests for the set-completion rule.
//
// Run with:  npm test
//
// This is the rule the referee stops thinking about: the board decides the
// set is over, so getting it wrong either ends a set early — banking a score
// nobody played to — or never ends one at all, which is the bug this replaced.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isSetComplete, setTarget, setWinner, type ScoringRules } from './setCompletion.ts';

/* The default beach format the app ships with: best of 3, 21s, deciding 15,
 * win by two, no cap. */
const BEACH: ScoringRules = {
  setsBestOf: 3,
  pointsPerSet: 21,
  winBy2: true,
  hardCap: 0,
  decidingSetPoints: 15,
};

const rules = (over: Partial<ScoringRules>): ScoringRules => ({ ...BEACH, ...over });

describe('setTarget', () => {
  it('uses the ordinary target for every set but the last', () => {
    assert.equal(setTarget(0, BEACH), 21);
    assert.equal(setTarget(1, BEACH), 21);
  });

  it('uses the deciding target for the last set of the format', () => {
    assert.equal(setTarget(2, BEACH), 15);
    assert.equal(setTarget(4, rules({ setsBestOf: 5 })), 15);
    assert.equal(setTarget(3, rules({ setsBestOf: 5 })), 21);
  });

  it('treats the only set of a best-of-one as an ordinary set', () => {
    // Setup greys out the deciding field at this format, so honouring it here
    // would apply a number the organizer was never shown.
    assert.equal(setTarget(0, rules({ setsBestOf: 1 })), 21);
  });
});

describe('isSetComplete', () => {
  it('does not end a set before the target', () => {
    assert.equal(isSetComplete(20, 15, 0, BEACH), false);
    assert.equal(isSetComplete(0, 0, 0, BEACH), false);
  });

  it('ends the set on the target with a two-point lead', () => {
    assert.equal(isSetComplete(21, 19, 0, BEACH), true);
    assert.equal(isSetComplete(19, 21, 0, BEACH), true);
  });

  it('plays on through a deuce when win-by-two is set', () => {
    assert.equal(isSetComplete(21, 20, 0, BEACH), false);
    assert.equal(isSetComplete(24, 23, 0, BEACH), false);
    assert.equal(isSetComplete(25, 23, 0, BEACH), true);
  });

  it('never ends a set on a drawn score', () => {
    assert.equal(isSetComplete(21, 21, 0, BEACH), false);
    assert.equal(isSetComplete(30, 30, 0, rules({ hardCap: 25 })), false);
  });

  it('ends on the target by one point when win-by-two is off', () => {
    const r = rules({ winBy2: false });
    assert.equal(isSetComplete(21, 20, 0, r), true);
    assert.equal(isSetComplete(20, 19, 0, r), false);
  });

  it('ends a deuce at the hard cap on a one-point lead', () => {
    const r = rules({ hardCap: 25 });
    assert.equal(isSetComplete(24, 23, 0, r), false);
    assert.equal(isSetComplete(25, 24, 0, r), true);
  });

  it('applies the deciding target to the deciding set', () => {
    assert.equal(isSetComplete(15, 13, 2, BEACH), true);
    // The same score in set 1 is nowhere near 21.
    assert.equal(isSetComplete(15, 13, 0, BEACH), false);
  });

  it('never ends a set when the organizer left the target blank', () => {
    // 0 means "no target chosen", not "every score wins".
    assert.equal(isSetComplete(21, 0, 0, rules({ pointsPerSet: 0 })), false);
    assert.equal(isSetComplete(99, 0, 2, rules({ decidingSetPoints: 0 })), false);
  });

  it('ignores a cap set below the target rather than ending sets early', () => {
    // A misconfigured cap should degrade to plain win-by-two, not to a set
    // that ends at 10.
    const r = rules({ hardCap: 10 });
    assert.equal(isSetComplete(11, 9, 0, r), false);
    assert.equal(isSetComplete(21, 19, 0, r), true);
  });
});

describe('setWinner', () => {
  it('names the side with more points', () => {
    assert.equal(setWinner(21, 19), 'a');
    assert.equal(setWinner(19, 21), 'b');
  });

  it('has no winner for a drawn score', () => {
    assert.equal(setWinner(21, 21), null);
  });
});
