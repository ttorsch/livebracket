// How many courts a division wants, and which courts it gets.
//
// The rest guarantee lives here, and it is arithmetic rather than a rule:
//
//     appetite = ceil( pools x floor(teams per pool / 2) / 2 )
//
// `pools x floor(teams/2)` is every match the division could have on court at
// once — its whole field playing. Half of that is the appetite, so with
// `appetite` courts running exactly half the division is on court and half is
// resting. Nobody has to schedule the rest; it is what is left over.
//
// This replaces `optimalCourts = floor(pools/2) x perPool`, which floored the
// pool pairing *before* multiplying and so under-served an odd pool count —
// three pools of four were given two courts instead of three, and a third of
// the division sat down for the whole event.
//
// Appetite is derived from the draw and is not an organizer setting. The old
// `dedicatedCourts` override offered a third answer to a question that already
// had two, and it was the one the solver trusted least.

import type { MatchNode } from './graph.ts';
import { divisionGenderCohort } from './types.ts';

export interface Appetite {
  divisionId: string;
  /** Pools in the division's round robin, 0 when it has none. */
  pools: number;
  /** Matches one pool can have on court at once — floor(teams in pool / 2). */
  perPool: number;
  /** Every match the division could have on court simultaneously. */
  wideOpen: number;
  /** Half of that, rounded up: the courts this division wants. */
  appetite: number;
}

/** One court block: a contiguous run of court indices held by one division. */
export interface Block {
  divisionId: string;
  /** Court indices, contiguous and ascending. */
  courts: number[];
}

/** Teams in a pool, read off its matches.
 *
 *  A drawn pool names both sides of every match, so counting distinct team ids
 *  is exact. An *undrawn* division names nobody, and the fallback then reads
 *  the width off a greedy round of mutually disjoint matches — which with no
 *  names at all collapses to "every match at once", so it is floored against
 *  the pool's own match count rather than trusted outright. */
function perPoolOf(matches: MatchNode[]): number {
  const teams = new Set<string>();
  for (const m of matches) {
    if (m.teamA) teams.add(m.teamA);
    if (m.teamB) teams.add(m.teamB);
  }
  if (teams.size >= 2) return Math.max(1, Math.floor(teams.size / 2));
  // Undrawn: n teams play n(n-1)/2 matches, so invert that to recover n.
  const n = Math.floor((1 + Math.sqrt(1 + 8 * matches.length)) / 2);
  return Math.max(1, Math.floor(n / 2));
}

/** What one division wants from the venue.
 *
 *  A division with no round robin — a straight knockout — has no pools to
 *  read, so its width comes from its opening round instead: half of the
 *  matches that could run at once, which is the same sentence the pool formula
 *  is. Dependencies already force the rest between knockout rounds, so this
 *  only has to size the block. */
export function appetiteOf(divisionId: string, matches: MatchNode[]): Appetite {
  const poolMatches = matches.filter(m => m.isPool);

  if (poolMatches.length === 0) {
    const rounds = matches.map(m => m.roundIndex);
    const first = rounds.length > 0 ? Math.min(...rounds) : 0;
    const opening = matches.filter(m => m.roundIndex === first).length;
    const wideOpen = Math.max(1, opening);
    return {
      divisionId,
      pools: 0,
      perPool: 1,
      wideOpen,
      appetite: Math.max(1, Math.ceil(wideOpen / 2)),
    };
  }

  const byPool = new Map<string, MatchNode[]>();
  for (const m of poolMatches) {
    const key = m.pool ?? '';
    const list = byPool.get(key);
    if (list) list.push(m);
    else byPool.set(key, [m]);
  }

  const pools = byPool.size;
  // Pools of a division are drawn to the same size, so the widest is the size.
  const perPool = Math.max(1, ...[...byPool.values()].map(perPoolOf));
  const wideOpen = pools * perPool;

  return {
    divisionId,
    pools,
    perPool,
    wideOpen,
    // Halving is what makes pool *groups* alternate — one group on court while
    // the other rests. A division drawn into a single pool has nothing to
    // alternate with, so there is no rest for the halving to protect and it
    // buys nothing but a longer event. A lone pool plays flat out and is
    // warned; holding it to one court on an empty venue was the halving
    // charging for a guarantee it could not deliver.
    appetite: pools <= 1 ? wideOpen : Math.max(1, Math.ceil(wideOpen / 2)),
  };
}

/** The order divisions take the venue in.
 *
 *  Gendered divisions first, then the rest, because of **roster overlap**: a
 *  Mixed team draws its players from the Men's and Women's draws, so the same
 *  human is entered twice under two unrelated team ids and no amount of
 *  looking at the graph will reveal the clash. Running the non-gendered
 *  divisions only once the gendered ones are finished is the only protection
 *  there is.
 *
 *  Within a cohort, the biggest appetite goes first — it is the hardest to fit
 *  and the one whose shape everything else is measured against. */
export function divisionQueue(appetites: Appetite[], cohortOf: (divisionId: string) => number): string[] {
  return [...appetites]
    .sort((a, b) => {
      const ca = cohortOf(a.divisionId);
      const cb = cohortOf(b.divisionId);
      if (ca !== cb) return ca - cb;
      if (a.appetite !== b.appetite) return b.appetite - a.appetite;
      return a.divisionId < b.divisionId ? -1 : 1;
    })
    .map(a => a.divisionId);
}

/** Cohort of a division as the queue reads it. Exported so the caller can pass
 *  the division shapes it already holds rather than re-deriving labels. */
export function cohortRank(d: { gender?: string | null; label?: string }): number {
  return divisionGenderCohort(d);
}

/** Cut the venue into blocks for the divisions currently running.
 *
 *  Each division gets **exactly its appetite**, in a contiguous run of courts,
 *  and whatever is left over is unreserved.
 *
 *  A block is never cut wider than the appetite, even when the venue has room
 *  and nothing else to do with it. That was the original rule — the smaller
 *  division absorbed the whole remainder so that no court stood idle — and it
 *  is measurably wrong: a rotation given more courts than its appetite has
 *  only one way to fill them, which is to put the resting half of the division
 *  back on court. Measured on the organizer's tournament, renting a *fifth*
 *  court took back-to-back play from 3 matches to 14. An organizer who adds a
 *  court should never be handed a worse schedule for it.
 *
 *  So an idle court is allowed to be idle. It is the honest answer when a draw
 *  cannot use the room it has been given, and the inventory says so plainly;
 *  filling it costs the rest guarantee the appetite exists to provide.
 *
 *  A division that would be left under one court does not start at all; it
 *  waits its turn. */
export function allotBlocks(running: Appetite[], courtCount: number): Block[] {
  const courts = Math.max(0, Math.trunc(courtCount) || 0);
  if (courts === 0 || running.length === 0) return [];

  const all = Array.from({ length: courts }, (_, i) => i);
  const out: Block[] = [];
  let cursor = 0;
  for (const division of running) {
    const width = Math.min(division.appetite, courts - cursor);
    if (width < 1) break;
    out.push({ divisionId: division.divisionId, courts: all.slice(cursor, cursor + width) });
    cursor += width;
  }
  return out;
}
