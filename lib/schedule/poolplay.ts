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
//     optimal courts = ⌊pools ÷ 2⌋ × ⌊teams per pool / 2⌋
//
// Four pools of four is ⌊4/2⌋ × ⌊4/2⌋ = 4 courts: pools A and B play two
// matches each while C and D rest, then they swap — dense and back-to-back
// free at the same time. It is reported so an organizer can see what their
// draw wants, and it decides which division gets the venue first.
//
// It is a *ceiling*: the most courts a division can be given while nobody
// plays back to back. Fewer is always safe — the rotation simply takes longer,
// and every team rests more. More is not, because the only way to fill the
// extra courts is to put the resting half back on court, which is the one
// thing the rotation exists to prevent.
//
// So a wide venue does not widen the rotation. It leaves courts standing for
// *another division* to take, and a team's rest is a property of the shape
// rather than a price the cost function may decline to pay.

import type { MatchNode } from './graph.ts';

export interface PoolPlan {
  divisionId: string;
  /** ⌊teams in pool / 2⌋ — matches one pool can have on court at once. */
  perPool: number;
  poolCount: number;
  /** The most courts this division can use with nobody playing back to back. */
  optimalCourts: number;
  /** How many pools play at a time: the ceiling, narrowed by the courts on offer. */
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

  // Pools pair up and alternate on the same courts, so half of them are on
  // court at any moment. The pairing is floored, not the product: three pools
  // make one pair and a spare, and the spare joins a pair rather than earning
  // courts of its own — so three pools of four are comfortable at two courts,
  // exactly as two pools of four are.
  const optimalCourts = Math.max(1, Math.floor(poolCount / 2) * perPool);

  // As many whole pools as will fit, measured against the *ceiling* rather than
  // against the venue.
  //
  // This is where the guarantee lives. Reading the venue alone is what made a
  // roomy day worse than a cramped one: every pool went on court at once, every
  // turn was every team, and the next turn was the same teams again. Clamping
  // to `optimalCourts` first means consecutive turns hold disjoint teams, so a
  // team's rest is a consequence of the rotation's shape and not a price the
  // cost function may decline to pay.
  //
  // The courts this leaves standing are for another division to take, which is
  // the only reason it is affordable. A division alone on a wide venue really
  // does leave them bare — running it flat out to fill them is what the
  // ceiling exists to refuse.
  const usable = Math.min(courts, optimalCourts);
  const fit = Math.max(1, Math.floor(usable / perPool));
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
  const waveCapacity = Math.max(1, usable);
  for (let r = 0; r < maxRounds; r++) {
    for (const group of groups) {
      const wave = group.flatMap(p => rounds[p][r] ?? []);
      for (let i = 0; i < wave.length; i += waveCapacity) {
        waves.push(wave.slice(i, i + waveCapacity));
      }
    }
  }

  return { divisionId, perPool, poolCount, optimalCourts, poolsAtOnce, waves };
}
