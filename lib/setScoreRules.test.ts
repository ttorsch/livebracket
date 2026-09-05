import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readScoringRules, setsToWin, targetForSet, matchDecided, visibleSetCount,
  setProblem, matchScoreProblem, DEFAULT_SCORING_RULES, type ScoringRules,
} from './setScoreRules.ts';

/* The format the organizer means by "15-15-11". */
const R15: ScoringRules = {
  setsBestOf: 3, pointsPerSet: 15, decidingSetPoints: 11, winBy2: true, hardCap: 0,
};

test('readScoringRules takes the stored blob as it is', () => {
  assert.deepEqual(
    readScoringRules({ winBy2: true, hardCap: 0, setsBestOf: 3, pointsPerSet: 15, decidingSetPoints: 11 }),
    R15,
  );
});

test('readScoringRules falls back rather than breaking on a missing blob', () => {
  assert.deepEqual(readScoringRules(null), DEFAULT_SCORING_RULES);
  assert.deepEqual(readScoringRules({ setsBestOf: 0, pointsPerSet: -4 }), {
    ...DEFAULT_SCORING_RULES, setsBestOf: 3, pointsPerSet: 21,
  });
});

test('setsToWin is a majority of the best-of', () => {
  assert.equal(setsToWin(R15), 2);
  assert.equal(setsToWin({ ...R15, setsBestOf: 5 }), 3);
  assert.equal(setsToWin({ ...R15, setsBestOf: 1 }), 1);
});

test('the last possible set is the short one', () => {
  assert.equal(targetForSet(R15, 0), 15);
  assert.equal(targetForSet(R15, 1), 15);
  assert.equal(targetForSet(R15, 2), 11);
});

test('a set short of its target is not a set', () => {
  assert.match(setProblem(R15, 0, { a: 14, b: 9 }) ?? '', /played to 15/);
  assert.match(setProblem(R15, 2, { a: 10, b: 4 }) ?? '', /played to 11/);
  // The deciding set's own target, not the other sets'.
  assert.equal(setProblem(R15, 2, { a: 11, b: 4 }), null);
});

test('over the target is a deuce, and allowed', () => {
  assert.equal(setProblem(R15, 0, { a: 17, b: 15 }), null);
  assert.equal(setProblem(R15, 0, { a: 24, b: 22 }), null);
  assert.equal(setProblem(R15, 2, { a: 13, b: 11 }), null);
});

test('win by two is enforced, and a drawn set refused', () => {
  assert.match(setProblem(R15, 0, { a: 16, b: 15 }) ?? '', /won by two/);
  assert.match(setProblem(R15, 0, { a: 15, b: 15 }) ?? '', /needs a winner/);
  assert.equal(setProblem({ ...R15, winBy2: false }, 0, { a: 16, b: 15 }), null);
});

test('a hard cap ends the set on one point, and bounds it', () => {
  const capped: ScoringRules = { ...R15, hardCap: 17 };
  assert.equal(setProblem(capped, 0, { a: 17, b: 16 }), null);
  assert.match(setProblem(capped, 0, { a: 18, b: 16 }) ?? '', /17-point cap/);
});

test('an empty result is legal — it is how a mistake is cleared', () => {
  assert.equal(matchScoreProblem(R15, []), null);
});

test('a best-of-3 cannot hold a fourth set', () => {
  const sets = [{ a: 15, b: 9 }, { a: 9, b: 15 }, { a: 11, b: 8 }, { a: 15, b: 2 }];
  assert.match(matchScoreProblem(R15, sets) ?? '', /best of 3/);
});

test('no set is recorded after the match was already won', () => {
  const sets = [{ a: 15, b: 9 }, { a: 15, b: 7 }, { a: 11, b: 3 }];
  assert.match(matchScoreProblem(R15, sets) ?? '', /won after set 2/);
});

test('an unfinished match is refused', () => {
  assert.match(matchScoreProblem(R15, [{ a: 15, b: 9 }]) ?? '', /not finished/);
  assert.match(
    matchScoreProblem(R15, [{ a: 15, b: 9 }, { a: 8, b: 15 }]) ?? '',
    /not finished/,
  );
});

test('a complete result passes', () => {
  assert.equal(matchScoreProblem(R15, [{ a: 15, b: 9 }, { a: 15, b: 12 }]), null);
  assert.equal(matchScoreProblem(R15, [{ a: 15, b: 9 }, { a: 8, b: 15 }, { a: 11, b: 6 }]), null);
});

test('matchDecided knows when the third set cannot happen', () => {
  assert.equal(matchDecided(R15, [{ a: 15, b: 9 }, { a: 15, b: 7 }]), true);
  assert.equal(matchDecided(R15, [{ a: 15, b: 9 }, { a: 7, b: 15 }]), false);
});

test('a decided match is offered no further column', () => {
  // 2-0 in a best-of-3: two columns, no empty third.
  assert.equal(visibleSetCount(R15, [{ a: 15, b: 9 }, { a: 15, b: 7 }], 2), 2);
  // 1-1: the deciding set gets its column.
  assert.equal(visibleSetCount(R15, [{ a: 15, b: 9 }, { a: 7, b: 15 }], 2), 3);
  // Nothing typed yet: one column to start in.
  assert.equal(visibleSetCount(R15, [], 0), 1);
  // Never past the best-of.
  assert.equal(visibleSetCount(R15, [{ a: 15, b: 9 }, { a: 7, b: 15 }, { a: 11, b: 5 }], 3), 3);
});
