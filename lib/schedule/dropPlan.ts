/* Where a match goes when the organizer drops it, and what that does to the
 * matches around it.
 *
 * A court is one unbroken queue: matches sit one after another and two of them
 * can never share a minute. So a drop is an *insertion* rather than a free
 * placement — the match takes the start time of whatever it was dropped in
 * front of, and that match, with everything behind it on the court, moves later
 * by the length of the arrival. The court it came from closes over the hole it
 * left, so neither court is left with a gap nobody asked for.
 *
 * Lunch, blocked time and the end of the day are deliberately not consulted. A
 * push that lands on one of them is a problem the organizer can see and decide
 * about; silently refusing the drop, or hunting for the next free minute, would
 * both put the match somewhere they did not point at.
 */

import { parseHHMM, toHHMM, type BlockedPeriod } from './types.ts';

export const BUFFER_LABEL = 'Buffer';
export const NET_ADJUST_LABEL = 'Net adjust';

export const isBufferBlock = (label?: string | null): boolean =>
  label === BUFFER_LABEL || label === NET_ADJUST_LABEL || (label ? /buffer|net\s*adjust/i.test(label) : false);

/** Where a dropped match is going: in front of another match, onto the end of a
 *  court's run, or at a bare time (minutes since midnight) — the last being
 *  what dropping on empty calendar space means. */
export type DropTarget = { beforeId: string } | { append: true } | { time: number };

/** A match as the planner needs to see it. `start` is minutes since midnight,
 *  and null for a match that has not been given a time yet. */
export type Placement = {
  id: string;
  court: string;
  day: number;
  start: number | null;
  durationMinutes: number;
};

/** A match that has to move, and where to. */
export type PlannedMove = { id: string; court: string; day: number; start: number };

export type PlanDropResult = {
  moves: PlannedMove[];
  blocks: BlockedPeriod[];
};

const durationOf = (p: { durationMinutes: number }) => Math.max(5, Math.trunc(p.durationMinutes) || 45);

/* Which half of the day a time belongs to, given the venue's break.
 *
 * The two halves are separate queues. Anything at or after lunch ends is the
 * afternoon; anything before lunch starts is the morning. A time inside the
 * window itself is counted as the morning — it is play that has run into the
 * break rather than play that belongs after it, so it closes up with the
 * matches it followed.
 *
 * With no break configured the whole day is one run, which is what `0`
 * everywhere means. */
function sideOfDay(min: number, lunch: { start: number; end: number } | null): number {
  if (!lunch) return 0;
  return min >= lunch.end ? 1 : 0;
}

interface InternalBlock {
  originalIndex: number;
  block: BlockedPeriod;
  court: string;
  day: number;
  start: number;
  end: number;
  duration: number;
  isBuffer: boolean;
  deleted: boolean;
}

/**
 * Plan a drop.
 *
 * @param placements Every match in the schedule, however it is currently placed.
 * @param matchId    The match being dropped.
 * @param court      The court it is being dropped on.
 * @param day        The day index it is being dropped on.
 * @param target     The point on that court it is being dropped at.
 * @param emptyStart The time to use when appending to a court that has nothing
 *                   on it yet — the start of the day, as far as the caller is
 *                   concerned.
 * @param blocks     Optional blocked periods on the schedule (buffers, lunch, blocked periods).
 * @returns Moves for every match that has to move (dropped one included), plus
 *          the updated blocked periods array with buffers shifted or removed.
 */
