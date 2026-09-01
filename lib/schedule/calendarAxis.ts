/* The calendar view's time axis.
 *
 * The grid draws courts across and time down. This module decides the *down*:
 * where the day starts, which rows exist, what each one spans, and which row a
 * given minute lands on.
 *
 * Two rules make it worth its own module.
 *
 * **The axis is a property of the configured day, not of the matches on
 * screen.** The view has filters — by division, by day, by status — and an axis
 * derived from the visible matches re-anchors every time one is used, so the
 * organizer is handed a different ruler each time they look. Worse, spotting
 * free court time is a stated purpose of this view, and an axis that starts at
 * the first match can never show the morning nobody is playing in. So the frame
 * comes from `startTime`/`endTime`, and the matches only ever get to *stretch*
 * it, and only outward.
 *
 * **The rows are the day the solver actually plays.** Lunch stops play and the
 * afternoon restarts at the configured `lunchEnd`, so the day is two runs, not
 * one ladder. This module used to rule one uniform ladder from `startTime` and
 * never notice: on a 45-minute grid with an hour's lunch, every afternoon card
 * sat fifteen minutes below its own gridline, and the block tool — which reads
 * a row's time back off `startMin + slot * pitch` — offered court time at 12:45,
 * inside the break. Rows now come from `dayRuns`, the same function the solver
 * lays its slots from, so there is one description of the day instead of two.
 *
 * The cost is that a row is no longer always a pitch tall: lunch is its own
 * row, and each run leaves a scrap shorter than a pitch at its tail. Callers
 * must ask `rowStartMin` rather than multiply.
 */

import { dayRuns, gridResolution, lunchWindow } from './grid.ts';
import { DEFAULT_MATCH_MINUTES, parseHHMM, toHHMM, type BlockedPeriod } from './types.ts';

/** The slice of `ScheduleConfig` the axis reads. */
export interface AxisConfig {
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  blockMinutes: number;
  lunchStart?: string; // "HH:MM"
  lunchEnd?: string;   // "HH:MM"
  /** Only ever read to decide whether the lunch row is occupied — see
   *  `collapsed`. Which court and which day a block falls on is the view's
   *  business, not the axis's. */
  blocks?: BlockedPeriod[];
}

/** A placed match, as the axis needs to see it. */
export interface AxisItem {
  /** Minutes since midnight. */
  startMin: number;
  durationMinutes: number;
}

/** What a row is for.
 *
 *  `play` — a pitch of the playing day, the ordinary case.
 *  `lunch` — the venue-wide stop, exactly the configured window.
 *  `idle`  — a scrap shorter than a pitch at the tail of a run: real minutes
 *            of the configured day that no match can start in. Drawn rather
 *            than hidden, because it is where the day's unused time actually
 *            goes and an organizer choosing a lunch window deserves to see it.
 */
export type AxisRowKind = 'play' | 'lunch' | 'idle';

export interface AxisRow {
  /** Minute of day this row begins. */
  startMin: number;
  /** How many minutes the row covers. Only `play` rows are a pitch. */
  minutes: number;
  kind: AxisRowKind;
  /** Drawn at a fixed height rather than at its true minutes.
   *
   *  Only ever the lunch row, and only while nothing is inside it. An hour of
   *  announced emptiness costs about half a phone screen and tells the
   *  organizer nothing they did not already read on the banner. But an
   *  organizer may type any time they like, and a blocked period may overlap
   *  the break, so the row re-opens to true scale the moment anything is
   *  actually in it — the same "matches may stretch the axis, never move it"
   *  rule the day's edges already follow, turned inward. */
  collapsed: boolean;
}

export interface CalendarAxis {
  /** Every row, in time order. */
  rows: AxisRow[];
  /** Height of a `play` row, in minutes. */
  pitch: number;
  /** Minute of day the first row starts at. */
  startMin: number;
  /** Minute of day the last row ends at. */
  endMin: number;
  /** Row count — `rows.length`. */
  slots: number;
}

/** Where something sits on the axis. `startSlot` is the row it begins in and
 *  `offsetMinutes` how far down that row — see `placeOnAxis`. */
export interface AxisPlacement {
  startSlot: number;
  spanSlots: number;
  offsetMinutes: number;
}

export interface AxisLabel {
  slot: number;
  isHour: boolean;
  time: string;
  kind: AxisRowKind;
}

/** Fallbacks for a config that has not loaded yet: a 09:00–18:00 day. */
const FALLBACK_START = 9 * 60;
const FALLBACK_END = 18 * 60;

const durationOf = (i: AxisItem) => Math.max(5, Math.trunc(i.durationMinutes) || DEFAULT_MATCH_MINUTES);

const readTime = (v: string, fallback: number): number =>
  /^\d{1,2}:\d{2}$/.test(v ?? '') ? parseHHMM(v) : fallback;

