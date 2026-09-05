import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDrop, type Placement, type PlanDropResult } from './dropPlan.ts';
import type { BlockedPeriod } from './types.ts';

const H = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** A court's matches back to back from 09:00, 60 minutes each. */
function court(name: string, ids: string[], from = H('09:00'), dur = 60, day = 0): Placement[] {
  return ids.map((id, i) => ({ id, court: name, day, start: from + i * dur, durationMinutes: dur }));
}

/** The schedule after a plan is applied, as court -> "id@HH:MM" in time order. */
function apply(placements: Placement[], plan: PlanDropResult): Record<string, string[]> {
  const moves = new Map(plan.moves.map(m => [m.id, m]));
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

/** No two matches or buffer blocks on a court may share a minute. */
function assertNoOverlap(placements: Placement[], plan: PlanDropResult, blocks: BlockedPeriod[] = []) {
  const moves = new Map(plan.moves.map(m => [m.id, m]));
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
  for (const b of plan.blocks) {
    if (!b.court) continue;
    const list = byCourt.get(b.court) ?? [];
    list.push({ id: `block-${b.label}`, start: H(b.start), end: H(b.end) });
    byCourt.set(b.court, list);
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

  const moves = new Map(plan.moves.map(x => [x.id, x]));
  assert.equal(moves.get('a')?.start, H('10:00'));
  assert.equal(moves.get('a')?.day, 1);
  assert.equal(moves.get('n')?.start, H('11:00'));
  // b comes forward on day 0; m never moves.
  assert.equal(moves.get('b')?.start, H('09:00'));
  assert.equal(moves.get('m'), undefined);
});

test('a drop that cannot be resolved moves nothing', () => {
  const p = court('C1', ['a', 'b']);
  assert.deepEqual(planDrop(p, 'a', 'C1', 0, { beforeId: 'nope' }, H('09:00')).moves, []);
  assert.deepEqual(planDrop(p, 'ghost', 'C1', 0, { append: true }, H('09:00')).moves, []);
});

test('dropping in front pushes buffer time cards down along with match cards', () => {
  const p = [
    { id: 'a', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'b', court: 'C1', day: 0, start: H('10:00'), durationMinutes: 60 },
    { id: 'c', court: 'C1', day: 0, start: H('11:15'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const blocks: BlockedPeriod[] = [
    { court: 'C1', day: 0, start: '11:00', end: '11:15', label: 'Buffer' },
  ];

  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'b' }, H('09:00'), blocks);

  assert.deepEqual(apply(p, plan), {
    C1: ['a@09:00', 'x@10:00', 'b@11:00', 'c@12:15'],
  });
  // Buffer was pushed down from 11:00-11:15 to 12:00-12:15
  assert.deepEqual(plan.blocks, [
    { court: 'C1', day: 0, start: '12:00', end: '12:15', label: 'Buffer' },
  ]);
  assertNoOverlap(p, plan);
});

test('dropping a match between two cards with a buffer deletes the buffer and inserts the match', () => {
  const p = [
    { id: 'a', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'b', court: 'C1', day: 0, start: H('10:15'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const blocks: BlockedPeriod[] = [
    { court: 'C1', day: 0, start: '10:00', end: '10:15', label: 'Buffer' },
  ];

  // Drop 'x' before 'b' (where buffer sits directly between 'a' and 'b')
  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'b' }, H('09:00'), blocks);

  // Buffer is deleted; x starts at 10:00; b shifts to 11:00
  assert.deepEqual(apply(p, plan), {
    C1: ['a@09:00', 'x@10:00', 'b@11:00'],
  });
  assert.deepEqual(plan.blocks, []);
  assertNoOverlap(p, plan);
});

test('dragging away a match that had a buffer immediately before it deletes that buffer and closes gap', () => {
  const p = [
    { id: 'a', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'b', court: 'C1', day: 0, start: H('10:15'), durationMinutes: 60 },
    { id: 'c', court: 'C1', day: 0, start: H('11:15'), durationMinutes: 60 },
    { id: 'y', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const blocks: BlockedPeriod[] = [
    { court: 'C1', day: 0, start: '10:00', end: '10:15', label: 'Buffer' },
  ];

  // Drag 'b' to C2
  const plan = planDrop(p, 'b', 'C2', 0, { beforeId: 'y' }, H('09:00'), blocks);

  // On C1: 'b' is gone, buffer before 'b' is deleted, 'c' pulls up by (60 + 15 = 75m) to 10:00
  assert.deepEqual(apply(p, plan), {
    C1: ['a@09:00', 'c@10:00'],
    C2: ['b@09:00', 'y@10:00'],
  });
  assert.deepEqual(plan.blocks, []);
  assertNoOverlap(p, plan);
});

test('non-buffer blocks like lunch or general blocked time stay stationary', () => {
  const p = [
    { id: 'a', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'b', court: 'C1', day: 0, start: H('10:30'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const blocks: BlockedPeriod[] = [
    { court: 'C1', day: 0, start: '10:00', end: '10:30', label: 'Ceremony' },
  ];

  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'b' }, H('09:00'), blocks);

  // Non-buffer block is not touched
  assert.deepEqual(plan.blocks, [
    { court: 'C1', day: 0, start: '10:00', end: '10:30', label: 'Ceremony' },
  ]);
});



// ── The break divides the queue ───────────────────────────────────────────

const LUNCH = { start: H('12:00'), end: H('13:00') };

test('lifting a morning match pulls the morning up and leaves the afternoon alone', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'm2', court: 'C1', day: 0, start: H('10:00'), durationMinutes: 60 },
    { id: 'm3', court: 'C1', day: 0, start: H('11:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'a2', court: 'C1', day: 0, start: H('14:00'), durationMinutes: 60 },
    { id: 'z', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'm1', 'C2', 0, { append: true }, H('09:00'), [], LUNCH);
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;

  // The morning closes up behind m1 …
  assert.equal(at('m2'), H('09:00'));
  assert.equal(at('m3'), H('10:00'));
  // … and the afternoon does not budge.
  assert.equal(at('a1'), undefined);
  assert.equal(at('a2'), undefined);
});

test('lifting an afternoon match pulls only the afternoon up', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'a2', court: 'C1', day: 0, start: H('14:00'), durationMinutes: 60 },
    { id: 'a3', court: 'C1', day: 0, start: H('15:00'), durationMinutes: 60 },
    { id: 'z', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'a1', 'C2', 0, { append: true }, H('09:00'), [], LUNCH);
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;

  assert.equal(at('m1'), undefined, 'the morning is not touched');
  assert.equal(at('a2'), H('13:00'));
  assert.equal(at('a3'), H('14:00'));
});

test('no break configured leaves the day one queue', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'z', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'm1', 'C2', 0, { append: true }, H('09:00'), [], null);
  assert.equal(plan.moves.find(m => m.id === 'a1')?.start, H('12:00'));
});

test('a match that has run into the break closes up with the morning', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('10:00'), durationMinutes: 60 },
    { id: 'm2', court: 'C1', day: 0, start: H('11:00'), durationMinutes: 60 },
    { id: 'inLunch', court: 'C1', day: 0, start: H('12:15'), durationMinutes: 30 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'z', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'm1', 'C2', 0, { append: true }, H('09:00'), [], LUNCH);
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;

  assert.equal(at('m2'), H('10:00'));
  assert.equal(at('inLunch'), H('11:15'), 'it followed the morning, so it moves with it');
  assert.equal(at('a1'), undefined, 'the afternoon still does not move');
});