export function planDrop(
  placements: Placement[],
  matchId: string,
  court: string,
  day: number,
  target: DropTarget,
  emptyStart: number,
  blocks: BlockedPeriod[] = [],
  lunch: { start: number; end: number } | null = null,
): PlanDropResult {
  const moved = placements.find(p => p.id === matchId);
  if (!moved) return { moves: [], blocks: [...blocks] };
  const dur = durationOf(moved);

  const internalBlocks: InternalBlock[] = blocks.map((b, idx) => {
    const isBuffer = isBufferBlock(b.label);
    const start = b.start ? parseHHMM(b.start) : 0;
    const end = b.end ? parseHHMM(b.end) : 0;
    return {
      originalIndex: idx,
      block: b,
      court: b.court ?? '',
      day: b.day ?? 0,
      start,
      end,
      duration: Math.max(0, end - start),
      isBuffer: isBuffer && b.court != null && b.day != null,
      deleted: false,
    };
  });

  /* New start times so far, by match id. The dropped match itself is not in
     here — it is added once the drop point is known. */
  const moves = new Map<string, number>();

  /** A court's matches, earliest first, reading any move already decided. */
  const runOf = (c: string, d: number) =>
    placements
      .filter(p => p.id !== matchId && p.court === c && p.day === d && p.start != null)
      .map(p => ({ p, start: moves.get(p.id) ?? (p.start as number) }))
      .sort((a, b) => a.start - b.start);

  const buffersOn = (c: string, d: number) =>
    internalBlocks.filter(b => !b.deleted && b.isBuffer && b.court === c && b.day === d);

  /* 1. Lifting the match out closes the gap behind it — but only as far as
   *    the break.
   *
   *    On the court it came from, the matches after it come forward by its
   *    length, which is what makes a court an unbroken queue. What they may
   *    not do is cross lunch: pulling a morning match out used to drag the
   *    whole afternoon an hour earlier, rewriting times people had already
   *    been told. The two halves of the day are separate queues, so a
   *    morning gap closes with morning matches and the afternoon stays where
   *    it is.
   *
   *    If the match had a buffer immediately before it, that buffer goes too
   *    — it was padding for a match that is no longer there — and the gap
   *    grows by its length.
   */
  if (moved.start != null) {
    const precedingBuffer = internalBlocks.find(
      b => !b.deleted && b.isBuffer && b.court === moved.court && b.day === moved.day && b.end === moved.start,
    );

    let liftGap = dur;
    if (precedingBuffer) {
      precedingBuffer.deleted = true;
      liftGap = dur + precedingBuffer.duration;
    }

    const liftedSide = sideOfDay(moved.start, lunch);
    /* Same side of the break as the match that left, or there is no gap
       between them to close. */
    const followsInSameRun = (start: number) =>
      start >= (moved.start as number) && sideOfDay(start, lunch) === liftedSide;

    for (const entry of runOf(moved.court, moved.day)) {
      if (followsInSameRun(entry.start)) moves.set(entry.p.id, entry.start - liftGap);
    }
    for (const b of buffersOn(moved.court, moved.day)) {
      if (followsInSameRun(b.start)) {
        b.start -= liftGap;
        b.end -= liftGap;
      }
    }
  }

  // 2. The destination is read *after* that gap closed. That is what makes
  //    moving a match further down its own court land it where the queue
  //    actually is, rather than where it was before the match was lifted.
  const dest = runOf(court, day);
  const destBuffers = buffersOn(court, day);

  let dropStart: number;
  let shiftAt: number | null = null;
  let shiftDelta = 0;

  if ('beforeId' in target) {
    const at = dest.find(entry => entry.p.id === target.beforeId);
    if (!at) return { moves: [], blocks: [...blocks] };

    // If there is a buffer immediately before the target match, dropping between
    // replaces/removes that buffer card.
    const bufferBetween = destBuffers.find(b => b.end === at.start);
    if (bufferBetween) {
      bufferBetween.deleted = true;
      dropStart = bufferBetween.start;
      shiftAt = at.start;
      shiftDelta = dropStart + dur - at.start;
    } else {
      dropStart = at.start;
      shiftAt = at.start;
      shiftDelta = dur;
    }
  } else if ('append' in target) {
    const matchEnds = dest.map(e => e.start + durationOf(e.p));
    const bufferEnds = destBuffers.map(b => b.end);
    const allEnds = [...matchEnds, ...bufferEnds];
    dropStart = allEnds.length > 0 ? Math.max(...allEnds) : emptyStart;
  } else {
    dropStart = target.time;
    const afterMatches = dest.filter(entry => entry.start >= dropStart);
    const afterBuffers = destBuffers.filter(b => b.start >= dropStart);
    const firstStarts = [...afterMatches.map(m => m.start), ...afterBuffers.map(b => b.start)];
    if (firstStarts.length > 0) {
      const minStart = Math.min(...firstStarts);
      const delta = Math.max(0, dropStart + dur - minStart);
      if (delta > 0) {
        shiftAt = minStart;
        shiftDelta = delta;
      }
    }
  }

  /* 3. Nothing may overlap: push items at or after the drop point down —
   *    but no further than the break, for the same reason the lift stops
   *    there. The two halves of the day are separate queues, so an insertion
   *    in the morning rearranges the morning and leaves the afternoon on the
   *    times people were given.
   *
   *    A morning push may still run *into* the break: that is play spilling
   *    over its own half, which the calendar shows (the band colours and the
   *    watermark reads "LUNCH · IN USE") and the organizer can decide about.
   *    What it may not do is move a match that belongs to the other half.
   */
  if (shiftAt != null && shiftDelta !== 0) {
    const pushSide = sideOfDay(shiftAt, lunch);
    const pushable = (start: number) => start >= shiftAt! && sideOfDay(start, lunch) === pushSide;

    for (const entry of dest) {
      if (pushable(entry.start)) {
        moves.set(entry.p.id, entry.start + shiftDelta);
      }
    }
    for (const b of destBuffers) {
      if (pushable(b.start)) {
        b.start += shiftDelta;
        b.end += shiftDelta;
      }
    }
  }

  const byId = new Map(placements.map(p => [p.id, p] as const));
  const resultMoves: PlannedMove[] = [{ id: matchId, court, day, start: dropStart }];
  for (const [id, at] of moves) {
    const p = byId.get(id);
    if (p) resultMoves.push({ id, court: p.court, day: p.day, start: at });
  }

  const finalBlocks: BlockedPeriod[] = [];
  for (const ib of internalBlocks) {
    if (ib.deleted) continue;
    if (ib.isBuffer) {
      finalBlocks.push({
        ...ib.block,
        court: ib.court,
        day: ib.day,
        start: toHHMM(ib.start),
        end: toHHMM(ib.end),
      });
    } else {
      finalBlocks.push(ib.block);
    }
  }

  return { moves: resultMoves, blocks: finalBlocks };
}


