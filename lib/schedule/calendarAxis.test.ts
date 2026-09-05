// Unit tests for the calendar view's time axis.
//
// Run with:  npm test
//
// The thing under test is that the axis is a property of the *configured day*,
// not of whichever matches happen to be on screen. An organizer reads free time
// off this grid, so an axis that re-anchors when they filter by division is
// reading them a different ruler each time they look.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  axisLabels,
  buildCalendarAxis,
  placeOnAxis,
  rowKind,
  rowStartMin,
  type AxisConfig,
  type AxisItem,
} from './calendarAxis.ts';

/** A 09:00–18:00 day on 45-minute blocks — the default config. */
const DAY: AxisConfig = { startTime: '09:00', endTime: '18:00', blockMinutes: 45 };

/** The same day with the default 12:00–13:00 lunch. An hour is not a whole
 *  number of 45-minute blocks, which is the case the re-phase exists for. */
const LUNCH_DAY: AxisConfig = { ...DAY, lunchStart: '12:00', lunchEnd: '13:00' };

const at = (time: string, durationMinutes = 45): AxisItem => {
  const [h, m] = time.split(':').map(Number);
  return { startMin: h * 60 + m, durationMinutes };
};

const HHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

describe('buildCalendarAxis', () => {
  it('starts the day at the configured start time, not at the first match', () => {
    const axis = buildCalendarAxis(DAY, [at('10:30'), at('11:15')]);
    assert.equal(HHMM(axis.startMin), '09:00');
  });

  it('runs to the configured end time', () => {
    const axis = buildCalendarAxis(DAY, [at('10:30'), at('11:15')]);
    assert.equal(HHMM(axis.endMin), '18:00');
  });

  it('holds still when the matches on screen change', () => {
    const all = [at('09:00'), at('10:30'), at('14:00'), at('16:30')];
    const filtered = [at('14:00')]; // as if one division were selected

    const full = buildCalendarAxis(DAY, all);
    const narrowed = buildCalendarAxis(DAY, filtered);

    assert.deepEqual(narrowed, full, 'filtering must not move the axis');
  });

  it('takes its pitch from match lengths, never from start times', () => {
    // One hand-edited match at 09:07. Under the old gcd-over-offsets rule this
    // collapsed the whole day to a 5-minute pitch.
    const axis = buildCalendarAxis(DAY, [at('09:00'), at('09:07'), at('11:15')]);
    assert.equal(axis.pitch, 45);
  });

  it('reuses the solver grid resolution for the pitch', () => {
    // gridResolution: the largest step dividing every declared length.
    assert.equal(buildCalendarAxis(DAY, [at('09:00', 20), at('10:00', 45)]).pitch, 5);
    assert.equal(buildCalendarAxis(DAY, [at('09:00', 45), at('10:00', 45)]).pitch, 45);
  });

  it('bounds the row count by the configured day over the pitch', () => {
    const axis = buildCalendarAxis(DAY, [at('09:00'), at('09:07'), at('16:30')]);
    assert.equal(axis.slots, 12, '09:00–18:00 on a 45-minute pitch is 12 rows');
  });

  it('stretches outward in whole rows to reach a match outside the day', () => {
    const axis = buildCalendarAxis(DAY, [at('08:30'), at('10:30')]);

    assert.ok(axis.startMin <= 8 * 60 + 30, 'the 08:30 match must be on the axis');
    assert.equal(
      (9 * 60 - axis.startMin) % axis.pitch,
      0,
      'the configured start must stay on a row boundary',
    );
  });

  it('stretches to reach a match running past the end of the day', () => {
    const axis = buildCalendarAxis(DAY, [at('17:30', 90)]);
    assert.ok(axis.endMin >= 19 * 60, 'a match ending at 19:00 must be on the axis');
  });
});

