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
    appetite: Math.max(1, Math.ceil(wideOpen / 2)),
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
 *  **The venue is always fully allotted.** Two divisions run at a time: the
 *  bigger appetite keeps its number and the smaller absorbs the whole
 *  remainder, so no court is left without an owner. A division running alone
 *  takes every court.
 *
 *  That costs the smaller division its rest guarantee on a roomy venue, which
 *  is deliberate — an idle court an organizer can see is worse than a
 *  back-to-back they can fix with the buffer tool. It cannot run away with
 *  itself either: a division of `n` teams can never have more than `n/2`
 *  matches on court at once, so courts past that idle on the team filter
 *  rather than on a rule.
 *
 *  A smaller division that would be left under one court does not start at
 *  all; it waits its turn, and the bigger one takes the venue.
 *
 *  `fillVenue` is false once some division is past its round robin and has a
 *  knockout waiting. Then each block is cut to exactly its appetite and the
 *  rest of the roster is left **unreserved** — open to whoever can use it.
 *  Handing the whole venue to the last division still playing pools would
 *  otherwise lock every other division's endgame out of a court, which is a
 *  worse kind of idle than an empty column. */
export function allotBlocks(running: Appetite[], courtCount: number, fillVenue = true): Block[] {
  const courts = Math.max(0, Math.trunc(courtCount) || 0);
  if (courts === 0 || running.length === 0) return [];

  const all = Array.from({ length: courts }, (_, i) => i);

  if (!fillVenue) {
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

  if (running.length === 1) return [{ divisionId: running[0].divisionId, courts: all }];

  const [first, second] = running;
  const bigger = second.appetite > first.appetite ? second : first;
  const smaller = bigger === first ? second : first;
  const forBigger = Math.min(bigger.appetite, courts);
  const forSmaller = courts - forBigger;

  if (forSmaller < 1) return [{ divisionId: bigger.divisionId, courts: all }];

  // Queue order decides which end of the roster a division sits on, so the
  // division that has been waiting longest is not shuffled across the venue
  // every time its neighbour changes.
  const firstWidth = first === bigger ? forBigger : forSmaller;
  return [
    { divisionId: first.divisionId, courts: all.slice(0, firstWidth) },
    { divisionId: second.divisionId, courts: all.slice(firstWidth) },
  ];
}