test('inserting in the morning pushes the morning down and leaves the afternoon alone', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'm2', court: 'C1', day: 0, start: H('10:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'a2', court: 'C1', day: 0, start: H('14:00'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'm2' }, H('09:00'), [], LUNCH);
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;

  assert.equal(at('x'), H('10:00'), 'the arrival takes m2 slot');
  assert.equal(at('m2'), H('11:00'), 'and pushes the morning down');
  assert.equal(at('a1'), undefined, 'the afternoon is untouched');
  assert.equal(at('a2'), undefined);
});

test('inserting in the afternoon pushes only the afternoon down', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'a2', court: 'C1', day: 0, start: H('14:00'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'a2' }, H('09:00'), [], LUNCH);
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;

  assert.equal(at('x'), H('14:00'));
  assert.equal(at('a2'), H('15:00'));
  assert.equal(at('m1'), undefined, 'the morning is untouched');
});

test('a morning push may run into the break, but never past it onto the afternoon', () => {
  // The morning is full to 12:00; an hour arriving at 11:00 has to go
  // somewhere, and the break is where it spills.
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('10:00'), durationMinutes: 60 },
    { id: 'm2', court: 'C1', day: 0, start: H('11:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'm2' }, H('09:00'), [], LUNCH);
  const at = (id: string) => plan.moves.find(m => m.id === id)?.start;

  assert.equal(at('x'), H('11:00'));
  assert.equal(at('m2'), H('12:00'), 'pushed into the break, which the calendar shows');
  assert.equal(at('a1'), undefined, 'but the afternoon did not move');
});

test('with no break configured a push still runs the whole day', () => {
  const p = [
    { id: 'm1', court: 'C1', day: 0, start: H('09:00'), durationMinutes: 60 },
    { id: 'a1', court: 'C1', day: 0, start: H('13:00'), durationMinutes: 60 },
    { id: 'x', court: 'C2', day: 0, start: H('09:00'), durationMinutes: 60 },
  ];
  const plan = planDrop(p, 'x', 'C1', 0, { beforeId: 'a1' }, H('09:00'), [], null);
  assert.equal(plan.moves.find(m => m.id === 'a1')?.start, H('14:00'));
});
