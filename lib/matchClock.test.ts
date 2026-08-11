// Unit tests for the shared match clock.
//
// Run with:  npm test
//
// The referee's scorekeeper and the organizer's court board print this same
// number for the same match, so a disagreement between them is a bug the UI
// can't show you — both screens would just look plausible.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { elapsedSeconds, formatClock } from './matchClock.ts';

const T0 = 1_700_000_000_000; // arbitrary fixed epoch

describe('elapsedSeconds', () => {
  it('counts whole seconds from the start stamp', () => {
    assert.equal(elapsedSeconds(T0, T0 + 45_000), 45);
    assert.equal(elapsedSeconds(T0, T0 + 90_500), 90);
  });

  it('reports nothing before the first point', () => {
    // No stamp means the match hasn't started — distinct from "0 seconds in",
    // which is why this is null rather than 0.
    assert.equal(elapsedSeconds(null, T0), null);
    assert.equal(elapsedSeconds(undefined, T0), null);
  });

  it('never runs backwards when a client clock is behind the server', () => {
    // startedAt comes from the server; `now` from the viewer's machine. A
    // skewed laptop must show 00:00, not a negative duration.
    assert.equal(elapsedSeconds(T0, T0 - 5_000), 0);
  });
});

describe('formatClock', () => {
  it('pads to mm:ss under an hour', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(9), '00:09');
    assert.equal(formatClock(605), '10:05');
    assert.equal(formatClock(3599), '59:59');
  });

  it('rolls over to h:mm:ss at the hour', () => {
    assert.equal(formatClock(3600), '1:00:00');
    assert.equal(formatClock(7385), '2:03:05');
  });

  it('clamps negatives rather than printing a minus sign', () => {
    assert.equal(formatClock(-30), '00:00');
  });
});
