/* ── Bracket crossing ─────────────────────────────────────────────────
 *
 * How the pool finishers are paired in the knockout's first round. Shared by
 * the real draw (the draw route) and the provisional one (lib/provisionalDraw),
 * so the bracket an organizer is shown before the draw is the bracket the
 * draw then produces.
 *
 * Round-1 knockout slots are drawn as pool positions (CrossSlot), not teams:
 * pool play hasn't happened yet when the bracket is generated, so the matches
 * are created with no team ids and read as "#1 Pool A" until the pools decide.
 */

import type { CrossSlot } from './data';

type CrossSides = { slotsA: (CrossSlot | null)[]; slotsB: (CrossSlot | null)[] };

// Standard bracket seed placement for a field of `size` (power of two):
// returns an array where index = bracket position (0-based) and value = the
// seed rank (1-based) that belongs there. Adjacent pairs are round-1 matches,
// so seed 1 and 2 sit at opposite ends, 3 and 4 at the quarter points, etc.
export function seedPlacement(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const m = order.length * 2;
    for (const s of order) next.push(s, m + 1 - s);
    order = next;
  }
  return order;
}

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function poolName(index: number): string {
  return POOL_LETTERS[index] ?? String(index + 1);
}

// `counts[p]` = how many teams pool p sends into the knockout. A position no
// pool can fill (rank beyond that pool's advancing count) resolves to null.
function makeSlot(counts: number[], pool: number, rank: number): CrossSlot | null {
  return rank <= (counts[pool] ?? 0) ? { pool: poolName(pool), rank } : null;
}

function getStaticCrossSlots(counts: number[], r1Count: number): CrossSides {
  const slotsA: (CrossSlot | null)[] = Array(r1Count).fill(null);
  const slotsB: (CrossSlot | null)[] = Array(r1Count).fill(null);
  const pools = counts.length;

  // Pairs are [poolIndex, rank] — the published static cross-bracket charts.
  //
  // Match order is what puts a pairing in a bracket half, and every chart uses
  // the same one: the pool winners run A, B | C, D, so A1 and B1 share a half
  // and meet in the semifinal, C1 and D1 in the other. That holds whether two
  // or four teams advance per pool, so the arrangement an organizer sees
  // doesn't change shape when they change the advance count.
  const chart = (pairs: [[number, number], [number, number]][]) => {
    pairs.forEach(([a, b], idx) => {
      slotsA[idx] = makeSlot(counts, a[0], a[1]);
      slotsB[idx] = makeSlot(counts, b[0], b[1]);
    });
    return { slotsA, slotsB };
  };

  if (pools === 4) {
    const k = Math.max(...counts, 1);
    if (k === 4 && r1Count >= 8) {
      // 16-Team Static Cross-Bracket
      return chart([
        [ [0, 1], [3, 4] ], // Match 1: A1 vs D4
        [ [2, 2], [1, 3] ], // Match 2: C2 vs B3
        [ [1, 1], [2, 4] ], // Match 3: B1 vs C4
        [ [3, 2], [0, 3] ], // Match 4: D2 vs A3
        [ [2, 1], [1, 4] ], // Match 5: C1 vs B4
        [ [0, 2], [3, 3] ], // Match 6: A2 vs D3
        [ [3, 1], [0, 4] ], // Match 7: D1 vs A4
        [ [1, 2], [2, 3] ], // Match 8: B2 vs C3
      ]);
    }

    if (k === 2 && r1Count >= 4) {
      // 8-Team Static Cross-Bracket — semifinals A1/B1 and C1/D1.
      return chart([
        [ [0, 1], [3, 2] ], // Match 1: A1 vs D2
        [ [1, 1], [2, 2] ], // Match 2: B1 vs C2
        [ [2, 1], [1, 2] ], // Match 3: C1 vs B2
        [ [3, 1], [0, 2] ], // Match 4: D1 vs A2
      ]);
    }

    if (k === 1 && r1Count >= 2) {
      // 4-Team Static Cross-Bracket. One match per half, so the pool winners
      // can't share one — A1 and B1 meet in the final here whatever the order.
      return chart([
        [ [0, 1], [3, 1] ], // Match 1: A1 vs D1
        [ [1, 1], [2, 1] ], // Match 2: B1 vs C1
      ]);
    }
  }

  // Fallback for general pool configurations: pool winners meet the runner-up
  // from the pool at the opposite end of the list.
  let idx = 0;
  for (let p = 0; p < pools && idx < r1Count; p++) {
    const opp = pools - 1 - p;
    slotsA[idx] = makeSlot(counts, p, 1);
    slotsB[idx] = makeSlot(counts, opp, 2) ?? makeSlot(counts, opp, 1);
    idx++;
  }
  return { slotsA, slotsB };
}

