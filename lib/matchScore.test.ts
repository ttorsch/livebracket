import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSets, scoreProblem, scoreWinner, setWins, MAX_SETS } from './matchScore.ts';

test('setWins counts the sets each side took', () => {
  const wins = setWins([{ a: 21, b: 15 }, { a: 18, b: 21 }, { a: 15, b: 11 }]);
  assert.deepEqual(wins, { a: 2, b: 1 });
});

test('cleanSets keeps only whole, non-negative points', () => {
  assert.deepEqual(
    cleanSets([{ a: 21, b: -3 }, { a: '19' as unknown, b: 21.7 }, { a: null, b: undefined }]),
    [{ a: 21, b: 0 }, { a: 19, b: 21 }, { a: 0, b: 0 }],
  );
});

test('cleanSets refuses to grow past the longest match anyone plays', () => {
  const many = Array.from({ length: 12 }, () => ({ a: 21, b: 15 }));
  assert.equal(cleanSets(many).length, MAX_SETS);
});

test('cleanSets treats anything that is not a list as no score', () => {
  assert.deepEqual(cleanSets(undefined), []);
  assert.deepEqual(cleanSets('21-15'), []);
});

test('an empty score is allowed — it is how a result is taken back off', () => {
  assert.equal(scoreProblem([]), null);
  assert.equal(scoreWinner([]), null);
});

test('a drawn set is refused', () => {
  assert.match(scoreProblem([{ a: 21, b: 21 }]) ?? '', /Every set needs a winner/);
});

test('a match tied on sets is refused', () => {
  assert.match(
    scoreProblem([{ a: 21, b: 15 }, { a: 12, b: 21 }]) ?? '',
    /tied on sets/,
  );
});

test('a decided match passes and names its winner', () => {
  const sets = [{ a: 21, b: 15 }, { a: 12, b: 21 }, { a: 15, b: 9 }];
  assert.equal(scoreProblem(sets), null);
  assert.equal(scoreWinner(sets), 'A');
  assert.equal(scoreWinner([{ a: 9, b: 15 }]), 'B');
});