/* ── Dropping onto a court that is already busy ───────────────────
 *
 * planDrop above treats a court as one unbroken queue: a drop *inserts*, and
 * everything behind it moves later. That is the right answer when the
 * organizer aims at a specific card ("put this one in front of that one"),
 * because the intent is ordering.
 *
 * It is the wrong answer when they aim at open calendar space and happen to
 * catch the edge of an existing match. There the intent is a *time*, and
 * silently pushing the rest of the court's day later to honour a few minutes
 * of overlap is a much larger edit than the one that was asked for.
 *
 * So an empty-space drop is fitted instead of inserted: the dropped card —
 * and only the dropped card — moves to the nearest start that does not
 * overlap anything, snapped to the calendar's own rows. When the court has
 * no gap big enough for it, there is no honest place to put it, and the drop
 * is refused so the card goes back where it came from.
 */

export interface Span {
  /** Minutes since midnight. */
  start: number;
  end: number;
}

export interface FitDropInput {
  /** Everything already occupying the target court and day: matches, buffers,
   *  lunch, blocked time. Order does not matter; overlaps are tolerated. */
  occupied: Span[];
  /** The window the day itself allows, in minutes since midnight. */
  dayStart: number;
  dayEnd: number;
  /** How long the dropped match runs. */
  duration: number;
  /** The time the organizer dropped at. */
  desiredStart: number;
  /** Calendar row length, so a fitted start lands on a row rather than
   *  between two. */
  pitch: number;
}

export type FitDropResult =
  /** Where to put it, and whether that is where they pointed. */
  | { start: number; snapped: boolean }
  /** No gap on this court is long enough — the drop cannot be honoured. */
  | null;

