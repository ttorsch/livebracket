// Unit tests for cross-device scoring.
//
// Run with:  npm test
//
// Both rules here exist to stop a point disappearing: ownership stops a
// second device overwriting the first, and the restore comparison stops a
// recovered tab pushing stale numbers over good ones.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  canScore,
  retryDelay,
  scoringRole,
  shouldRestoreLocal,
  totalPoints,
} from './scoreSync.ts';

const PHONE = 'device-phone';
const TABLET = 'device-tablet';

describe('scoringRole', () => {
  it('is unclaimed until someone scores', () => {
    // The ordinary one-phone match never leaves this state until its first
    // point, so opening a fresh link must not demand a claim.
    assert.equal(scoringRole(null, PHONE), 'unclaimed');
    assert.equal(scoringRole(undefined, PHONE), 'unclaimed');
    assert.equal(scoringRole('', PHONE), 'unclaimed');
  });

  it('names the claiming device the owner', () => {
    assert.equal(scoringRole(PHONE, PHONE), 'owner');
  });

  it('makes every other device a follower', () => {
    assert.equal(scoringRole(PHONE, TABLET), 'follower');
  });
});

describe('canScore', () => {
  it('lets the owner and an unclaimed device score', () => {
    assert.equal(canScore('owner'), true);
    assert.equal(canScore('unclaimed'), true);
  });

  it('holds a follower back until it takes over', () => {
    assert.equal(canScore('follower'), false);
  });
});

describe('retryDelay', () => {
  it('backs off exponentially from the base', () => {
    assert.equal(retryDelay(0), 1000);
    assert.equal(retryDelay(1), 2000);
    assert.equal(retryDelay(2), 4000);
    assert.equal(retryDelay(3), 8000);
  });

  it('caps so a long outage keeps retrying at a sane rate', () => {
    assert.equal(retryDelay(4), 15000);
    assert.equal(retryDelay(50), 15000);
  });

  it('treats a negative attempt as the first one', () => {
    assert.equal(retryDelay(-1), 1000);
  });
});

describe('shouldRestoreLocal', () => {
  it('restores points the server never received', () => {
    assert.equal(shouldRestoreLocal({ updatedAt: 200 }, { updatedAt: 100 }), true);
    assert.equal(shouldRestoreLocal({ updatedAt: 200 }, null), true);
  });

  it('leaves the server alone when it is already ahead', () => {
    assert.equal(shouldRestoreLocal({ updatedAt: 100 }, { updatedAt: 200 }), false);
  });

  it('gives a tie to the server', () => {
    // Equal stamps mean the server already has this exact state, so
    // restoring would only risk re-pushing it.
    assert.equal(shouldRestoreLocal({ updatedAt: 100 }, { updatedAt: 100 }), false);
  });

  it('restores a correction that lowered the score', () => {
    // The decisive case for comparing stamps rather than points: taking a
    // mis-tapped point off makes the newer copy smaller, and it must still
    // win or the correction is silently undone.
    assert.equal(shouldRestoreLocal({ updatedAt: 300 }, { updatedAt: 250 }), true);
  });

  it('ignores nothing-to-restore and malformed local state', () => {
    assert.equal(shouldRestoreLocal(null, { updatedAt: 100 }), false);
    assert.equal(shouldRestoreLocal(undefined, null), false);
    assert.equal(
      shouldRestoreLocal({ updatedAt: 'later' } as unknown as { updatedAt: number }, null),
      false
    );
  });
});

describe('totalPoints', () => {
  it('sums banked sets and the set in progress', () => {
    assert.equal(totalPoints({ sets: [{ a: 21, b: 19 }, { a: 15, b: 12 }], a: 3, b: 4 }), 74);
  });

  it('copes with an empty board', () => {
    assert.equal(totalPoints({ sets: [], a: 0, b: 0 }), 0);
  });
});
