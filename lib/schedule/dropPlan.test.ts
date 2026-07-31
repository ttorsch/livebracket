import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDrop, type Placement } from './dropPlan.ts';

const H = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** A court's matches back to back from 09:00, 60 minutes each. */
function court(name: string, ids: string[], from = H('09:00'), dur = 60, day = 0): Placement[] {
  return ids.map((id, i) => ({ id, court: name, day, start: from + i * dur, durationMinutes: dur }));
}

/** The schedule after a plan is applied, as court -> "id@HH:MM" in time order. */
function apply(placements: Placement[], plan: ReturnType<typeof planDrop>): Record<string, string[]> {
  const moves = new Map(plan.map(m => [m.id, m]));
  const out = new Map<string, { id: string; start: number }[]>();
  for (const p of placements) {
    const move = moves.get(p.id);
    const at = move ? move.start : p.start;
    const on = move ? move.court : p.court;
    if (at == null) continue;
    const list = out.get(on) ?? [];
    list.push({ id: p.id, start: at });
    out.set(on, list);
  }
  return Object.fromEntries(
    [...out.entries()].map(([c, list]) => [
      c,
      list.sort((a, b) => a.start - b.start).map(x => `${x.id}@${hhmm(x.start)}`),
    ]),
  );
}

/** No two matches on a court may share a minute. */
function assertNoOverlap(placements: Placement[], plan: ReturnType<typeof planDrop>) {
  const moves = new Map(plan.map(m => [m.id, m]));
  const byCourt = new Map<string, { start: number; end: number; id: string }[]>();
  for (const p of placements) {
    const move = moves.get(p.id);
    const at = move ? move.start : p.start;
    const on = move ? move.court : p.court;
    if (at == null) continue;
    const list = byCourt.get(on) ?? [];
    list.push({ id: p.id, start: at, end: at + p.durationMinutes });
    byCourt.set(on, list);
  }
  for (const [name, list] of byCourt) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i]!.start >= list[i - 1]!.end,
        `${name}: ${list[i]!.id} at ${hhmm(list[i]!.start)} overlaps ${list[i - 1]!.id} ending ${hhmm(list[i - 1]!.end)}`,
      );
    }
  }
}

test('dropping in front of a match on another court pushes it and everything behind it', () => {
  const p = [...court('C1', ['a', 'b', 'c']), ...court('C2', ['x', 'y', 'z'])];
  const plan = planDrop(p, 'a', 'C2', 0, { beforeId: 'y' }, H('09:00'));

  assert.deepEqual(apply(p, plan), {
    // 'a' is gone from C1 and the rest of the court closes up behind it.
    C1: ['b@09:00', 'c@10:00'],
    // 'a' takes y's slot; y and z move down by a's full hour.
    C2: ['x@09:00', 'a@10:00', 'y@11:00', 'z@12:00'],
  });
  assertNoOverlap(p, plan);
});

test('the court a match leaves closes over the gap', () => {
  const p = court('C1', ['a', 'b', 'c', 'd']);
  const plan = planDrop(p, 'b', 'C2', 0, { append: true }, H('09:00'));

  assert.deepEqual(apply(p, plan), {
    C1: ['a@09:00', 'c@10:00', 'd@11:00'],
    C2: ['b@09:00'],
  });
  assertNoOverlap(p, plan);
});

test('moving a match later on its own court lands it where the queue is after the lift', () => {
  const p = court('C1', ['a', 'b', 'c', 'd']); // 09:00, 10:00, 11:00, 12:00
  const plan = planDrop(p, 'a', 'C1', 0, { beforeId: 'd' }, H('09:00'));

  // b, c come forward an hour; 'a' goes in front of d, which ends up where it
  // started rather than being pushed twice.
  assert.deepEqual(apply(p, plan), { C1: ['b@09:00', 'c@10:00', 'a@11:00', 'd@12:00'] });
  assertNoOverlap(p, plan);
});