describe('placeOnAxis', () => {
  const axis = buildCalendarAxis(DAY, [at('09:00'), at('10:30')]);

  it('puts a match on the row its time belongs to', () => {
    const p = placeOnAxis(axis, 10 * 60 + 30, 45);
    assert.equal(p.startSlot, 2, '10:30 is the third 45-minute row after 09:00');
    assert.equal(p.spanSlots, 1);
    assert.equal(p.offsetMinutes, 0);
  });

  it('keeps an off-pitch hand edit at its true minute', () => {
    const p = placeOnAxis(axis, 9 * 60 + 7, 45);
    assert.equal(p.startSlot, 0, '09:07 sits inside the 09:00 row');
    assert.equal(p.offsetMinutes, 7, 'and seven minutes down it');
    assert.equal(p.spanSlots, 2, 'so it overhangs into the next row');
  });

  it('places the lunch band from the configured times alone', () => {
    const p = placeOnAxis(axis, 12 * 60, 60);
    assert.equal(p.startSlot, 4, '12:00 is four 45-minute rows after 09:00');
    assert.equal(p.offsetMinutes, 0);
  });
});

describe('axisLabels', () => {
  const axis = buildCalendarAxis(DAY, [at('09:00'), at('10:30')]);

  it('gives every row a time', () => {
    const labels = axisLabels(axis);
    assert.equal(labels.length, axis.slots);
    assert.deepEqual(
      labels.slice(0, 3).map(l => l.time),
      ['09:00', '09:45', '10:30'],
    );
  });

  it('marks the rows that land on the hour', () => {
    const labels = axisLabels(axis);
    assert.deepEqual(
      labels.filter(l => l.isHour).map(l => l.time),
      ['09:00', '12:00', '15:00'],
    );
  });
});


/* Re-phasing after lunch.
 *
 * The solver's day is two runs and the afternoon restarts at the configured
 * `lunchEnd`. Before this, the axis ruled one uniform ladder from `startTime`
 * and never noticed: on the default config every afternoon card sat fifteen
 * minutes below its own gridline, spanned two rows, and lined up with no label
 * — and the block tool, which reads a row's time back off the ladder, offered
 * the organizer court time at 12:45, inside the break. */
describe('a day with lunch in it', () => {
  const axis = buildCalendarAxis(LUNCH_DAY, [at('09:00'), at('13:00')]);
  const rows = axis.rows;

  it('lays the afternoon from lunchEnd, not from the morning ladder', () => {
    const afternoon = rows.filter(r => r.kind === 'play' && r.startMin >= 13 * 60);
    assert.deepEqual(
      afternoon.map(r => HHMM(r.startMin)),
      ['13:00', '13:45', '14:30', '15:15', '16:00', '16:45'],
      'the afternoon starts at the time the organizer typed',
    );
  });

  it('puts the afternoon back on its rows', () => {
    const p = placeOnAxis(axis, 13 * 60, 45);
    assert.equal(p.offsetMinutes, 0, 'a 13:00 match sits on a gridline, not 15 minutes below it');
    assert.equal(p.spanSlots, 1, 'and takes one row, not two');
  });

  it('never offers a row time inside the break', () => {
    // The block tool asks this of every row it mounts a cell on.
    const offered = rows.map((_, slot) => rowStartMin(axis, slot));
    const inside = offered.filter(m => m > 12 * 60 && m < 13 * 60);
    assert.deepEqual(inside, [], 'no row starts inside lunch');
  });

  it('gives lunch a row of its own, spanning exactly the configured window', () => {
    const lunch = rows.filter(r => r.kind === 'lunch');
    assert.equal(lunch.length, 1);
    assert.equal(HHMM(lunch[0].startMin), '12:00');
    assert.equal(lunch[0].minutes, 60);
    assert.equal(rowKind(axis, rows.indexOf(lunch[0])), 'lunch');
  });

  it('draws the minutes the lunch window costs at the end of the day', () => {
    // 13:00–18:00 is five hours; six 45-minute rows reach 17:30 and the last
    // half-hour is too short to start anything in. `01` chose to leave that
    // remainder honest rather than snap it; this is where it shows up.
    const last = rows[rows.length - 1];
    assert.equal(last.kind, 'idle');
    assert.equal(HHMM(last.startMin), '17:30');
    assert.equal(last.minutes, 30);
    assert.equal(HHMM(axis.endMin), '18:00', 'the axis still reaches the configured end');
  });

  it('draws the scrap before the break too', () => {
    const axis = buildCalendarAxis({ ...LUNCH_DAY, lunchStart: '12:15' }, [at('09:00')]);
    const scrap = axis.rows.find(r => r.kind === 'idle' && r.startMin === 12 * 60);
    assert.ok(scrap, '12:00–12:15 is inside the day but too short to play in');
    assert.equal(scrap.minutes, 15);
  });

  it('labels the afternoon with the times its rows actually start at', () => {
    const labels = axisLabels(axis);
    const afternoon = labels.filter(l => l.kind === 'play' && l.time >= '13:00').map(l => l.time);
    assert.deepEqual(afternoon.slice(0, 2), ['13:00', '13:45'], 'not 12:45 and 13:30');
  });

  it('keeps as many rows on the hour as the uniform ladder did', () => {
    // Three before (09:00, 12:00, 15:00) and three after — the re-phase moves
    // the hours, it does not thin them out, which is why `isHour` stays as the
    // axis's anchor rather than being replaced.
    const hours = axisLabels(axis).filter(l => l.isHour).map(l => l.time);
    assert.deepEqual(hours, ['09:00', '12:00', '13:00', '16:00']);
    assert.equal(
      axisLabels(buildCalendarAxis(DAY, [at('09:00')])).filter(l => l.isHour).length,
      3,
    );
  });

  it('still holds still when the matches on screen change', () => {
    const all = [at('09:00'), at('10:30'), at('14:00'), at('16:30')];
    const filtered = [at('14:00')]; // as if one division were selected
    assert.deepEqual(
      buildCalendarAxis(LUNCH_DAY, filtered),
      buildCalendarAxis(LUNCH_DAY, all),
      'splitting the day into runs must not make the axis filter-dependent',
    );
  });
});

