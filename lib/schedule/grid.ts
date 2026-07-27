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
  blockMinutes: number;
  courts: CourtSpec[];
  dayStart: number;
  dayEnd: number;
  /** [courtIndex][slotIndexWithinDay] — true when lunch blocks that court. */
  lunchBlocked: boolean[][];
  /** Average playable minutes per court per day, lunch removed. */
  playableMinutesPerCourt: number;
  /** Total court-minutes available on one day across the whole roster. */
  courtMinutesPerDay: number;
}

export function buildGrid(config: ScheduleConfig, days: number): Grid {
  const courts = courtRoster(config);
  const block = Math.max(1, Math.trunc(config.blockMinutes) || 1);
  const dayStart = parseHHMM(config.startTime);
  const dayEnd = parseHHMM(config.endTime);
  const dayCount = Math.max(1, Math.trunc(days) || 1);

  const slotsPerDay = Math.max(0, Math.floor((dayEnd - dayStart) / block));

  const slots: Slot[] = [];
  for (let day = 0; day < dayCount; day++) {
    for (let index = 0; index < slotsPerDay; index++) {
      const startMin = dayStart + index * block;
      slots.push({ day, index, startMin, abs: day * DAY_SPAN + startMin });
    }
  }

  const lunchBlocked = buildLunch(config, courts.length, slotsPerDay, dayStart, block);

  let blockedSlots = 0;
  for (const court of lunchBlocked) for (const b of court) if (b) blockedSlots++;
  const totalSlots = slotsPerDay * courts.length;
  const courtMinutesPerDay = (totalSlots - blockedSlots) * block;

  return {
    slots,
    slotsPerDay,
    days: dayCount,
    blockMinutes: block,
    courts,
    dayStart,
    dayEnd,
    lunchBlocked,
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
  block: number,
): boolean[][] {
  const blocked: boolean[][] = Array.from({ length: courtCount }, () =>
    Array.from({ length: slotsPerDay }, () => false),
  );

  const lunchStart = parseHHMM(config.lunchStart);
  const lunchEnd = parseHHMM(config.lunchEnd);
  if (!(lunchEnd > lunchStart) || slotsPerDay === 0) return blocked;

  // Slots that overlap the lunch window at all.
  const overlapping: number[] = [];
  for (let i = 0; i < slotsPerDay; i++) {
    const s = dayStart + i * block;
    if (s < lunchEnd && s + block > lunchStart) overlapping.push(i);
  }
  if (overlapping.length === 0) return blocked;

  if (!config.staggerLunch) {
    for (let c = 0; c < courtCount; c++) for (const i of overlapping) blocked[c][i] = true;
    return blocked;
  }

  const first = overlapping[0];
  // Staggering needs at least two blocks to play with. A lunch window only one
  // block wide is widened by one so courts can still take turns — the break
  // spilling a few minutes past the nominal window is the entire point.
  let last = overlapping[overlapping.length - 1];
  if (courtCount > 1 && last === first) last = Math.min(slotsPerDay - 1, last + 1);

  const band = last - first + 1;
  // Courts are dealt into groups that break at different times. More groups
  // means more of the venue playing at any moment and a shorter break each;
  // with one court, or a band too narrow to divide, this collapses to everyone
  // breaking together, which is the honest answer rather than a fake stagger.
  const groups = Math.max(1, Math.min(band, courtCount));
  const perCourt = Math.max(1, band - groups + 1);

  for (let c = 0; c < courtCount; c++) {
    const offset = c % groups;
    for (let k = 0; k < perCourt; k++) {
      const i = first + offset + k;
      if (i >= 0 && i < slotsPerDay) blocked[c][i] = true;
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
  for (let k = 0; k < slotSpan; k++) if (lunch[slot.index + k]) return false;
  return true;
}

/** How many whole blocks a match of `minutes` consumes, including any net
 *  change buffer charged in front of it. */
export function slotSpan(minutes: number, block: number): number {
  return Math.max(1, Math.ceil(minutes / Math.max(1, block)));
}
