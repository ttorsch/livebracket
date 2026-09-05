import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowAroundPins, respectPins, planDrop, type Placement } from './dropPlan.ts';

const H = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

test('a pinned match keeps its time and the rest flows after it', () => {
  const out = flowAroundPins([
    { id: 'a', start: H('09:00'), duration: 60, pinned: false },
    { id: 'pin', start: H('10:00'), duration: 60, pinned: true },
    { id: 'b', start: H('09:30'), duration: 60, pinned: false },
  ]);
  const at = (id: string) => out.find(o => o.id === id)!.start;
  assert.equal(at('pin'), H('10:00'), 'the pin does not move');
  // b wanted 09:30 but a runs to 10:00, and the pin owns 10:00-11:00.
  assert.equal(at('b'), H('11:00'));
});

test('an unpinned match steps over a pin rather than through it', () => {
  const out = flowAroundPins([
    { id: 'pin', start: H('10:00'), duration: 60, pinned: true },
    { id: 'x', start: H('09:45'), duration: 60, pinned: false },
  ]);
  assert.equal(out.find(o => o.id === 'pin')!.start, H('10:00'));
  assert.equal(out.find(o => o.id === 'x')!.start, H('11:00'));
});

test('two pins in a row are both stepped over', () => {
  const out = flowAroundPins([
    { id: 'p1', start: H('10:00'), duration: 60, pinned: true },
    { id: 'p2', start: H('11:00'), duration: 60, pinned: true },
    { id: 'x', start: H('10:15'), duration: 30, pinned: false },
  ]);
  assert.equal(out.find(o => o.id === 'x')!.start, H('12:00'));
});

test('nothing overlaps after a repair', () => {
  const out = flowAroundPins([
    { id: 'a', start: H('09:00'), duration: 60, pinned: false },
    { id: 'p', start: H('09:30'), duration: 60, pinned: true },
    { id: 'b', start: H('09:15'), duration: 45, pinned: false },
  ]);
  const sorted = [...out].sort((x, y) => x.start - y.start);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i].start >= sorted[i - 1].start + sorted[i - 1].duration,
      `${sorted[i].id} overlaps ${sorted[i - 1].id}`,
    );
  }
});

/* Court 1: m1 09:00, m2 10:00, m3 11:00 — each 60 minutes. */
const run: Placement[] = [
  { id: 'm1', court: 'Court 1', day: 0, start: H('09:00'), durationMinutes: 60 },
  { id: 'm2', court: 'Court 1', day: 0, start: H('10:00'), durationMinutes: 60 },
  { id: 'm3', court: 'Court 1', day: 0, start: H('11:00'), durationMinutes: 60 },
  { id: 'x', court: 'Court 2', day: 0, start: H('09:00'), durationMinutes: 60 },
];

test('without pins, an insertion pushes the rest later (unchanged behaviour)', () => {
  const plan = planDrop(run, 'x', 'Court 1', 0, { beforeId: 'm2' }, H('09:00'));
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;
  assert.equal(at('x'), H('10:00'));
  assert.equal(at('m2'), H('11:00'));
  assert.equal(at('m3'), H('12:00'));
});

test('a pinned match is not pushed by an insertion in front of it', () => {
  const plan = planDrop(run, 'x', 'Court 1', 0, { beforeId: 'm2' }, H('09:00'));
  const repaired = respectPins(run, plan, new Set(['m3']));
  const at = (id: string) => repaired.moves.find(m => m.id === id)?.start ?? run.find(p => p.id === id)!.start;
  assert.equal(at('m3'), H('11:00'), 'the pinned match stayed put');
  // Everything still has its own minute.
  const seats = ['m1', 'x', 'm2', 'm3']
    .map(id => ({ id, start: at(id) as number, dur: 60 }))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < seats.length; i++) {
    assert.ok(seats[i].start >= seats[i - 1].start + seats[i - 1].dur, `${seats[i].id} overlaps`);
  }
});

test('pins on another court are left alone', () => {
  const plan = planDrop(run, 'm1', 'Court 2', 0, { append: true }, H('09:00'));
  const repaired = respectPins(run, plan, new Set(['x']));
  const xMove = repaired.moves.find(m => m.id === 'x');
  assert.equal(xMove, undefined, 'the pinned match on the destination court did not move');
});

test('an empty pin set changes nothing', () => {
  const plan = planDrop(run, 'x', 'Court 1', 0, { beforeId: 'm2' }, H('09:00'));
  const repaired = respectPins(run, plan, new Set());
  assert.deepEqual(repaired.moves, plan.moves);
});
