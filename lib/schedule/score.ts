// Which match a free court takes next.
//
// A court asks one question and gets one answer. Everything that decides
// *whether* a match may go there is a filter and lives in `place.ts`; this
// module only ranks the matches that are already allowed.
//
// Four criteria, in the organizer's own weighting:
//
//     same division as the match before it   +3
//     no back-to-back for either team        +2
//     no net change                          +2
//     a pool that has already played here    +1
//
// The numbers are small and whole on purpose. A cost function of nine weights
// in the hundreds was impossible to reason about — nobody could say why a
// match landed where it did — and its two biggest terms were in direct
// contradiction (a court reserved to a division was worth 26 against 260 for
// moving a net, so divisions were pushed off their own courts ten times sooner
// than a net was moved). Four criteria that fit on one line can be checked by
// eye against the schedule they produce.
//
// The ordering of the four matters more than the values. `no back-to-back`
// outranking `same pool` is what makes the whole design work: a pool played on
// a court of its own *must* produce back-to-back matches — the three rounds of
// a four-team round robin are {AB,CD}, {AC,BD}, {AD,BC}, and two consecutive
// disjoint matches have to be partners in the same round, so a run of three is
// impossible. Because the court may reach into another pool, a division's
// courts behave as one shared queue and the problem disappears.

import type { MatchNode } from './graph.ts';

export const SAME_DIVISION = 3;
export const NO_BACK_TO_BACK = 2;
export const NO_NET_CHANGE = 2;
export const SAME_POOL = 1;

/** What a court remembers about what it has hosted. */
export interface CourtHistory {
  /** Net height currently rigged, null when nothing has declared one. */
  height: number | null;
  /** Division of the last match played here, null on an empty court. */
  lastDivisionId: string | null;
  /** `divisionId:pool` of every pool that has played here. */
  poolsPlayed: Set<string>;
}

/** Everything about the proposed placement the score reads. */
export interface Proposal {
  /** True when either side — or the winner of a feeding match — would come
   *  straight back on court with no gap at all. */
  backToBack: boolean;
  /** True when the net would have to move for this match. */
  netChange: boolean;
}

export function poolKey(node: MatchNode): string | null {
  return node.pool ? `${node.divisionId}:${node.pool}` : null;
}

/** Higher is better. Maximum 8. */
export function scoreCandidate(node: MatchNode, court: CourtHistory, p: Proposal): number {
  let score = 0;
  if (court.lastDivisionId === node.divisionId) score += SAME_DIVISION;
  if (!p.backToBack) score += NO_BACK_TO_BACK;
  if (!p.netChange) score += NO_NET_CHANGE;
  const key = poolKey(node);
  if (key && court.poolsPlayed.has(key)) score += SAME_POOL;
  return score;
}

/** What a candidate is ranked on once the score has tied — and it ties
 *  constantly, because six matches scoring 8 is the normal state of a pool
 *  round. Without a total order the generator would answer differently on
 *  every run, and an organizer stops trusting a schedule that will not sit
 *  still.
 *
 *  `poolLastStart` is the one that decides the *rhythm* of a round robin, and
 *  it runs the opposite way to the obvious guess. **Pools already on court
 *  finish before new ones start**: a whole pool goes up across the courts it
 *  needs, plays its round, and sits down while the next pool group plays.
 *
 *  Dealing one match from each pool across the courts instead — which reads
 *  like the fairer arrangement — quietly destroys the rest guarantee. After a
 *  pool of four has played `AB` and `CD`, every match it has left pairs one of
 *  `A,B` with one of `C,D`, so the next row *must* reuse whoever played last.
 *  Measured on four pools of four across four courts: one match per pool gives
 *  8 back-to-back matches, whole pools alternating gives **0**, and both take
 *  the same six rows. Alternating groups is what lets a team's rest be a
 *  property of the shape rather than a preference that may lose. */
export interface TieBreak {
  /** Latest finish among this match's teams; -Infinity if none has played. */
  teamsRestedSince: number;
  /** Latest start of any match from this match's pool; -Infinity if none.
   *  Ranked **descending** — see the note above. */
  poolLastStart: number;
  indexInRound: number;
  matchId: string;
}

/** Negative when `a` should be taken before `b`. */
export function compareCandidates(
  a: { score: number; tie: TieBreak },
  b: { score: number; tie: TieBreak },
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.tie.teamsRestedSince !== b.tie.teamsRestedSince) {
    return a.tie.teamsRestedSince - b.tie.teamsRestedSince;
  }
  if (a.tie.poolLastStart !== b.tie.poolLastStart) {
    return b.tie.poolLastStart - a.tie.poolLastStart;
  }
  if (a.tie.indexInRound !== b.tie.indexInRound) return a.tie.indexInRound - b.tie.indexInRound;
  return a.tie.matchId < b.tie.matchId ? -1 : a.tie.matchId > b.tie.matchId ? 1 : 0;
}