const overlaps = (aFrom: number, aTo: number, bFrom: number, bTo: number) => aFrom < bTo && bFrom < aTo;

/**
 * Build the axis for a calendar.
 *
 * @param config The configured day. This is the anchor: `startTime` is row 0
 *               unless a match forces the axis open earlier.
 * @param items  **Every** match the calendar knows about, not the filtered
 *               subset. Passing the filtered set is the bug this module
 *               exists to prevent: the axis would move as filters change.
 */
export function buildCalendarAxis(config: AxisConfig, items: AxisItem[]): CalendarAxis {
  const block = Math.max(5, Math.trunc(config.blockMinutes) || DEFAULT_MATCH_MINUTES);

  /* The pitch is the solver's grid resolution — the largest step that divides
     every declared match length — and deliberately nothing else. The old view
     folded each match's *offset from the first match* into the same gcd, so a
     single hand edit at 09:07 dropped the whole day to a 5-minute pitch and a
     nine-hour day became 108 rows. An offset is where a match happens to be;
     it says nothing about how finely the day should be ruled. */
  const pitch = gridResolution(items.map(durationOf), block);

  const dayStart = readTime(config.startTime, FALLBACK_START);
  const dayEndRaw = readTime(config.endTime, FALLBACK_END);
  const dayEnd = dayEndRaw > dayStart ? dayEndRaw : dayStart + pitch;

  const lunch = lunchWindow(config.lunchStart ?? '', config.lunchEnd ?? '', dayStart, dayEnd);

  /* Matches outside the configured day still have to be visible — a hand edit
     can put one anywhere, and a schedule saved before the organizer moved the
     event's times can sit wholly outside it. The axis opens outward to reach
     them, but only in whole pitches, so `startTime` stays exactly on a row
     boundary and the morning keeps its phase. */
  let firstMin = dayStart;
  let lastMin = dayEnd;
  for (const i of items) {
    const s = i.startMin;
    const e = i.startMin + durationOf(i);
    if (s < firstMin) firstMin = dayStart - Math.ceil((dayStart - s) / pitch) * pitch;
    if (e > lastMin) lastMin = dayEnd + Math.ceil((e - dayEnd) / pitch) * pitch;
  }

  const rows: AxisRow[] = [];
  const play = (startMin: number): AxisRow => ({ startMin, minutes: pitch, kind: 'play', collapsed: false });

  for (let t = firstMin; t < dayStart; t += pitch) rows.push(play(t));

  const runs = dayRuns(dayStart, dayEnd, lunch);
  runs.forEach(([from, to], runIndex) => {
    if (runIndex > 0 && lunch) {
      rows.push({
        startMin: lunch.start,
        minutes: lunch.end - lunch.start,
        kind: 'lunch',
        collapsed: !occupies(lunch, items, config.blocks ?? []),
      });
    }
    /* Each run lays its rows from its own start — that is the whole point, and
       it is why the afternoon's first row reads 13:00 rather than 12:45. */
    const count = Math.max(0, Math.floor((to - from) / pitch));
    for (let i = 0; i < count; i += 1) rows.push(play(from + i * pitch));

    /* What is left at the tail of the run: real minutes of the configured day
       that are too short to start anything in. The solver drops them; the axis
       draws them, so `endTime` still bounds the picture and the organizer can
       see the half-hour their lunch window costs them. */
    const tailFrom = from + count * pitch;
    if (to > tailFrom) rows.push({ startMin: tailFrom, minutes: to - tailFrom, kind: 'idle', collapsed: false });
  });

  for (let t = dayEnd; t < lastMin; t += pitch) rows.push(play(t));

  if (rows.length === 0) rows.push(play(dayStart));

  const last = rows[rows.length - 1];
  return {
    rows,
    pitch,
    startMin: rows[0].startMin,
    endMin: last.startMin + last.minutes,
    slots: rows.length,
  };
}

/** Whether anything at all sits inside the lunch window.
 *
 *  Nothing the solver produces ever can — `courtOpen` refuses a span that
 *  crosses the break — so this is asking about the two things placed by hand:
 *  a hand-edited match, and a blocked period the organizer took off the board.
 *  Any court, any day: the axis is one ruler for the whole event, so a single
 *  ceremony overlapping lunch on day two re-opens the row everywhere. */
function occupies(
  lunch: { start: number; end: number },
  items: AxisItem[],
  blocks: BlockedPeriod[],
): boolean {
  for (const i of items) {
    if (overlaps(i.startMin, i.startMin + durationOf(i), lunch.start, lunch.end)) return true;
  }
  for (const b of blocks) {
    const from = readTime(b.start, Number.NaN);
    const to = readTime(b.end, Number.NaN);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue;
    if (overlaps(from, to, lunch.start, lunch.end)) return true;
  }
  return false;
}

