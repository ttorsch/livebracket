// Unit tests for what counts as a placed match.
//
// Run with:  npm test
//
// The point of the module is that the calendar grid, the validator and the
// save path answer one question the same way. The tests that matter here are
// therefore the ones about a *negative* day: it is a real day the event does
// not cover, not a marker for "no placement", and reading it as the latter is
// what made the grid draw a section nothing validated and saving delete it.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { hasPlacement, isOffEventDay } from './placedMatch.ts';
import { validateSchedule, type EditedPlacement } from './validate.ts';
import { buildGraph } from './graph.ts';
import { buildGrid } from './grid.ts';
import { normaliseConfig, type SchedulableDivision } from './types.ts';

describe('hasPlacement', () => {
  it('accepts a match with a court, a date and a time', () => {
    assert.equal(hasPlacement({ date: '2026-09-03', time: '09:00' }), true);
  });

  it('accepts a match on a date the event does not cover', () => {
    // The whole point. This row has a real placement; the event simply moved.
    assert.equal(hasPlacement({ date: '2026-09-02', time: '09:00' }), true);
  });

  it('rejects a row with no date, however complete it otherwise looks', () => {
    assert.equal(hasPlacement({ date: '', time: '09:00' }), false);
  });

  it('rejects the unscheduled tray and the overflow placeholder', () => {
    assert.equal(hasPlacement({ unscheduled: true, date: '2026-09-03', time: '09:00' }), false);
    assert.equal(hasPlacement({ unscheduled: true, date: '', time: '—' }), false);
  });

  it('rejects a placeholder time rather than treating it as midnight', () => {
    assert.equal(hasPlacement({ date: '2026-09-03', time: '—' }), false);
    assert.equal(hasPlacement({ date: '2026-09-03', time: '' }), false);
    assert.equal(hasPlacement({ date: '2026-09-03', time: '9:00' }), false);
    assert.equal(hasPlacement({ date: '2026-09-03', time: '24:00' }), false);
  });
});

describe('isOffEventDay', () => {
  it('is true before the event and after it, false inside', () => {
    assert.equal(isOffEventDay(-1, 2), true);
    assert.equal(isOffEventDay(0, 2), false);
    assert.equal(isOffEventDay(1, 2), false);
    assert.equal(isOffEventDay(2, 2), true);
  });
});

// ── The reason any of this matters ────────────────────────────────────────
//
// `validateSchedule` was never the broken half: it is day-agnostic, and always
// was. The page filtered its input on `day >= 0` and handed it nothing. These
// tests pin the validator's behaviour on a negative day so that the fix cannot
// be undone by a later change to the solver's arithmetic either.

const DIVISIONS: SchedulableDivision[] = [
  {
    id: 'd1',
    label: 'Mixed Open',
    pools: 1,
    matches: [
      { id: 'm1', teamA: 't1', teamB: 't2', isPool: true, pool: 'A', durationMinutes: 30 },
      { id: 'm2', teamA: 't1', teamB: 't3', isPool: true, pool: 'A', durationMinutes: 30 },
    ],
  },
];

function setup() {
  const config = normaliseConfig({ startTime: '09:00', endTime: '17:00', blockMinutes: 30, courtCount: 2 });
  const graph = buildGraph(DIVISIONS, config.blockMinutes);
  const grid = buildGrid(config, 2, [30, 30]);
  return { graph, grid };
}

describe('validateSchedule on a day outside the event', () => {
  it('reports a court clash on day -1 exactly as it would on day 0', () => {
    const { graph, grid } = setup();
    const clash = (day: number): EditedPlacement[] => [
      { matchId: 'm1', court: 'Court 1', day, startMin: 9 * 60, durationMinutes: 30 },
      { matchId: 'm2', court: 'Court 1', day, startMin: 9 * 60 + 15, durationMinutes: 30 },
    ];
    const onEvent = validateSchedule(clash(0), graph, grid).filter(p => p.kind === 'courtClash');
    const offEvent = validateSchedule(clash(-1), graph, grid).filter(p => p.kind === 'courtClash');
    assert.equal(onEvent.length, 1);
    assert.deepEqual(
      offEvent.map(p => [p.matchId, p.kind, p.otherMatchId]),
      onEvent.map(p => [p.matchId, p.kind, p.otherMatchId]),
    );
  });

  it('reports a team clash across a day boundary the event does not cover', () => {
    const { graph, grid } = setup();
    // Same team, two courts, same instant, on the day before the event.
    const problems = validateSchedule(
      [
        { matchId: 'm1', court: 'Court 1', day: -1, startMin: 10 * 60, durationMinutes: 30 },
        { matchId: 'm2', court: 'Court 2', day: -1, startMin: 10 * 60, durationMinutes: 30 },
      ],
      graph,
      grid,
    );
    assert.equal(problems.filter(p => p.kind === 'teamClash').length, 1);
  });

  it('orders a negative day before day 0 rather than after everything', () => {
    const { graph, grid } = setup();
    // m1 on the day before, m2 on the first day: no clash, and in particular
    // the pair must not read as overlapping because of a sign error.
    const problems = validateSchedule(
      [
        { matchId: 'm1', court: 'Court 1', day: -1, startMin: 16 * 60, durationMinutes: 30 },
        { matchId: 'm2', court: 'Court 1', day: 0, startMin: 9 * 60, durationMinutes: 30 },
      ],
      graph,
      grid,
    );
    assert.deepEqual(problems.filter(p => p.kind === 'courtClash'), []);
  });

  it('still judges outsideDay by the clock, not by the calendar', () => {
    const { graph, grid } = setup();
    // 10:00 is inside the playing hours, so a match there raises no
    // `outsideDay` however far from the event its date is. "Outside the
    // event" is said once about the day section, not per card.
    const inHours = validateSchedule(
      [{ matchId: 'm1', court: 'Court 1', day: -1, startMin: 10 * 60, durationMinutes: 30 }],
      graph,
      grid,
    );
    assert.deepEqual(inHours.filter(p => p.kind === 'outsideDay'), []);

    // 07:00 is before the day starts, and that is a fault on any date.
    const outOfHours = validateSchedule(
      [{ matchId: 'm1', court: 'Court 1', day: -1, startMin: 7 * 60, durationMinutes: 30 }],
      graph,
      grid,
    );
    assert.equal(outOfHours.filter(p => p.kind === 'outsideDay').length, 1);
  });
});