function getFivbCrossSlots(counts: number[], r1Count: number): CrossSides {
  const pools = counts.length;
  const slotsA: (CrossSlot | null)[] = Array(r1Count).fill(null);
  const slotsB: (CrossSlot | null)[] = Array(r1Count).fill(null);

  const placed = new Set<string>();
  const key = (s: CrossSlot | null) => (s ? `${s.pool}:${s.rank}` : '');
  const place = (side: (CrossSlot | null)[], idx: number, slot: CrossSlot | null) => {
    if (!slot || placed.has(key(slot))) return;
    side[idx] = slot;
    placed.add(key(slot));
  };

  for (let p = 0; p < pools; p++) {
    const matchIdx = Math.floor((p * r1Count) / pools);
    const crossedPool = (p + Math.floor(pools / 2)) % pools;
    if (slotsA[matchIdx] === null) place(slotsA, matchIdx, makeSlot(counts, p, 1));
    if (slotsB[matchIdx] === null) {
      place(slotsB, matchIdx, makeSlot(counts, crossedPool, 2) ?? makeSlot(counts, crossedPool, 1));
    }
  }

  // Fill any slot the crossing left empty with the advancing positions that
  // haven't been placed, pool by pool.
  const remaining: CrossSlot[] = [];
  counts.forEach((count, p) => {
    for (let rank = 1; rank <= count; rank++) {
      const slot = { pool: poolName(p), rank };
      if (!placed.has(key(slot))) remaining.push(slot);
    }
  });

  let remIdx = 0;
  for (let i = 0; i < r1Count; i++) {
    if (slotsA[i] === null && remIdx < remaining.length) slotsA[i] = remaining[remIdx++];
    if (slotsB[i] === null && remIdx < remaining.length) slotsB[i] = remaining[remIdx++];
  }

  return { slotsA, slotsB };
}

/* The advancing pool positions in seeding order, best first, for a bracket
   of `size`.

   Finishing rank is the only ranking available — nothing separates two pools'
   winners before they've played — so every winner outranks every runner-up,
   and so on. The winners are ordered by bracket geometry rather than
   alphabetically: pool i's winner takes the seed that lands it in the i-th
   section of the bracket, which is what puts A1 and B1 in one half and C1/D1
   in the other, the same arrangement the fixed charts draw.

   Each later rank then takes its block of seeds by keeping pool-mates apart:
   a team goes to whichever of its rank's seeds meets its own pool latest —
   A2 into the half A1 is not in, so the two can only meet in the final.
   Running each rank the opposite way round, which this used to do, gets
   that right for four pools and wrong for two: it put A2 in A1's half. That
   order is kept only to settle ties. */
function crossEntrants(counts: number[], size: number): CrossSlot[] {
  const pools = counts.length;
  let sectionSize = 1;
  while (sectionSize < pools) sectionSize *= 2;
  // sectionOrder[i] = the seed that sits in the bracket's i-th section.
  const sectionOrder = seedPlacement(sectionSize).filter(seed => seed <= pools);

  // positionOf[seed] = the bracket position (0-based) that seed is drawn into.
  const positionOf: number[] = [];
  seedPlacement(size).forEach((seed, pos) => { positionOf[seed] = pos; });
  // The round in which two bracket positions would meet: 1 = the opening
  // round, log2(size) = the final.
  const meetRound = (x: number, y: number) => 32 - Math.clz32(x ^ y);

  const bySeed: CrossSlot[] = [];
  const placed: number[][] = counts.map(() => []); // positions per pool
  const maxRank = Math.max(...counts, 0);
  for (let rank = 1; rank <= maxRank; rank++) {
    // This rank's pools, in the order the alternating geometry would seed them.
    const inRank = counts.map((_, p) => p).filter(p => rank <= counts[p]);
    const geometric = (p: number) => (rank % 2 === 1 ? sectionOrder[p] : sectionOrder[pools - 1 - p]);
    inRank.sort((a, b) => geometric(a) - geometric(b));

    const base = bySeed.length;
    const free = new Set(inRank.map((_, i) => base + i + 1));
    inRank.forEach((p, i) => {
      // How late this seed would meet the pool's own teams; later is better.
      const apart = (seed: number) =>
        Math.min(Infinity, ...placed[p].map(pos => meetRound(positionOf[seed], pos)));
      let best = base + i + 1;
      if (!free.has(best)) best = Math.min(...free);
      for (const seed of free) if (apart(seed) > apart(best)) best = seed;
      free.delete(best);
      bySeed[best - 1] = { pool: poolName(p), rank };
      placed[p].push(positionOf[best]);
    });
  }
  return bySeed;
}