/**
 * When a row begins.
 *
 * The one way to turn a row index into a time. `startMin + slot * pitch` was
 * that way until lunch split the day, and it is now wrong for every row after
 * the break — which is how the block tool came to offer court time at 12:45,
 * underneath the lunch banner.
 *
 * Slots outside the axis are extrapolated at the pitch: the Unscheduled column
 * is a stack rather than a timeline and runs past the end of the day.
 */
export function rowStartMin(axis: CalendarAxis, slot: number): number {
  if (slot < 0) return axis.startMin + slot * axis.pitch;
  const row = axis.rows[slot];
  if (row) return row.startMin;
  return axis.endMin + (slot - axis.rows.length) * axis.pitch;
}

/** What a row is for, for callers that must treat one kind differently — the
 *  block tool does not offer a cell on the lunch row, because lunch already
 *  takes that time off the board on every court. */
export function rowKind(axis: CalendarAxis, slot: number): AxisRowKind {
  return axis.rows[slot]?.kind ?? 'play';
}

/**
 * Where a span of time sits on the axis.
 *
 * Rows are the frame — labels, gridlines and the lunch banner hang off them —
 * but a match is not obliged to start on one. An organizer can type any time
 * they like, and inserting a buffer shifts a court's whole run by an arbitrary
 * number of minutes. So the row is only half the answer: `offsetMinutes` is how
 * far into that row the match actually starts, which the view turns into pixels
 * at the same constant scale it uses for row height. The card then sits at its
 * true minute instead of being rounded onto a row.
 *
 * `spanSlots` is walked rather than divided, because rows are no longer all the
 * same height: a card that runs from the last row of the morning into the
 * afternoon crosses the lunch row, which is an hour tall.
 *
 * `startSlot` may be negative and `startSlot + spanSlots` may run past the last
 * row: blocked periods are configured independently of the matches that opened
 * the axis. Callers clip.
 */
export function placeOnAxis(axis: CalendarAxis, startMin: number, durationMinutes: number): AxisPlacement {
  const dur = Math.max(5, Math.trunc(durationMinutes) || DEFAULT_MATCH_MINUTES);
  const endMin = startMin + dur;

  if (startMin < axis.startMin) {
    const back = Math.ceil((axis.startMin - startMin) / axis.pitch);
    const offsetMinutes = startMin - (axis.startMin - back * axis.pitch);
    return { startSlot: -back, spanSlots: Math.max(1, Math.ceil((offsetMinutes + dur) / axis.pitch)), offsetMinutes };
  }
  if (startMin >= axis.endMin) {
    const forward = Math.floor((startMin - axis.endMin) / axis.pitch);
    const offsetMinutes = startMin - (axis.endMin + forward * axis.pitch);
    return {
      startSlot: axis.rows.length + forward,
      spanSlots: Math.max(1, Math.ceil((offsetMinutes + dur) / axis.pitch)),
      offsetMinutes,
    };
  }

  let startSlot = axis.rows.length - 1;
  for (let s = 0; s < axis.rows.length; s += 1) {
    if (startMin < axis.rows[s].startMin + axis.rows[s].minutes) {
      startSlot = s;
      break;
    }
  }
  const offsetMinutes = startMin - axis.rows[startSlot].startMin;

  let spanSlots = 1;
  let covered = axis.rows[startSlot].startMin + axis.rows[startSlot].minutes;
  for (let s = startSlot + 1; s < axis.rows.length && covered < endMin; s += 1) {
    covered = axis.rows[s].startMin + axis.rows[s].minutes;
    spanSlots += 1;
  }
  if (covered < endMin) spanSlots += Math.ceil((endMin - covered) / axis.pitch);

  return { startSlot, spanSlots, offsetMinutes };
}

/**
 * A time against every row.
 *
 * The old view labelled the hours plus the start of each row that had a match
 * on it, because on a 5-minute pitch the hours fell in unlabelled gaps. With a
 * fixed pitch the hours can miss too — a 45-minute row lands on the hour only
 * every third one — and the rows an organizer most wants to read are the *empty*
 * ones, which by definition no match would have labelled. Rows are now bounded
 * by the configured day, so every one of them gets a time; `isHour` is what the
 * view leans on to keep the hour reading as the anchor.
 *
 * Re-phasing after lunch does not thin the hours out: a 09:00–18:00 day on a
 * 45-minute pitch put three rows on the hour before (09:00, 12:00, 15:00) and
 * puts three playing rows on the hour after (09:00, 13:00, 16:00), with the
 * lunch row landing on 12:00 besides. What it loses is their regularity, and
 * the lunch row is what marks the change of phase.
 */
export function axisLabels(axis: CalendarAxis): AxisLabel[] {
  return axis.rows.map((row, slot) => ({
    slot,
    isHour: ((row.startMin % 60) + 60) % 60 === 0,
    time: toHHMM(row.startMin),
    kind: row.kind,
  }));
}
