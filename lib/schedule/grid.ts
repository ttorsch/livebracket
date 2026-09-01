// The time grid: courts × slots, per day.
//
// Time is discrete here. A day is chopped into fixed blocks starting at the
// day's opening time, and every match starts on a block boundary. That is a
// deliberate constraint, not a simplification — it is what makes the published
// schedule readable ("10:30 on every court") and what turns placement into a
// small assignment problem per slot rather than a continuous packing problem.
//
// Matches longer than one block simply occupy several consecutive blocks, so a
// mixed event with 30-minute pool matches and 90-minute finals still works.
//
// Absolute time is `day * 1440 + minuteOfDay` throughout, so comparing two
// instants across days is just comparing two numbers.

import type { CourtSpec, ScheduleConfig } from './types.ts';
import { courtRoster, parseHHMM } from './types.ts';

export const DAY_SPAN = 1440;

export interface Slot {
  day: number;
  /** Index within the day, 0-based. */
  index: number;
  /** Minute of day this slot starts at. */
  startMin: number;
  /** day * DAY_SPAN + startMin. */
  abs: number;
}

export interface Grid {
  slots: Slot[];            // every slot of the event, in time order
  slotsPerDay: number;
  days: number;
  /** The nominal match length. It is the *unit of judgement*, not of time:
   *  rest targets are counted in these, and the cost function scales its terms
   *  by it. It is deliberately not the grid's resolution. */
  blockMinutes: number;
  /** The grid's actual resolution — the largest step that divides every match
   *  length in the event, so a 20-minute match takes twenty minutes and the
   *  next one can start at 09:20 rather than 09:45. */
  slotMinutes: number;
  courts: CourtSpec[];
  dayStart: number;
  dayEnd: number;
  /** When ordinal `i` of a day begins, in minutes. Lunch is the same shape
   *  every day, so this has no day axis.
   *
   *  Slots are *not* a uniform lattice from `dayStart`: lunch splits the day
   *  into runs and each run lays its slots from its own start, so nothing
   *  reconstructs a start time by multiplying an index. Two ordinals are
   *  adjacent in time only when their starts differ by exactly `slotMinutes`,
   *  which is what `courtOpen` checks before letting a match span them. */
  slotStarts: number[];
  /** The venue-wide stop, in minutes, or null when the config declares none.
   *  No slot exists inside it — lunch is absent from the grid rather than
   *  blocked on it — so this is here for the callers that must judge a time
   *  the grid never offered, i.e. a hand-placed match. */
  lunch: { start: number; end: number } | null;
  /** [day][courtIndex][slotIndexWithinDay] — true when the organizer has taken
   *  that court time off the board. Unlike lunch these are placed by hand and
   *  can differ from day to day, hence the extra axis. */
  blocked: boolean[][][];
  /** Average playable minutes per court per day, lunch removed. */
  playableMinutesPerCourt: number;
  /** Total court-minutes available on one day across the whole roster. */
  courtMinutesPerDay: number;
}

/** Smallest step that divides every length the event actually uses.
 *
 *  Without this the grid runs at the nominal block, and a 20-minute pool match
 *  books a 45-minute slot: the second match of the day starts at 09:45 having
 *  wasted twenty-five minutes of court time that nobody asked to lose. Taking
 *  the greatest common divisor instead means every declared length lands
 *  exactly on the grid — 20 and 45 give a 5-minute step, and a schedule of only
 *  45-minute matches is unchanged, because then the divisor *is* 45.
 *
 *  Floored at 5 minutes: a stray one-minute length would otherwise give the
 *  event a 1-minute grid and multiply the work by sixty for no benefit. */
export function gridResolution(minutes: number[], block: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const clean = minutes
    .concat(block)
    .map(m => Math.max(0, Math.trunc(m) || 0))
    .filter(m => m > 0);
  if (clean.length === 0) return Math.max(1, block);
  const step = clean.reduce(gcd);
  return Math.max(5, Math.min(step, Math.max(1, block)));
}

export function buildGrid(config: ScheduleConfig, days: number, matchMinutes: number[] = []): Grid {
  const courts = courtRoster(config);
  const block = Math.max(1, Math.trunc(config.blockMinutes) || 1);
  // Only the match lengths. A net-change buffer sits *inside* a match's booking
  // rather than starting on its own boundary, so folding it in here would make
  // the grid finer than anything needs — an all-45 event would end up on a
  // 15-minute grid for no gain.
  const step = gridResolution(matchMinutes, block);
  const dayStart = parseHHMM(config.startTime);
  const dayEnd = parseHHMM(config.endTime);
  const dayCount = Math.max(1, Math.trunc(days) || 1);

  const lunch = lunchWindow(config.lunchStart, config.lunchEnd, dayStart, dayEnd);
  const slotStarts = buildSlotStarts(dayStart, dayEnd, step, lunch);
  const slotsPerDay = slotStarts.length;

  const slots: Slot[] = [];
  for (let day = 0; day < dayCount; day++) {
    for (let index = 0; index < slotsPerDay; index++) {
      const startMin = slotStarts[index];
      slots.push({ day, index, startMin, abs: day * DAY_SPAN + startMin });
    }
  }

  const blocked = buildBlocks(config, courts, dayCount, slotStarts, step);

  const courtMinutesPerDay = slotsPerDay * step * courts.length;

  return {
    slots,
    slotsPerDay,
    days: dayCount,
    blockMinutes: block,
    slotMinutes: step,
    courts,
    dayStart,
    dayEnd,
    slotStarts,
    lunch,
    blocked,
    playableMinutesPerCourt: courts.length > 0 ? courtMinutesPerDay / courts.length : 0,
    courtMinutesPerDay,
  };
}

