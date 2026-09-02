// What a net change costs, asked by the solver and the validator alike.
//
// A court is rigged to one net height. Playing a division that needs a
// different one means a crew walks on and moves it, and that takes real
// minutes off the court. Two places in this codebase need to know that:
//
//   - `assign.ts` asks *when can this match start* while it is placing, and
//   - `validate.ts` asks *is this arrangement wrong* about a schedule an
//     organizer has already edited by hand.
//
// They are different questions and they used to be one rule implemented once,
// in the solver, which meant a hand edit could put a 2.43 m match directly
// under a 2.24 m one and nothing anywhere said so. This module is the rule
// itself, so the two cannot drift.
//
// The subtlety worth stating out loud is that "what came before" is *two*
// different look-backs, not one:
//
//   - The court **frees** when the last match on it ends, whatever height that
//     match played at.
//   - The net **sits** at the height of the last match that *declared* one. A
//     division with no declared height plays at whatever is already rigged and
//     moves nothing, so it is transparent to the net and the look-back walks
//     straight past it.
//
// Collapsing those two into "the match immediately before" would let an
// undeclared-height division act as a laundering step: drop one in between and
// the net change disappears from the report while the crew still has to move
// the net.
//
// Pure and allocation-light: `netStateBefore` consumes a lazy iterable and
// stops as soon as it has both halves, so the solver's backwards slot walk
// still costs what it always did.

/** One earlier match on a court, as this module needs to see it. */
export interface NetPredecessor {
  /** When it ends, in whatever unit the caller is working in — absolute
   *  minutes in the solver, minutes-into-the-event in the validator. Only ever
   *  compared against starts in the same unit. */
  endAbs: number;
  /** The height it declared, or null if its division declared none. */
  netHeight: number | null;
}

/** What a match arriving on a court actually faces. */
export interface CourtNetState {
  /** When the court frees. `-Infinity` when nothing has played on it yet —
   *  which is what makes the first match of a day free without a special case
   *  for the day boundary. */
  freeAt: number;
  /** The height the net is at, or null when nothing has declared one. */
  height: number | null;
}

/** Nothing has played on this court yet today. */
export const EMPTY_COURT: CourtNetState = { freeAt: -Infinity, height: null };

/** Fold a court's earlier matches — **most recent first**, and only ones on
 *  the same court and the same day — into the state the next match meets.
 *
 *  Pass a generator to keep this lazy: the walk stops at the first declared
 *  height, so a caller scanning backwards through slots never scans further
 *  than it has to. */
export function netStateBefore(previous: Iterable<NetPredecessor>): CourtNetState {
  let freeAt = -Infinity;
  let height: number | null = null;
  for (const p of previous) {
    if (freeAt === -Infinity) freeAt = p.endAbs;
    if (p.netHeight != null) {
      height = p.netHeight;
      break;
    }
  }
  return { freeAt, height };
}

/** Does the net actually have to move for this match?
 *
 *  Only when both sides declare a height and they differ. An undeclared height
 *  on either side means nobody has asked for anything, so nothing moves. */
export function netMustMove(state: CourtNetState, height: number | null): boolean {
  return height != null && state.height != null && state.height !== height;
}

/** The earliest this match can start on this court.
 *
 *  The buffer is a **wait, not a flat charge**: the crew starts the moment the
 *  previous match ends, so a match that already sits far enough after one pays
 *  nothing, and a court's first match of the day pays nothing at all. */
export function netReadyAt(
  state: CourtNetState,
  height: number | null,
  bufferMinutes: number,
): number {
  if (!netMustMove(state, height)) return -Infinity;
  return state.freeAt + normaliseBuffer(bufferMinutes);
}

/** How much of the wait is left when a match starts at `startAbs`.
 *
 *  Zero when there is room. The validator's half of the same arithmetic
 *  `assign.ts` uses to pick a start: one asks where the wait ends, the other
 *  how far into it you are. */
export function netShortfall(
  startAbs: number,
  state: CourtNetState,
  height: number | null,
  bufferMinutes: number,
): number {
  const readyAt = netReadyAt(state, height, bufferMinutes);
  if (readyAt === -Infinity) return 0;
  return Math.max(0, readyAt - startAbs);
}

/** Whole minutes, never negative — the config field is organizer-entered. */
export function normaliseBuffer(bufferMinutes: number): number {
  return Math.max(0, Math.trunc(bufferMinutes) || 0);
}
