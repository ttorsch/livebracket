// Pool draw + bracket-crossing logic for the "Draw Pools & Generate Bracket"
// flow. Pure functions, no I/O — callers own persistence.

export interface DrawTeam {
  id: string;
  name: string;
  isTopSeed?: boolean;
}

export interface Pool {
  name: string; // 'A', 'B', 'C', ...
  teams: DrawTeam[];
}

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function poolName(index: number): string {
  if (index < 26) return POOL_LETTERS[index];
  return poolName(Math.floor(index / 26) - 1) + POOL_LETTERS[index % 26];
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomAmong(indices: number[]): number {
  return indices[Math.floor(Math.random() * indices.length)];
}

function indicesAtMin(counts: number[]): number[] {
  const min = Math.min(...counts);
  return counts.flatMap((c, i) => (c === min ? [i] : []));
}

/**
 * Draws `teams` into `poolsCount` named pools (A, B, C, ...).
 *
 * - No top seeds: the full field is shuffled and dealt out sequentially,
 *   giving every pool the same size (±1).
 * - Top seeds present: the top-seed jar is placed first, one at a time,
 *   always into a pool currently holding the fewest top seeds (random
 *   tie-break) — this covers seeds == pools, > pools, and < pools with the
 *   same rule. The normal-seed jar then fills whichever pool is smallest
 *   overall, again with random tie-break.
 */
export function drawPools(teams: DrawTeam[], poolsCount: number): Pool[] {
  if (poolsCount < 1) throw new Error('poolsCount must be at least 1');
  if (teams.length === 0) throw new Error('At least one team is required');

  const pools: Pool[] = Array.from({ length: poolsCount }, (_, i) => ({ name: poolName(i), teams: [] }));

  const topSeedJar = shuffle(teams.filter(t => t.isTopSeed));
  const normalJar = shuffle(teams.filter(t => !t.isTopSeed));

  if (topSeedJar.length === 0) {
    shuffle(teams).forEach((team, i) => pools[i % poolsCount].teams.push(team));
    return pools;
  }

  const topSeedCounts = new Array(poolsCount).fill(0);
  for (const team of topSeedJar) {
    const choice = randomAmong(indicesAtMin(topSeedCounts));
    pools[choice].teams.push(team);
    topSeedCounts[choice]++;
  }

  for (const team of normalJar) {
    const sizes = pools.map(p => p.teams.length);
    const choice = randomAmong(indicesAtMin(sizes));
    pools[choice].teams.push(team);
  }

  return pools;
}

export interface PoolStandingEntry {
  poolName: string;
  teamId: string;
  rank: number; // 1-based; 1 = pool winner
}

export interface BracketMatch {
  round: number;
  position: number; // 0-based, left-to-right within the round
  teamAId: string | null; // null = bye
  teamBId: string | null;
}

/* Standard bracket placement for a field of `size` (power of 2):
   seed 1 meets seed `size`, seed 2 meets `size-1`, recursively interleaved. */
function seedPlacement(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const m = order.length * 2;
    for (const s of order) next.push(s, m + 1 - s);
    order = next;
  }
  return order;
}

// Swaps b (the second half of the clashing pair `i`) with any other single
// slot elsewhere in the field, provided both resulting pairs are clash-free.
function trySwap(field: (string | null)[], poolOf: Map<string, string>, i: number): boolean {
  const a = field[2 * i];
  const b = field[2 * i + 1];
  for (let k = 0; k < field.length; k++) {
    if (k === 2 * i || k === 2 * i + 1) continue;
    const partnerIdx = k % 2 === 0 ? k + 1 : k - 1;
    const x = field[k];
    const partner = field[partnerIdx];
    const pairIOk = !a || !x || poolOf.get(a) !== poolOf.get(x);
    const pairKOk = !partner || !b || poolOf.get(partner) !== poolOf.get(b);
    if (pairIOk && pairKOk) {
      field[2 * i + 1] = x;
      field[k] = b;
      return true;
    }
  }
  return false;
}

function resolveSamePoolClashes(field: (string | null)[], poolOf: Map<string, string>): void {
  const pairCount = field.length / 2;
  for (let pass = 0; pass < 5; pass++) {
    let anyClash = false;
    for (let i = 0; i < pairCount; i++) {
      const a = field[2 * i];
      const b = field[2 * i + 1];
      if (a && b && poolOf.get(a) === poolOf.get(b)) {
        anyClash = true;
        trySwap(field, poolOf, i);
      }
    }
    if (!anyClash) break;
  }
}

/**
 * Maps pool standings onto a knockout field, seeding rank-major (all pool
 * winners, then all runners-up, ...) across the standard placement order so
 * pool-mates land on opposite sides of the bracket. Non-power-of-two counts
 * are padded with byes; any leftover same-pool round-1 pairing (possible
 * with uneven pool sizes) is repaired by swapping with a later pairing.
 */
export function generateBracket(standings: PoolStandingEntry[], advancePerPool: number): BracketMatch[] {
  const poolNames = Array.from(new Set(standings.map(s => s.poolName))).sort();
  const poolOf = new Map(standings.map(s => [s.teamId, s.poolName]));

  const seedOrder: (string | null)[] = [];
  for (let rank = 1; rank <= advancePerPool; rank++) {
    for (const pool of poolNames) {
      const entry = standings.find(s => s.poolName === pool && s.rank === rank);
      seedOrder.push(entry ? entry.teamId : null);
    }
  }

  let size = 2;
  while (size < seedOrder.length) size *= 2;
  while (seedOrder.length < size) seedOrder.push(null);

  const field = seedPlacement(size).map(seed => seedOrder[seed - 1] ?? null);
  resolveSamePoolClashes(field, poolOf);

  const matches: BracketMatch[] = [];
  for (let i = 0; i < field.length / 2; i++) {
    matches.push({ round: 1, position: i, teamAId: field[2 * i], teamBId: field[2 * i + 1] });
  }
  return matches;
}