/** The venue-wide stop, clipped to the playing day.
 *
 *  Lunch means nobody plays: it is one window the whole venue observes, not a
 *  rolling per-court break. A window that does not parse, ends before it
 *  starts, or falls entirely outside the day is no lunch at all.
 *
 *  Takes the two times rather than the whole config because the calendar's time
 *  axis asks this too, and it holds a display-sized slice of the config rather
 *  than a `ScheduleConfig`. Same question, same answer, one implementation —
 *  see `dayRuns`. */
export function lunchWindow(
  lunchStart: string,
  lunchEnd: string,
  dayStart: number,
  dayEnd: number,
): { start: number; end: number } | null {
  const start = Math.max(dayStart, parseHHMM(lunchStart));
  const end = Math.min(dayEnd, parseHHMM(lunchEnd));
  return end > start ? { start, end } : null;
}

/** The stretches of the day that play happens in.
 *
 *  Lunch cuts the day in two; everything downstream — the solver's slots and
 *  the calendar's rows alike — is laid run by run, each from its own start.
 *  This is the one place that shape is decided.
 *
 *  Exported because the display used to re-derive the day by a *different*
 *  rule: it ruled one uniform ladder from `startTime` and never noticed lunch,
 *  so on a 45-minute grid with an hour's lunch the whole afternoon sat fifteen
 *  minutes below its own gridlines and the block tool offered court time inside
 *  the break. Two descriptions of one day is the bug; this is the description. */
export function dayRuns(
  dayStart: number,
  dayEnd: number,
  lunch: { start: number; end: number } | null,
): [number, number][] {
  return lunch ? [[dayStart, lunch.start], [lunch.end, dayEnd]] : [[dayStart, dayEnd]];
}

/** When each ordinal of a day begins.
 *
 *  Lunch splits the day into *runs*, and each run lays its slots from its own
 *  start rather than from a lattice anchored at `dayStart`. That is the whole
 *  point: on a 45-minute grid a 12:00–13:00 lunch is not a whole number of
 *  blocks, so a lattice can only resume at 13:30 and the organizer who typed
 *  13:00 loses a half-hour they never agreed to give up. Restarting the run at
 *  `lunchEnd` makes the configured times literally true.
 *
 *  The cost lands at the end of the day instead — the last slot may finish
 *  short of `endTime` — which is where slack belongs: an over-running match
 *  eats into the evening, not into the afternoon's first round.
 *
 *  A run only offers a slot that finishes inside it, so nothing can be started
 *  that would run into lunch. The minutes left over at the tail of a run are
 *  idle by construction, and shorter than one slot. */
function buildSlotStarts(
  dayStart: number,
  dayEnd: number,
  step: number,
  lunch: { start: number; end: number } | null,
): number[] {
  const starts: number[] = [];
  for (const [from, to] of dayRuns(dayStart, dayEnd, lunch)) {
    const count = Math.max(0, Math.floor((to - from) / step));
    for (let i = 0; i < count; i++) starts.push(from + i * step);
  }
  return starts;
}

/** Court time the organizer has taken off the board by hand.
 *
 *  Lunch is a rule the config describes once and every day obeys; a block is a
 *  specific thing happening on a specific court at a specific time, so it is
 *  marked per day. A null court or day means "all of them", which is how a
 *  venue-wide ceremony is expressed. */
function buildBlocks(
  config: ScheduleConfig,
  courts: CourtSpec[],
  days: number,
  slotStarts: number[],
  step: number,
): boolean[][][] {
  const slotsPerDay = slotStarts.length;
  const blocked: boolean[][][] = Array.from({ length: days }, () =>
    Array.from({ length: courts.length }, () => Array.from({ length: slotsPerDay }, () => false)),
  );
  for (const period of config.blocks ?? []) {
    const from = parseHHMM(period.start);
    const to = parseHHMM(period.end);
    if (!(to > from)) continue;
    for (let day = 0; day < days; day++) {
      if (period.day != null && period.day !== day) continue;
      for (let c = 0; c < courts.length; c++) {
        if (period.court != null && period.court !== courts[c].name) continue;
        for (let i = 0; i < slotsPerDay; i++) {
          const s = slotStarts[i];
          if (s < to && s + step > from) blocked[day][c][i] = true;
        }
      }
    }
  }
  return blocked;
}

/** Can this court host a match starting at this slot and running `slotSpan`
 *  blocks? Checks the day boundary, lunch and blocked time, not bookings.
 *
 *  Lunch is enforced here as *contiguity* rather than as a blocked slot: the
 *  slots either side of the break are adjacent ordinals but an hour apart in
 *  time, so a span that crosses them would book a match that pauses for lunch
 *  and resumes. Consecutive ordinals are only usable together when their start
 *  times differ by exactly one slot. */
export function courtOpen(grid: Grid, courtIndex: number, slot: Slot, slotSpan: number): boolean {
  if (slot.index + slotSpan > grid.slotsPerDay) return false;
  if (courtIndex < 0 || courtIndex >= grid.courts.length) return false;
  const manual = grid.blocked[slot.day]?.[courtIndex];
  for (let k = 0; k < slotSpan; k++) {
    if (manual?.[slot.index + k]) return false;
    if (k > 0 && grid.slotStarts[slot.index + k] !== grid.slotStarts[slot.index + k - 1] + grid.slotMinutes) {
      return false;
    }
  }
  return true;
}

/** How many whole blocks a match of `minutes` consumes, including any net
 *  change buffer charged in front of it. */
export function slotSpan(minutes: number, block: number): number {
  return Math.max(1, Math.ceil(minutes / Math.max(1, block)));
}
