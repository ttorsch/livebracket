// Unit tests for the redraw discard cost.
//
// Run with:  npm test
//
// These numbers are shown to an organizer immediately before work is deleted
// with no way back, so the thing under test is that the count is honest: it
// never understates what will be lost, and never names a category that is
// empty.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  NO_DISCARD_COST,
  describeDiscardCost,
  isEmptyCost,
  tallyDiscardCost,
  type PlacementRow,
} from './discardCost.ts';

/** An unplaced, unpinned, unrefereed match — the empty starting point. */
function row(patch: Partial<PlacementRow> = {}): PlacementRow {
  return {
    court: null,
    planned_time: null,
    scheduled_time: null,
    pinned: false,
    referee_team_id: null,
    ...patch,
  };
}

const PLACED = { court: 'Court 1', planned_time: '2026-06-01T09:00:00Z' };

describe('tallyDiscardCost', () => {
  it('counts nothing for a division that was never scheduled', () => {
    const cost = tallyDiscardCost([row(), row(), row()]);
    assert.deepEqual(cost, NO_DISCARD_COST);
    assert.equal(isEmptyCost(cost), true);
  });

  it('counts a match only when it has both a court and a time', () => {
    const cost = tallyDiscardCost([
      row(PLACED),
      row({ court: 'Court 2' }), // a court but no time: nowhere to turn up to
      row({ planned_time: '2026-06-01T10:00:00Z' }), // a time but no court
    ]);
    assert.equal(cost.placed, 1);
  });

  it('still counts a placement once drift has moved it', () => {
    // planned_time is the published promise; scheduled_time is the live
    // projection. Either one, with a court, is work that would be lost.
    const cost = tallyDiscardCost([
      row({ court: 'Court 1', planned_time: '2026-06-01T09:00:00Z', scheduled_time: '2026-06-01T09:40:00Z' }),
      row({ court: 'Court 2', scheduled_time: '2026-06-01T11:00:00Z' }),
    ]);
    assert.equal(cost.placed, 2);
  });

  it('counts a pin even when the pinned match is not placed', () => {
    // A pin the generator has not yet honoured is still organizer intent, and
    // still destroyed by the redraw. Undercounting it would be a lie.
    const cost = tallyDiscardCost([row({ pinned: true })]);
    assert.equal(cost.pinned, 1);
    assert.equal(cost.placed, 0);
    assert.equal(isEmptyCost(cost), false);
  });

  it('counts referee duty separately from placement', () => {
    const cost = tallyDiscardCost([
      row({ ...PLACED, referee_team_id: 'team-a' }),
      row({ referee_team_id: 'team-b' }),
    ]);
    assert.equal(cost.refereed, 2);
    assert.equal(cost.placed, 1);
  });

  it('tallies a fully worked division across all three categories', () => {
    const cost = tallyDiscardCost([
      row({ ...PLACED, pinned: true, referee_team_id: 'team-a' }),
      row(PLACED),
      row(),
    ]);
    assert.deepEqual(cost, { placed: 2, pinned: 1, refereed: 1 });
  });
});

describe('describeDiscardCost', () => {
  it('names one category on its own', () => {
    assert.equal(describeDiscardCost({ placed: 46, pinned: 0, refereed: 0 }), '46 scheduled matches');
  });

  it('joins two with "and", and three with a comma then "and"', () => {
    assert.equal(
      describeDiscardCost({ placed: 46, pinned: 14, refereed: 0 }),
      '46 scheduled matches and 14 manual edits',
    );
    assert.equal(
      describeDiscardCost({ placed: 46, pinned: 14, refereed: 3 }),
      '46 scheduled matches, 14 manual edits and 3 referee assignments',
    );
  });

  it('never names a category that is empty', () => {
    // "0 manual edits" in a warning reads as noise and teaches the organizer
    // to skim the sentence that is meant to stop them.
    const text = describeDiscardCost({ placed: 0, pinned: 5, refereed: 0 });
    assert.equal(text, '5 manual edits');
    assert.ok(!text.includes('0 '));
  });

  it('singularises each category', () => {
    assert.equal(
      describeDiscardCost({ placed: 1, pinned: 1, refereed: 1 }),
      '1 scheduled match, 1 manual edit and 1 referee assignment',
    );
  });

  it('says "nothing" rather than an empty string', () => {
    assert.equal(describeDiscardCost(NO_DISCARD_COST), 'nothing');
  });
});