/* Seeds the advancing pool positions into a `size` bracket exactly the way a
   pure single-elimination draw seeds teams: standard placement (seed 1 meets
   seed `size`, 2 meets `size − 1`, …). When the advancing count doesn't fill
   the bracket the empty seats are the bottom seeds, so — as in the pure draw —
   the byes land on the top seeds, i.e. the pool winners.

   Used whenever the fixed crossings have no answer: a field that isn't a
   power of two (they pair whole ranks against each other and assume every
   seat is taken), or a shape their charts don't cover — see crossBracket. */
function getSeededCrossSlots(counts: number[], size: number): CrossSides {
  const entrants = crossEntrants(counts, size);
  // field[position] = the pool position seeded there, or null for a bye.
  const field: (CrossSlot | null)[] = seedPlacement(size).map(seed => entrants[seed - 1] ?? null);

  // Two teams out of the same pool have already played each other, so avoid
  // opening the knockout with a rematch: swap one side with another pairing
  // where doing so leaves both pairings clash-free.
  //
  // Only positions that are already in a real pairing can be swapped with, and
  // an equal finishing rank is taken first — a swap must not move a bye or
  // hand one to a lower finisher, which is the whole point of the seeding.
  for (let i = 0; i < size / 2; i++) {
    const a = field[2 * i];
    const b = field[2 * i + 1];
    if (!a || !b || a.pool !== b.pool) continue;

    const canSwap = (k: number) => {
      if (k === 2 * i || k === 2 * i + 1) return false;
      const x = field[k];
      const partner = field[k % 2 === 0 ? k + 1 : k - 1];
      if (!x || !partner) return false; // never disturb a bye pairing
      return x.pool !== a.pool && partner.pool !== b.pool;
    };

    const positions = Array.from({ length: size }, (_, k) => k);
    const target =
      positions.find(k => canSwap(k) && field[k]!.rank === b.rank) ??
      positions.find(canSwap);
    if (target === undefined) continue;

    field[2 * i + 1] = field[target];
    field[target] = b;
  }

  const slotsA: (CrossSlot | null)[] = [];
  const slotsB: (CrossSlot | null)[] = [];
  for (let i = 0; i < size / 2; i++) {
    slotsA.push(field[2 * i]);
    slotsB.push(field[2 * i + 1]);
  }
  return { slotsA, slotsB };
}


/* A first round the bracket can actually be played from: every seat taken,
   and no pairing of two teams out of the same pool — they have met already.

   The fixed crossings only satisfy this for the shapes they were written for.
   FIVB crosses winners against runners-up and has nothing to say about a
   3rd or 4th place, which it used to drop into the leftover matches in pool
   order — A3 v A4, B3 v B4. The static charts exist for four pools only, and
   anywhere else left matches with nobody in them. */
function isPlayable({ slotsA, slotsB }: CrossSides, r1Count: number): boolean {
  for (let i = 0; i < r1Count; i++) {
    const a = slotsA[i];
    const b = slotsB[i];
    if (!a || !b || a.pool === b.pool) return false;
  }
  return true;
}

/* The knockout's first round for `counts[p]` teams advancing out of pool p.
 *
 * `size` is the bracket — the next power of two at or above the field — and
 * slotsA[i] v slotsB[i] is its i-th first-round match. A null seat is a bye.
 *
 * The organizer's crossing decides the pairings whenever it can draw them.
 * Where it can't (a field that doesn't fill the bracket, or a shape its
 * chart doesn't cover), the positions are seeded like any single-elimination
 * draw, which keeps pool-mates apart and the winners on opposite sides. */
export function crossBracket(crossing: string, counts: number[]): CrossSides & { size: number } {
  const total = counts.reduce((sum, c) => sum + c, 0);
  let size = 2;
  while (size < total) size *= 2;
  const r1Count = size / 2;

  if (total === size) {
    const crossed = crossing === 'static' ? getStaticCrossSlots(counts, r1Count) : getFivbCrossSlots(counts, r1Count);
    if (isPlayable(crossed, r1Count)) return { size, ...crossed };
  }
  return { size, ...getSeededCrossSlots(counts, size) };
}
