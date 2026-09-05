import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isForfeitMatch, STANDING_POINTS } from './roundFormat.ts';

describe('roundFormat standings rules', () => {
  it('defines the correct point values', () => {
    assert.equal(STANDING_POINTS.WIN, 2);
    assert.equal(STANDING_POINTS.LOSS, 1);
    assert.equal(STANDING_POINTS.FORFEIT, 0);
  });

  describe('isForfeitMatch', () => {
    it('identifies standard 21–0, 21–0 forfeit as a forfeit', () => {
      assert.equal(isForfeitMatch([21, 21], [0, 0]), true);
    });

    it('identifies 1-set 21–0 forfeit as a forfeit', () => {
      assert.equal(isForfeitMatch([21], [0]), true);
    });

    it('does not identify normal completed matches as forfeits', () => {
      assert.equal(isForfeitMatch([21, 21], [15, 18]), false);
      assert.equal(isForfeitMatch([21, 18, 15], [19, 21, 10]), false);
      assert.equal(isForfeitMatch([21, 21], [1, 0]), false);
    });

    it('handles empty or missing scores safely', () => {
      assert.equal(isForfeitMatch([], []), false);
      assert.equal(isForfeitMatch(null, null), false);
      assert.equal(isForfeitMatch([21, 21], null), false);
      assert.equal(isForfeitMatch(null, [0, 0]), false);
      assert.equal(isForfeitMatch([0, 0], [0, 0]), false);
    });
  });
});