/* The lunch row's height.
 *
 * An hour of announced emptiness costs about half a phone screen and says
 * nothing the banner does not, so the row collapses to a seam. It opens to
 * true scale only for someone who can actually put something in it — that is,
 * while the organizer is editing by hand. Reading a published schedule, the
 * break is a seam; dragging a card, it is the difference between a target and
 * a line. */
describe('the lunch row is a seam only while reading an empty break', () => {
  const editing = { ...LUNCH_DAY, editing: true };

  it('opens to true scale whenever the organizer is editing', () => {
    /* Editing places things against real time, so the hour has to be the
       size of an hour — even with nothing in it. Left as a seam, the cards
       either side of the break sat at a different vertical scale from the
       rest of the column. */
    const axis = buildCalendarAxis(editing, [at('09:00'), at('13:00')]);
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, false);
  });

  it('opens while reading too, once something is inside the break', () => {
    const axis = buildCalendarAxis(LUNCH_DAY, [at('09:00'), at('12:30')]);
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, false);
  });

  it('stays a seam while reading an empty break', () => {
    const axis = buildCalendarAxis(LUNCH_DAY, [at('09:00'), at('13:00')]);
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, true);
  });

  it('re-opens for a hand edit inside the break', () => {
    const axis = buildCalendarAxis(editing, [at('09:00'), at('12:30')]);
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, false);
  });

  it('re-opens for a match that merely overlaps the break', () => {
    const axis = buildCalendarAxis(editing, [at('11:30', 60)]); // 11:30–12:30
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, false);
  });

  it('is unmoved, while reading, by a match that only touches the break', () => {
    const axis = buildCalendarAxis(LUNCH_DAY, [at('11:15', 45)]); // ends exactly at 12:00
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, true);
  });

  it('re-opens for a blocked period overlapping the break, on any court or day', () => {
    const axis = buildCalendarAxis(
      { ...editing, blocks: [{ court: null, day: 2, start: '12:30', end: '13:30', label: 'Ceremony' }] },
      [at('09:00')],
    );
    assert.equal(axis.rows.find(r => r.kind === 'lunch')?.collapsed, false);
  });

  it('spans a card that crosses the break across the lunch row', () => {
    // Only reachable by hand — the solver refuses a span that crosses lunch.
    const axis = buildCalendarAxis(LUNCH_DAY, [at('11:30', 120)]); // 11:30–13:30
    const p = placeOnAxis(axis, 11 * 60 + 30, 120);
    const covered = axis.rows
      .slice(p.startSlot, p.startSlot + p.spanSlots)
      .reduce((sum, r) => sum + r.minutes, 0);
    assert.ok(covered >= p.offsetMinutes + 120, 'the span must reach the end of the card');
  });
});