/** Free gaps in [dayStart, dayEnd] once `occupied` is taken out. */
function freeWindows(occupied: Span[], dayStart: number, dayEnd: number): Span[] {
  const busy = occupied
    .filter(s => s.end > s.start)
    .map(s => ({ start: Math.max(s.start, dayStart), end: Math.min(s.end, dayEnd) }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const merged: Span[] = [];
  for (const s of busy) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }

  const free: Span[] = [];
  let cursor = dayStart;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free;
}

export function fitDropTime(input: FitDropInput): FitDropResult {
  const { occupied, dayStart, dayEnd, duration, desiredStart, pitch } = input;
  const dur = Math.max(1, Math.trunc(duration));
  const grid = Math.max(1, Math.trunc(pitch));

  const windows = freeWindows(occupied, dayStart, dayEnd).filter(w => w.end - w.start >= dur);
  if (windows.length === 0) return null;

  // Where they pointed, if it happens to be clear.
  for (const w of windows) {
    if (desiredStart >= w.start && desiredStart + dur <= w.end) {
      return { start: desiredStart, snapped: false };
    }
  }

  /* Otherwise the closest start that fits. Snapping to the grid is done
     inside each window and then re-clamped, so rounding can never push the
     card back over the neighbour the fit was avoiding. */
  let best: { start: number; distance: number } | null = null;
  for (const w of windows) {
    const latest = w.end - dur;
    const clamped = Math.min(Math.max(desiredStart, w.start), latest);
    /* Snapped against the day's own rows, not the window's, so a fitted card
       lines up with every other card on the calendar. Re-clamped afterwards:
       when the neighbour it is avoiding is itself off-grid the card sits
       flush against it instead, because not overlapping outranks being
       tidy. */
    const snappedAbs = dayStart + Math.round((clamped - dayStart) / grid) * grid;
    const candidate = Math.min(Math.max(snappedAbs, w.start), latest);
    const distance = Math.abs(candidate - desiredStart);
    if (!best || distance < best.distance) best = { start: candidate, distance };
  }

  return best ? { start: best.start, snapped: true } : null;
}


/* ── Pinned matches ───────────────────────────────────────────────
 *
 * A pin says "this one plays at this time, whatever else moves". The court
 * is still an unbroken queue, so the rest of the run has to flow around the
 * pin rather than through it: an unpinned match whose new start would land
 * on a pinned one is put after it instead.
 *
 * Applied as a repair pass over a plan rather than threaded through
 * planDrop's own arithmetic. planDrop answers "where does everything want to
 * go", which is unchanged by pinning; this answers "and where can it
 * actually go", which is the only part a pin has an opinion about. Keeping
 * them apart is what stops every branch above from having to know about
 * pins.
 */

interface Positioned {
  id: string;
  start: number;
  duration: number;
  pinned: boolean;
}

/** One court-day's run, repaired so no pinned match moves and nothing
 *  overlaps. Items are returned with their final starts. */
export function flowAroundPins(items: Positioned[]): Positioned[] {
  const order = [...items].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const pins = order.filter(i => i.pinned).sort((a, b) => a.start - b.start);

  const out: Positioned[] = [];
  let cursor = -Infinity;

  for (const item of order) {
    if (item.pinned) {
      // Immovable by definition. It sets the floor for whatever follows.
      out.push({ ...item });
      cursor = Math.max(cursor, item.start + item.duration);
      continue;
    }

    let start = Math.max(item.start, cursor === -Infinity ? item.start : cursor);
    /* Step over every pin this would run into. Repeated because clearing one
       pin can push the match onto the next. */
    for (const pin of pins) {
      if (pin.id === item.id) continue;
      const pinEnd = pin.start + pin.duration;
      if (start < pinEnd && pin.start < start + item.duration) start = pinEnd;
    }
    out.push({ ...item, start });
    cursor = start + item.duration;
  }

  return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * Re-seat a plan so no pinned match moves.
 *
 * @param placements Every match, as planDrop saw them.
 * @param result     What planDrop decided.
 * @param pinned     Ids the organizer has fixed.
 * @returns The same plan with pinned matches back at their original times and
 *          everything else flowed around them.
 */
export function respectPins(
  placements: Placement[],
  result: PlanDropResult,
  pinned: ReadonlySet<string>,
): PlanDropResult {
  if (pinned.size === 0) return result;

  const original = new Map(placements.map(p => [p.id, p] as const));
  const planned = new Map(result.moves.map(m => [m.id, m] as const));

  /* Court-days the plan touches. A pin only constrains the run it sits in,
     so nothing else has to be revisited. */
  const affected = new Set(result.moves.map(m => `${m.court}\u0000${m.day}`));

  const finalStart = new Map<string, { court: string; day: number; start: number }>();
  for (const m of result.moves) finalStart.set(m.id, { court: m.court, day: m.day, start: m.start });

  for (const key of affected) {
    const [court, dayRaw] = key.split('\u0000');
    const day = Number(dayRaw);

    const items: Positioned[] = [];
    for (const p of placements) {
      const moveTo = finalStart.get(p.id);
      const court_ = moveTo?.court ?? p.court;
      const day_ = moveTo?.day ?? p.day;
      if (court_ !== court || day_ !== day) continue;
      const start = moveTo?.start ?? p.start;
      if (start == null) continue;
      items.push({
        id: p.id,
        // A pinned match is held at the time it already had, not the one the
        // plan wanted to give it.
        start: pinned.has(p.id) ? (original.get(p.id)?.start ?? start) : start,
        duration: durationOf(p),
        pinned: pinned.has(p.id),
      });
    }

    for (const seated of flowAroundPins(items)) {
      finalStart.set(seated.id, { court, day, start: seated.start });
    }
  }

  /* Only what actually ends up somewhere new is a move. A match the repair
     put back where it started is not an edit. */
  const moves: PlannedMove[] = [];
  for (const [id, at] of finalStart) {
    const before = original.get(id);
    const wasPlanned = planned.has(id);
    const unchanged =
      before && before.court === at.court && before.day === at.day && before.start === at.start;
    if (unchanged && !wasPlanned) continue;
    if (unchanged) continue;
    moves.push({ id, court: at.court, day: at.day, start: at.start });
  }

  return { moves, blocks: result.blocks };
}
