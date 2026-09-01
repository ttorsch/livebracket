// Unit tests for the draw-lock gate.
//
// Run with:  npm test
//
// This predicate is the only thing standing between an organizer and a
// schedule saved against match ids that a redraw will replace, and both the
// Save button and the API route ask it — so the edges it is generous or
// strict at are pinned here rather than left to whichever caller runs first.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { scheduleSaveGate, type GateDivision } from './scheduleGate.ts';

const div = (over: Partial<GateDivision> = {}): GateDivision => ({
  id: 'd1',
  label: 'Open',
  drawLocked: true,
  ...over,
});

describe('scheduleSaveGate', () => {
  it('opens when every division is locked', () => {
    const gate = scheduleSaveGate([
      div({ id: 'a', label: `Men's Open` }),
      div({ id: 'b', label: `Women's Open` }),
    ]);
    assert.equal(gate.open, true);
    assert.deepEqual(gate.unlocked, []);
    assert.equal(gate.reason, null);
  });

  it('closes on a single unlocked division, and names it', () => {
    const gate = scheduleSaveGate([
      div({ id: 'a', label: `Men's Open` }),
      div({ id: 'b', label: `Women's Open`, drawLocked: false }),
    ]);
    assert.equal(gate.open, false);
    assert.deepEqual(gate.unlocked, [{ id: 'b', label: `Women's Open` }]);
    assert.equal(gate.reason, `The draw is not locked in Women's Open.`);
  });

  // The whole-tournament rule: court capacity is shared, so one locked
  // division is not a schedule anyone can save a slice of.
  it('closes when any division is unlocked, however many are locked', () => {
    const gate = scheduleSaveGate([
      div({ id: 'a', drawLocked: true }),
      div({ id: 'b', drawLocked: true }),
      div({ id: 'c', label: 'Mixed', drawLocked: false }),
    ]);
    assert.equal(gate.open, false);
    assert.equal(gate.unlocked.length, 1);
  });

  it('reads two unlocked divisions as a sentence', () => {
    const gate = scheduleSaveGate([
      div({ id: 'a', label: `Men's Open`, drawLocked: false }),
      div({ id: 'b', label: `Women's Open`, drawLocked: false }),
    ]);
    assert.equal(gate.reason, `The draw is not locked in Men's Open and Women's Open.`);
  });

  it('reads three or more with commas and a final "and"', () => {
    const gate = scheduleSaveGate([
      div({ id: 'a', label: 'A', drawLocked: false }),
      div({ id: 'b', label: 'B', drawLocked: false }),
      div({ id: 'c', label: 'C', drawLocked: false }),
    ]);
    assert.equal(gate.reason, 'The draw is not locked in A, B and C.');
  });

  it('keeps the order it was given, so the UI and the route agree', () => {
    const gate = scheduleSaveGate([
      div({ id: 'c', label: 'C', drawLocked: false }),
      div({ id: 'a', label: 'A', drawLocked: false }),
    ]);
    assert.deepEqual(gate.unlocked.map(d => d.id), ['c', 'a']);
  });

  // A tournament with no divisions has no matches, so there is nothing to
  // refuse. Reporting "0 divisions unlocked" would be a refusal with no
  // action behind it.
  it('is vacuously open with no divisions at all', () => {
    const gate = scheduleSaveGate([]);
    assert.equal(gate.open, true);
    assert.equal(gate.reason, null);
  });

  // An undrawn division is not exempt: letting it fall out is exactly how a
  // whole division goes missing from a saved schedule.
  it('does not exempt a division whose draw was never generated', () => {
    const gate = scheduleSaveGate([div({ id: 'a', label: 'Juniors', drawLocked: false })]);
    assert.equal(gate.open, false);
    assert.equal(gate.reason, 'The draw is not locked in Juniors.');
  });
});