test('moving a match earlier on its own court pushes the ones it jumps in front of', () => {
  const p = court('C1', ['a', 'b', 'c', 'd']);
  const plan = planDrop(p, 'd', 'C1', 0, { beforeId: 'b' }, H('09:00'));

  assert.deepEqual(apply(p, plan), { C1: ['a@09:00', 'd@10:00', 'b@11:00', 'c@12:00'] });
  assertNoOverlap(p, plan);
});

test('matches of different lengths push by the length of the one that arrives', () => {
  const p: Placement[] = [
    { id: 'a', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 90 },
    ...court('C2', ['x', 'y']),
  ];
  const plan = planDrop(p, 'a', 'C2', 0, { beforeId: 'y' }, H('09:00'));

  assert.deepEqual(apply(p, plan), { C2: ['x@09:00', 'a@10:00', 'y@11:30'] });
  assertNoOverlap(p, plan);
});

test('appending puts a match after the last one on the court', () => {
  const p = [...court('C1', ['a']), ...court('C2', ['x', 'y'])];
  const plan = planDrop(p, 'a', 'C2', 0, { append: true }, H('09:00'));

  assert.deepEqual(apply(p, plan), { C2: ['x@09:00', 'y@10:00', 'a@11:00'] });
});

test('appending to an empty court starts it at the start of the day', () => {
  const p = court('C1', ['a', 'b']);
  const plan = planDrop(p, 'b', 'C9', 0, { append: true }, H('08:30'));

  assert.deepEqual(apply(p, plan), { C1: ['a@09:00'], C9: ['b@08:30'] });
});

test('a drop on empty time takes that time, and pushes only what it would land on', () => {
  const p = [...court('C1', ['a']), ...court('C2', ['x', 'y'], H('09:00'), 60)];

  // 11:00 is free — x and y end at 11:00, so nothing needs to move.
  const clear = planDrop(p, 'a', 'C2', 0, { time: H('11:00') }, H('09:00'));
  assert.deepEqual(apply(p, clear), { C2: ['x@09:00', 'y@10:00', 'a@11:00'] });
  assertNoOverlap(p, clear);

  // 09:30 is inside x's hour: y is the first match at or after it, and moves
  // just far enough to clear a's hour.
  const tight = planDrop(p, 'a', 'C2', 0, { time: H('09:30') }, H('09:00'));
  assert.deepEqual(apply(p, tight), { C2: ['x@09:00', 'a@09:30', 'y@10:30'] });
});

test('an unscheduled match can be dropped in without disturbing a court it was never on', () => {
  const p: Placement[] = [
    { id: 'u', court: 'Unscheduled', day: -1, start: null, durationMinutes: 60 },
    ...court('C1', ['a', 'b']),
  ];
  const plan = planDrop(p, 'u', 'C1', 0, { beforeId: 'b' }, H('09:00'));

  assert.deepEqual(apply(p, plan), { C1: ['a@09:00', 'u@10:00', 'b@11:00'] });
  assertNoOverlap(p, plan);
});

test('days are separate queues: a drop on day 1 leaves day 0 alone', () => {
  const p = [...court('C1', ['a', 'b'], H('09:00'), 60, 0), ...court('C1', ['m', 'n'], H('09:00'), 60, 1)];
  const plan = planDrop(p, 'a', 'C1', 1, { beforeId: 'n' }, H('09:00'));

  const moves = new Map(plan.map(x => [x.id, x]));
  assert.equal(moves.get('a')?.start, H('10:00'));
  assert.equal(moves.get('a')?.day, 1);
  assert.equal(moves.get('n')?.start, H('11:00'));
  // b comes forward on day 0; m never moves.
  assert.equal(moves.get('b')?.start, H('09:00'));
  assert.equal(moves.get('m'), undefined);
});

test('a drop that cannot be resolved moves nothing', () => {
  const p = court('C1', ['a', 'b']);
  assert.deepEqual(planDrop(p, 'a', 'C1', 0, { beforeId: 'nope' }, H('09:00')), []);
  assert.deepEqual(planDrop(p, 'ghost', 'C1', 0, { append: true }, H('09:00')), []);
});
