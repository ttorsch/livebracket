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
  /** [courtIndex][slotIndexWithinDay] — true when lunch blocks that court.
   *  Lunch is the same shape every day, so this has no day axis. */
  lunchBlocked: boolean[][];
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

  const slotsPerDay = Math.max(0, Math.floor((dayEnd - dayStart) / step));

  const slots: Slot[] = [];
  for (let day = 0; day < dayCount; day++) {
    for (let index = 0; index < slotsPerDay; index++) {
      const startMin = dayStart + index * step;
      slots.push({ day, index, startMin, abs: day * DAY_SPAN + startMin });
    }
  }

  const lunchBlocked = buildLunch(config, courts.length, slotsPerDay, dayStart, step, block);
  const blocked = buildBlocks(config, courts, dayCount, slotsPerDay, dayStart, step);

  let blockedSlots = 0;
  for (const court of lunchBlocked) for (const b of court) if (b) blockedSlots++;
  const totalSlots = slotsPerDay * courts.length;
  const courtMinutesPerDay = (totalSlots - blockedSlots) * step;

  return {
    slots,
    slotsPerDay,
    days: dayCount,
    blockMinutes: block,
    slotMinutes: step,
    courts,
    dayStart,
    dayEnd,
    lunchBlocked,
    blocked,
    playableMinutesPerCourt: courts.length > 0 ? courtMinutesPerDay / courts.length : 0,
    courtMinutesPerDay,
  };
}

/** Which slots lunch takes off each court.
 *
 *  Unstaggered, every court stops for the whole lunch window and the venue
 *  loses that hour entirely. Staggered, each court gives up only as many slots
 *  as lunch actually needs and neighbouring courts take them at different
 *  times, so play never fully stops and the grid keeps most of its capacity.
 *  Courts alternate: even-numbered courts break at the top of the window, odd
 *  ones a block later. */
function buildLunch(
  config: ScheduleConfig,
  courtCount: number,
  slotsPerDay: number,
  dayStart: number,
  step: number,
  block: number,
): boolean[][] {
  const blocked: boolean[][] = Array.from({ length: courtCount }, () =>
    Array.from({ length: slotsPerDay }, () => false),
  );

  const lunchStart = parseHHMM(config.lunchStart);
  const lunchEnd = parseHHMM(config.lunchEnd);
  if (!(lunchEnd > lunchStart) || slotsPerDay === 0) return blocked;

  const dayEnd = dayStart + slotsPerDay * step;
  /** Mark every fine slot overlapping [from, to). */
  const block_ = (court: number, from: number, to: number) => {
    for (let i = 0; i < slotsPerDay; i++) {
      const s = dayStart + i * step;
      if (s < to && s + step > from) blocked[court][i] = true;
    }
  };

  if (!config.staggerLunch) {
    for (let c = 0; c < courtCount; c++) block_(c, lunchStart, lunchEnd);
    return blocked;
  }

  // The break each court takes is reasoned about in *minutes*, on the nominal
  // block rather than the grid's resolution: a break is one match long, and
  // making the grid finer must not silently make lunch shorter or the stagger
  // narrower. The fine slots are only how that interval gets recorded.
  const window = lunchEnd - lunchStart;
  const breakLength = Math.min(window, block);
  // Courts are dealt into groups that break at different times. More groups
  // means more of the venue playing at any moment; with one court, or a window
  // too narrow to divide, this collapses to everyone breaking together, which
  // is the honest answer rather than a fake stagger.
  const groups = Math.max(1, Math.min(Math.ceil(window / breakLength) + 1, courtCount));

  for (let c = 0; c < courtCount; c++) {
    const from = lunchStart + (c % groups) * breakLength;
    // A late shift may spill past the nominal window — that is the point of
    // staggering — but never past the end of the day.
    block_(c, Math.min(from, dayEnd), Math.min(from + breakLength, dayEnd));
  }
  return blocked;
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
  slotsPerDay: number,
  dayStart: number,
  step: number,
): boolean[][][] {
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
          const s = dayStart + i * step;
          if (s < to && s + step > from) blocked[day][c][i] = true;
        }
      }
    }
  }
  return blocked;
}

/** Can this court host a match starting at this slot and running `slotSpan`
 *  blocks? Checks the day boundary and lunch, not existing bookings. */
export function courtOpen(grid: Grid, courtIndex: number, slot: Slot, slotSpan: number): boolean {
  if (slot.index + slotSpan > grid.slotsPerDay) return false;
  const lunch = grid.lunchBlocked[courtIndex];
  if (!lunch) return false;
  const manual = grid.blocked[slot.day]?.[courtIndex];
  for (let k = 0; k < slotSpan; k++) {
    if (lunch[slot.index + k]) return false;
    if (manual?.[slot.index + k]) return false;
  }
  return true;
}

/** How many whole blocks a match of `minutes` consumes, including any net
 *  change buffer charged in front of it. */
export function slotSpan(minutes: number, block: number): number {
  return Math.max(1, Math.ceil(minutes / Math.max(1, block)));
}
