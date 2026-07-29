// Phase 3a — the pool-play rotation.
//
// A round robin has a natural rhythm that a cost function will never find on
// its own, because the cost function looks at one match at a time and the
// rhythm is a property of the whole pool.
//
// Inside a pool of n teams, ⌊n/2⌋ matches can be on court at once — that is
// every team in the pool playing simultaneously. Pools are dealt into groups
// that play together and take turns, so a group is resting while the others
// play, and a team's day reads play, rest, play rather than four matches in a
// row.
//
// From that comes the court count a division is *comfortable* at:
//
//     optimal courts = ⌊teams per pool / 2⌋ × pools ÷ 2
//
// Four pools of four is ⌊4/2⌋ × 4 ÷ 2 = 4 courts: pools A and B play two
// matches each while C and D rest, then they swap — dense and back-to-back
// free at the same time. It is reported so an organizer can see what their
// draw wants, and it decides which division gets the venue first.
//
// It is not a ceiling. Given more courts the rotation widens to use them:
// a court standing empty for the whole round robin costs the event more than a
// short gap costs a team. Rest is protected by *price* rather than by leaving
// the floor bare — the cost function picks rested teams first and reaches for a
// tired one only when the alternative is an idle court.

import type { MatchNode } from './graph.ts';

export interface PoolPlan {
  divisionId: string;
  /** ⌊teams in pool / 2⌋ — matches one pool can have on court at once. */
  perPool: number;
  poolCount: number;
  /** The court count this division's pool play actually wants. */
  optimalCourts: number;
  /** How many pools are played at a time, given the courts on offer. */
  poolsAtOnce: number;
  /** Ordered waves; each is a set of matches that start together, and each
   *  waits for the one before it. */
  waves: string[][];
}

/** Split a pool's matches into rounds of mutually disjoint matches.
 *
 *  Greedy rather than a formal 1-factorisation on purpose: a pool is not
 *  always a complete round robin — teams withdraw, organizers edit — and a
 *  greedy maximal matching degrades into something sensible where a circle
 *  method would simply not apply. On a complete pool the two agree. */
function roundsOfPool(matches: MatchNode[]): string[][] {
  const remaining = [...matches];
  const rounds: string[][] = [];

  while (remaining.length > 0) {
    const busy = new Set<string>();
    const round: string[] = [];
    for (let i = 0; i < remaining.length; ) {
      const m = remaining[i];
      const a = m.teamA;
      const b = m.teamB;
      if ((a && busy.has(a)) || (b && busy.has(b))) {
        i++;
        continue;
      }
      if (a) busy.add(a);
      if (b) busy.add(b);
      round.push(m.id);
      remaining.splice(i, 1);
    }
    // Nothing could be added — every remaining match shares a team with one
    // already placed, which cannot happen, but a guard beats an infinite loop.
    if (round.length === 0) {
      rounds.push(remaining.map(m => m.id));
      break;
    }
    rounds.push(round);
  }

  return rounds;
}

/** Plan one division's pool play against the courts on offer.
 *
 *  Returns null when the division has no pools to rotate — no pool matches, or
 *  matches whose pool nobody recorded, in which case the ordinary solver is a
 *  better answer than a rotation built on a guess. */
export function planPoolPlay(
  divisionId: string,
  poolMatches: MatchNode[],
  courts: number,
): PoolPlan | null {
  if (poolMatches.length === 0) return null;
  if (poolMatches.some(m => !m.pool)) return null;

  const byPool = new Map<string, MatchNode[]>();
  for (const m of poolMatches) {
    const list = byPool.get(m.pool!);
    if (list) list.push(m);
    else byPool.set(m.pool!, [m]);
  }

  const pools = [...byPool.entries()].sort(([a], [b]) => a.localeCompare(b));
  const poolCount = pools.length;
  if (poolCount === 0) return null;

  const rounds = pools.map(([, matches]) => roundsOfPool(matches));
  // ⌊teams/2⌋ read off the rotation itself rather than off a team count, which
  // the scheduler is not given directly.
  const perPool = Math.max(1, ...rounds.flat().map(r => r.length));

  const optimalCourts = Math.max(1, Math.floor((perPool * poolCount) / 2));

  // As many whole pools as the courts will hold.
  //
  // This used to stop at half the pools, so that the resting half guaranteed
  // nobody ever played back to back. That guarantee turned out to cost more
  // than it was worth: on a four-court venue a division wanting two courts left
  // two of them standing empty for the whole round robin. Filling them is worth
  // a short gap, so the ceiling is now the venue, and rest is left to the cost
  // function — which still picks the rested teams first and reaches for a tired
  // one only when the alternative is an idle court.
  const fit = Math.max(1, Math.floor(courts / perPool));
  const poolsAtOnce = Math.max(1, Math.min(poolCount, fit));

  // Pools are dealt into groups that play together, and the groups take turns.
  // Round r of every pool in a group is one wave; the groups cycle through
  // round 0, then round 1, so a group always has the other groups' turn to
  // rest in between.
  const groups: number[][] = [];
  for (let i = 0; i < poolCount; i += poolsAtOnce) {
    groups.push(Array.from({ length: Math.min(poolsAtOnce, poolCount - i) }, (_, k) => i + k));
  }

  const maxRounds = Math.max(...rounds.map(r => r.length));
  const waves: string[][] = [];
  for (let r = 0; r < maxRounds; r++) {
    for (const group of groups) {
      const wave = group.flatMap(p => rounds[p][r] ?? []);
      if (wave.length > 0) waves.push(wave);
    }
  }

  return { divisionId, perPool, poolCount, optimalCourts, poolsAtOnce, waves };
}
