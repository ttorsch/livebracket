import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDropTime, type FitDropInput } from './dropPlan.ts';

/* A court running 09:00–12:00 (540–720) with a 45-minute match at 10:00. */
const base: FitDropInput = {
  occupied: [{ start: 600, end: 645 }],
  dayStart: 540,
  dayEnd: 720,
  duration: 45,
  desiredStart: 540,
  pitch: 15,
};

test('a clear drop is left exactly where it was aimed', () => {
  assert.deepEqual(fitDropTime({ ...base, desiredStart: 540 }), { start: 540, snapped: false });
  assert.deepEqual(fitDropTime({ ...base, desiredStart: 555 }), { start: 555, snapped: false });
});

test('a drop that would overlap moves the dropped card, not the neighbour', () => {
  // Aimed at 10:15, which lands on top of the 10:00 match.
  const fit = fitDropTime({ ...base, desiredStart: 615 });
  assert.ok(fit, 'expected a fit');
  assert.equal(fit.snapped, true);
  // The nearest start that clears the 600–645 block is 645.
  assert.equal(fit.start, 645);
});

test('it snaps backwards when that is the nearer gap', () => {
  // Aimed just before the block, overlapping its front edge by 15 minutes.
  const fit = fitDropTime({ ...base, desiredStart: 585 });
  assert.ok(fit);
  assert.equal(fit.start, 555); // last start before 600 that fits 45 minutes
});

test('a fitted start lands on a calendar row when the neighbours do', () => {
  // Neighbour on grid (600-645): the fit is on grid too.
  const onGrid = fitDropTime({ ...base, desiredStart: 615 });
  assert.ok(onGrid);
  assert.equal((onGrid.start - base.dayStart) % 15, 0);
});

test('an off-grid neighbour is sat flush against, never overlapped', () => {
  // Nothing here is on a row, so tidiness has to give way to correctness.
  const fit = fitDropTime({ ...base, occupied: [{ start: 607, end: 652 }], desiredStart: 610 });
  assert.ok(fit);
  assert.equal(fit.start, 652, 'flush against the block it could not overlap');
  assert.ok(fit.start >= 652);
});

test('a fit never re-overlaps what it was avoiding', () => {
  const occupied = [{ start: 600, end: 645 }, { start: 660, end: 705 }];
  const fit = fitDropTime({ ...base, occupied, duration: 15, desiredStart: 650 });
  assert.ok(fit);
  assert.ok(fit.start >= 645 && fit.start + 15 <= 660, `got ${fit.start}`);
});

test('no gap big enough refuses the drop', () => {
  // 09:00-12:00 with only 30 free minutes anywhere, dropping a 45-minute match.
  const occupied = [{ start: 540, end: 660 }, { start: 690, end: 720 }];
  assert.equal(fitDropTime({ ...base, occupied, duration: 45, desiredStart: 600 }), null);
});

test('a full court refuses everything', () => {
  assert.equal(
    fitDropTime({ ...base, occupied: [{ start: 540, end: 720 }], desiredStart: 600 }),
    null,
  );
});

test('an empty court takes the card where it was dropped', () => {
  assert.deepEqual(
    fitDropTime({ ...base, occupied: [], desiredStart: 615 }),
    { start: 615, snapped: false },
  );
});

test('overlapping occupied spans are merged rather than double-counted', () => {
  const occupied = [{ start: 600, end: 660 }, { start: 630, end: 645 }];
  const fit = fitDropTime({ ...base, occupied, duration: 45, desiredStart: 620 });
  assert.ok(fit);
  assert.equal(fit.start, 660);
});
