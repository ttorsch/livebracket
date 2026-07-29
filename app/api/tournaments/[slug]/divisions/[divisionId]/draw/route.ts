import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';
import type { CrossSlot } from '../../../../../../../lib/data';

// Persists the organizer's draw for one division: seed order on teams,
// draw configuration on divisions.settings.draw, and (optionally) the
// generated pool + knockout rounds and matches.
//
// Matches have no slot column, so the generated bracket's render order is
// recorded in settings.draw.slots as { [roundSequence]: matchId[] } — ids
// are generated here (not read back from the insert) so the mapping never
// depends on returned row order.
//
// Two write modes:
//   mode 'draw' (default) — the full draw: seeds, pools and (optionally) the
//     whole bracket, regenerated from scratch.
//   mode 'crossing' — bracket crossing only: pools, their matches and the
//     seeds are left exactly as they are; just the knockout rounds are
//     rebuilt from the new advance/crossing config.

interface DrawBody {
  seedOrder: string[]; // team ids, index 0 = seed 1
  pools: number;
  advance: number;
  crossing: string;
  generate?: boolean;
  topSeedIds?: string[]; // organizer-picked top seeds, in order (subset of seedOrder)
  mode?: 'draw' | 'crossing';
  thirdPlace?: boolean; // play off for 3rd between the beaten semifinalists
}

interface MatchInsert {
  id: string;
  round_id: string;
  division_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  status: 'upcoming' | 'live' | 'done';
}

async function getDivision(slug: string, divisionId: string) {
  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select('id, settings, tournaments!inner(slug), teams(id, name, seed, status), rounds(id, sequence, format, scoring_rules)')
    .eq('id', divisionId)
    .eq('tournaments.slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function stageName(fieldSize: number): string {
  if (fieldSize === 2) return 'Final';
  if (fieldSize === 4) return 'Semifinals';
  if (fieldSize === 8) return 'Quarterfinals';
  return `Round of ${fieldSize}`;
}

// Serpentine distribution of seed-ordered team ids into `pools` pools.
function assignPools(teamIds: string[], pools: number): string[][] {
  const out: string[][] = Array.from({ length: pools }, () => []);
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / pools);
    const col = i % pools;
    out[row % 2 === 0 ? col : pools - 1 - col].push(id);
  });
  return out.filter(p => p.length > 0);
}

// Standard bracket seed placement for a field of `size` (power of two):
// returns an array where index = bracket position (0-based) and value = the
// seed rank (1-based) that belongs there. Adjacent pairs are round-1 matches,
// so seed 1 and 2 sit at opposite ends, 3 and 4 at the quarter points, etc.
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

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Round-1 knockout slots are drawn as pool positions (CrossSlot), not teams:
// pool play hasn't happened yet when the bracket is generated, so the matches
// are created with no team ids and read as "#1 Pool A" until the pools decide.

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function poolName(index: number): string {
  return POOL_LETTERS[index] ?? String(index + 1);
}

// `counts[p]` = how many teams pool p sends into the knockout. A position no
// pool can fill (rank beyond that pool's advancing count) resolves to null.
function makeSlot(counts: number[], pool: number, rank: number): CrossSlot | null {
  return rank <= (counts[pool] ?? 0) ? { pool: poolName(pool), rank } : null;
}

function getStaticCrossSlots(counts: number[], r1Count: number): { slotsA: (CrossSlot | null)[]; slotsB: (CrossSlot | null)[] } {
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

function getFivbCrossSlots(counts: number[], r1Count: number): { slotsA: (CrossSlot | null)[]; slotsB: (CrossSlot | null)[] } {
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

/* The advancing pool positions in seeding order, best first.

   Finishing rank is the only ranking available — nothing separates two pools'
   winners before they've played — so every winner outranks every runner-up,
   and so on. Within a rank the pools are ordered by bracket geometry rather
   than alphabetically: pool i's winner takes the seed that lands it in the
   i-th section of the bracket, which is what puts A1 and B1 in one half and
   C1/D1 in the other, the same arrangement the fixed charts draw. Each
   following rank runs the pools in the opposite direction, so a pool's
   runner-up is drawn against a winner from the far side of the bracket. */
function crossEntrants(counts: number[]): CrossSlot[] {
  const pools = counts.length;
  let sectionSize = 1;
  while (sectionSize < pools) sectionSize *= 2;
  // sectionOrder[i] = the seed that sits in the bracket's i-th section.
  const sectionOrder = seedPlacement(sectionSize).filter(seed => seed <= pools);

  const bySeed: (CrossSlot | null)[] = [];
  const maxRank = Math.max(...counts, 0);
  for (let rank = 1; rank <= maxRank; rank++) {
    counts.forEach((count, p) => {
      if (rank > count) return;
      const order = rank % 2 === 1 ? sectionOrder[p] : sectionOrder[pools - 1 - p];
      bySeed[(rank - 1) * pools + order - 1] = { pool: poolName(p), rank };
    });
  }

  // Uneven pools leave gaps mid-list (a short pool sends no 3rd place, say).
  // Closing them keeps the seeding order intact and puts every empty seat at
  // the bottom, where byes belong.
  return bySeed.filter((slot): slot is CrossSlot => !!slot);
}

/* Seeds the advancing pool positions into a `size` bracket exactly the way a
   pure single-elimination draw seeds teams: standard placement (seed 1 meets
   seed `size`, 2 meets `size − 1`, …). When the advancing count doesn't fill
   the bracket the empty seats are the bottom seeds, so — as in the pure draw —
   the byes land on the top seeds, i.e. the pool winners.

   Used whenever the field isn't a power of two, where the fixed crossing
   charts have no answer: they pair whole ranks against each other and assume
   every seat is taken. */
function getSeededCrossSlots(counts: number[], size: number): { slotsA: (CrossSlot | null)[]; slotsB: (CrossSlot | null)[] } {
  const entrants = crossEntrants(counts);
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

function getCrossSlots(crossing: string, counts: number[], r1Count: number) {
  return crossing === 'static' ? getStaticCrossSlots(counts, r1Count) : getFivbCrossSlots(counts, r1Count);
}

interface RoundInsert {
  id: string;
  division_id: string;
  sequence: number;
  format: string;
  name: string;
  scoring_rules: unknown;
}

interface KnockoutBuild {
  roundRows: RoundInsert[];
  matches: MatchInsert[];
  slots: Record<string, string[]>;
  // Round-1 pool positions, per match id — what the bracket shows until the
  // pools have been played.
  crossSlots: Record<string, { a: CrossSlot | null; b: CrossSlot | null }>;
  // Matches drawn from the *losers* of other matches, per match id. Only the
  // 3rd-place play-off works this way, and it is the one edge in the whole
  // bracket that a halving tree cannot express — every other match is fed by
  // winners, which the round structure already implies.
  loserFeeders: Record<string, [string, string]>;
}

/* The play-off for 3rd, appended as its own round after the final.
 *
 * It is last in sequence rather than sitting between the semifinals and the
 * final because the bracket is drawn as a halving tree: a round of one match
 * wedged in front of the final would have the tree connect the wrong matches.
 * Being last keeps the tree honest and leaves the final's feeders untouched;
 * the schedule decides when it is actually *played*, which is before the final.
 *
 * Needs a semifinal round to draw from, so a two-team knockout gets nothing. */
function appendThirdPlace(opts: {
  divisionId: string;
  roundRows: RoundInsert[];
  matches: MatchInsert[];
  slots: Record<string, string[]>;
  loserFeeders: Record<string, [string, string]>;
  /** Sequence of the semifinal round — the round before the final. */
  semiSequence: number;
  /** Sequence to give the new round; must be free. */
  sequence: number;
  scoringRules: unknown;
}): void {
  const { divisionId, roundRows, matches, slots, loserFeeders, semiSequence, sequence, scoringRules } = opts;
  const semis = slots[String(semiSequence)] ?? [];
  if (semis.length !== 2) return;

  const round: RoundInsert = {
    id: randomUUID(),
    division_id: divisionId,
    sequence,
    format: 'single',
    name: '3rd Place',
    scoring_rules: scoringRules,
  };
  const id = randomUUID();
  roundRows.push(round);
  matches.push({
    id, round_id: round.id, division_id: divisionId,
    team_a_id: null, team_b_id: null, winner_team_id: null, status: 'upcoming',
  });
  slots[String(sequence)] = [id];
  loserFeeders[id] = [semis[0], semis[1]];
}

/* Builds the knockout stage that follows pool play: rounds sized to the teams
   advancing out of the pools, and round-1 matches drawn as pool positions
   (no teams — nothing has been played yet). */
function buildKnockout(opts: {
  divisionId: string;
  poolSizes: number[];
  advance: number;
  crossing: string;
  scoringRules: unknown;
  startSequence: number;
  thirdPlace: boolean;
}): KnockoutBuild {
  const { divisionId, poolSizes, advance, crossing, scoringRules, startSequence, thirdPlace } = opts;

  const counts = poolSizes.map(size => Math.min(advance, size));
  const totalAdvancing = counts.reduce((sum, c) => sum + c, 0);

  let elimSize = 2;
  while (elimSize < totalAdvancing) elimSize *= 2;
  const elimStages = Math.log2(elimSize);
  const r1Count = elimSize / 2;

  const roundRows: RoundInsert[] = Array.from({ length: elimStages }, (_, s) => ({
    id: randomUUID(),
    division_id: divisionId,
    sequence: startSequence + s,
    format: 'single',
    name: stageName(elimSize >> s),
    scoring_rules: scoringRules,
  }));

  const matches: MatchInsert[] = [];
  const slots: Record<string, string[]> = {};
  const crossSlots: KnockoutBuild['crossSlots'] = {};
  const loserFeeders: KnockoutBuild['loserFeeders'] = {};

  // The fixed crossing charts pair whole ranks against each other, so they
  // only answer a field that fills the bracket. Anything else (5 pools, 3 per
  // pool, a short pool) is drawn by seeding the positions and letting the
  // spare seats fall out as byes.
  const { slotsA, slotsB } = totalAdvancing === elimSize
    ? getCrossSlots(crossing, counts, r1Count)
    : getSeededCrossSlots(counts, elimSize);

  // A pairing with one position and one empty seat is a bye: the match is
  // settled before it starts and the position it holds carries straight into
  // the next round (round-1 match i feeds round-2 match ⌊i/2⌋, side A when i
  // is even else side B).
  const r2Slots: { a: CrossSlot | null; b: CrossSlot | null }[] =
    Array.from({ length: r1Count / 2 }, () => ({ a: null, b: null }));

  const r1Seq = String(startSequence);
  slots[r1Seq] = [];
  for (let i = 0; i < r1Count; i++) {
    const a = slotsA[i] ?? null;
    const b = slotsB[i] ?? null;
    const isBye = (a === null) !== (b === null);
    const id = randomUUID();
    matches.push({
      id, round_id: roundRows[0].id, division_id: divisionId,
      team_a_id: null, team_b_id: null, winner_team_id: null,
      status: isBye ? 'done' : 'upcoming',
    });
    slots[r1Seq].push(id);
    crossSlots[id] = { a, b };
    if (isBye) {
      const next = r2Slots[Math.floor(i / 2)];
      if (next) next[i % 2 === 0 ? 'a' : 'b'] = a ?? b;
    }
  }

  let mCount = r1Count / 2;
  for (let s = 1; s < elimStages; s++) {
    const seq = String(startSequence + s);
    slots[seq] = [];
    for (let i = 0; i < mCount; i++) {
      const id = randomUUID();
      matches.push({
        id, round_id: roundRows[s].id, division_id: divisionId,
        team_a_id: null, team_b_id: null, winner_team_id: null, status: 'upcoming',
      });
      slots[seq].push(id);
      // Round 2 shows the positions that walked through on a bye.
      const advanced = s === 1 ? r2Slots[i] : null;
      if (advanced && (advanced.a || advanced.b)) crossSlots[id] = advanced;
    }
    mCount /= 2;
  }

  if (thirdPlace && elimStages >= 2) {
    appendThirdPlace({
      divisionId, roundRows, matches, slots, loserFeeders,
      semiSequence: startSequence + elimStages - 2,
      sequence: startSequence + elimStages,
      scoringRules,
    });
  }

  return { roundRows, matches, slots, crossSlots, loserFeeders };
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  const body = (await request.json()) as DrawBody;

  const pools = Math.max(1, Math.min(8, Math.trunc(body.pools) || 1));
  const advance = Math.max(1, Math.min(4, Math.trunc(body.advance) || 1));
  const crossing = typeof body.crossing === 'string' ? body.crossing : 'fivb';
  const wantsThirdPlace = body.thirdPlace === true;

  let division;
  try {
    division = await getDivision(slug, divisionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });

  const confirmedTeams = division.teams.filter(t => t.status !== 'waitlist');

  // Crossing only: the pools have already been drawn and must stay exactly as
  // they are — seeds, pool round and pool matches are all left alone. Only the
  // knockout rounds hanging off them are rebuilt for the new config.
  if (body.mode === 'crossing') {
    const settings = (division.settings ?? {}) as Record<string, unknown>;
    const prevDraw = (settings.draw ?? {}) as Record<string, unknown>;

    const prevRounds = division.rounds ?? [];
    const poolRound = prevRounds.find(r => r.format === 'round-robin');
    if (!poolRound) {
      return NextResponse.json({ error: 'This division has no pool round — draw the pools first' }, { status: 400 });
    }
    const elimRounds = prevRounds.filter(r => r.format === 'single' || r.format === 'double');
    if (elimRounds.length === 0) {
      return NextResponse.json({ error: 'This division has no knockout round to apply a crossing to' }, { status: 400 });
    }

    // Pool composition comes from the seeds already on the teams, so it
    // reproduces the pools that were drawn rather than drawing new ones.
    const poolCount = typeof prevDraw.pools === 'number' ? prevDraw.pools : pools;
    const seededOrder = [...confirmedTeams].sort((a, b) => a.seed - b.seed).map(t => t.id);
    const poolList = assignPools(seededOrder, poolCount);

    const knockout = buildKnockout({
      divisionId,
      poolSizes: poolList.map(p => p.length),
      advance,
      crossing,
      scoringRules: elimRounds[0].scoring_rules ?? {},
      startSequence: poolRound.sequence + 1,
      thirdPlace: typeof body.thirdPlace === 'boolean' ? body.thirdPlace : prevDraw.thirdPlace === true,
    });

    const elimRoundIds = elimRounds.map(r => r.id);
    const { error: mDelError } = await supabaseAdmin.from('matches').delete().in('round_id', elimRoundIds);
    if (mDelError) return NextResponse.json({ error: `Failed to clear knockout matches: ${mDelError.message}` }, { status: 500 });
    const { error: rDelError } = await supabaseAdmin.from('rounds').delete().in('id', elimRoundIds);
    if (rDelError) return NextResponse.json({ error: `Failed to clear knockout rounds: ${rDelError.message}` }, { status: 500 });

    const { error: rInsError } = await supabaseAdmin.from('rounds').insert(knockout.roundRows);
    if (rInsError) return NextResponse.json({ error: `Failed to create knockout rounds: ${rInsError.message}` }, { status: 500 });
    const { error: mInsError } = await supabaseAdmin.from('matches').insert(knockout.matches);
    if (mInsError) return NextResponse.json({ error: `Failed to create knockout matches: ${mInsError.message}` }, { status: 500 });

    // Keep the pool round's slot order; swap in the new knockout ordering.
    const prevSlots = (prevDraw.slots ?? {}) as Record<string, string[]>;
    const poolSeq = String(poolRound.sequence);
    const nextSlots: Record<string, string[]> = {
      ...(prevSlots[poolSeq] ? { [poolSeq]: prevSlots[poolSeq] } : {}),
      ...knockout.slots,
    };

    const draw = {
      ...prevDraw,
      pools: poolCount,
      advance,
      crossing,
      thirdPlace: typeof body.thirdPlace === 'boolean' ? body.thirdPlace : prevDraw.thirdPlace === true,
      slots: nextSlots,
      crossSlots: knockout.crossSlots,
      loserFeeders: knockout.loserFeeders,
    };
    const { error: sError } = await supabaseAdmin
      .from('divisions')
      .update({ settings: { ...settings, draw } })
      .eq('id', divisionId);
    if (sError) return NextResponse.json({ error: `Failed to save crossing config: ${sError.message}` }, { status: 500 });

    return NextResponse.json({ ok: true, generated: true, mode: 'crossing' });
  }

  const teamIdSet = new Set(confirmedTeams.map(t => t.id));
  const seedOrder = (body.seedOrder ?? []).filter(id => teamIdSet.has(id));
  if (seedOrder.length !== teamIdSet.size || new Set(seedOrder).size !== seedOrder.length) {
    return NextResponse.json({ error: 'seedOrder must list every confirmed team in the division exactly once' }, { status: 400 });
  }
  if (body.generate && seedOrder.length < 2) {
    return NextResponse.json({ error: 'At least two teams are required to generate a bracket' }, { status: 400 });
  }

  // 1. Persist seeds.
  for (let i = 0; i < seedOrder.length; i++) {
    const { error } = await supabaseAdmin.from('teams').update({ seed: i + 1 }).eq('id', seedOrder[i]);
    if (error) return NextResponse.json({ error: `Failed to save seeds: ${error.message}` }, { status: 500 });
  }

  const slots: Record<string, string[]> = {};
  let crossSlots: KnockoutBuild['crossSlots'] = {};
  let loserFeeders: KnockoutBuild['loserFeeders'] = {};

  // 2. Optionally regenerate rounds and matches.
  if (body.generate) {
    // Carry each format's scoring rules over from the rounds configured in setup.
    const prevRounds = division.rounds ?? [];
    const poolRules = prevRounds.find(r => r.format === 'round-robin')?.scoring_rules ?? {};
    const elimRules = prevRounds.find(r => r.format === 'single' || r.format === 'double')?.scoring_rules ?? {};

    const { error: delError } = await supabaseAdmin.from('rounds').delete().eq('division_id', divisionId);
    if (delError) return NextResponse.json({ error: `Failed to clear rounds: ${delError.message}` }, { status: 500 });

    const hasRoundRobin = prevRounds.some(r => r.format === 'round-robin');
    const hasElimRound = prevRounds.some(r => r.format === 'single' || r.format === 'double');

    const matches: MatchInsert[] = [];
    let roundRows: RoundInsert[];

    if (hasRoundRobin) {
      // Pool play: round robin within each serpentine-assigned pool.
      const poolList = assignPools(seedOrder, pools);
      const poolRound: RoundInsert = {
        id: randomUUID(), division_id: divisionId, sequence: 1,
        format: 'round-robin', name: 'Round Robin', scoring_rules: poolRules,
      };
      const knockout = hasElimRound
        ? buildKnockout({
            divisionId,
            poolSizes: poolList.map(p => p.length),
            advance,
            crossing,
            scoringRules: elimRules,
            startSequence: 2,
            thirdPlace: wantsThirdPlace,
          })
        : null;
      roundRows = [poolRound, ...(knockout?.roundRows ?? [])];

      slots['1'] = [];
      for (const pool of poolList) {
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            const id = randomUUID();
            matches.push({
              id, round_id: poolRound.id, division_id: divisionId,
              team_a_id: pool[i], team_b_id: pool[j], winner_team_id: null, status: 'upcoming',
            });
            slots['1'].push(id);
          }
        }
      }

      if (knockout) {
        matches.push(...knockout.matches);
        Object.assign(slots, knockout.slots);
        crossSlots = knockout.crossSlots;
        loserFeeders = knockout.loserFeeders;
      }
    } else {
      // Pure Elimination (No Pool Play): draw round-1 matches directly.
      //
      // Top seeds are all one rank — there is no "seed 1 / seed 2". Placement:
      //  1. The bracket has a fixed set of "spread anchor" positions, ordered
      //     most-spread first (opposite ends, then quarters, …). This is pure
      //     bracket geometry, not a ranking of teams.
      //  2. The top seeds are dropped into the most-spread anchors in RANDOM
      //     order (they're interchangeable), so they end up as far apart as
      //     possible. Everyone else is drawn randomly into the rest.
      //  3. The field is padded to the next power of two; the `size − N` byes
      //     fall on the most-spread anchors, which the top seeds hold — so the
      //     top seeds receive the byes (a random subset of them when there are
      //     more top seeds than byes), and any leftover byes go to random
      //     unseeded teams.
      const topSeedIds = Array.isArray(body.topSeedIds)
        ? body.topSeedIds.filter(id => teamIdSet.has(id))
        : [];
      const topSeedSet = new Set(topSeedIds);
      const unseededIds = seedOrder.filter(id => !topSeedSet.has(id));

      // Knockout field: pad to the next power of two.
      let size = 2;
      while (size < seedOrder.length) size *= 2;
      const stages = Math.log2(size);

      roundRows = Array.from({ length: stages }, (_, s) => ({
        id: randomUUID(),
        division_id: divisionId,
        sequence: s + 1,
        format: 'single',
        name: stageName(size >> s),
        scoring_rules: elimRules,
      }));

      // Draw order: top seeds (shuffled — no rank among them), then the rest
      // (also shuffled). Nothing here privileges one top seed over another.
      const drawOrder = [...shuffle(topSeedIds), ...shuffle(unseededIds)];

      // Spread-anchor positions, most-spread first (bracket geometry only).
      const placement = seedPlacement(size); // placement[pos] = spread order (1-based)
      const spreadPositions: number[] = Array(size + 1).fill(-1);
      placement.forEach((order, pos) => { spreadPositions[order] = pos; });

      const r1TeamSlots: (string | null)[] = Array(size).fill(null);
      drawOrder.forEach((id, i) => {
        r1TeamSlots[spreadPositions[i + 1]] = id; // i-th team → i-th most-spread anchor
      });

      // Create Round 1 matches. A pairing with exactly one team is a bye:
      // record it as completed with that team as the winner, and pre-advance
      // that team into its round-2 slot (round-1 match i feeds round-2 match
      // ⌊i/2⌋, side A if i is even else B).
      const r1MatchCount = size / 2;
      const r1Round = roundRows[0];
      const r2TeamSlots: (string | null)[] = Array(r1MatchCount).fill(null);
      slots['1'] = [];
      for (let i = 0; i < r1MatchCount; i++) {
        const a = r1TeamSlots[i * 2];
        const b = r1TeamSlots[i * 2 + 1];
        const isBye = (a === null) !== (b === null);
        const id = randomUUID();
        matches.push({
          id,
          round_id: r1Round.id,
          division_id: divisionId,
          team_a_id: a,
          team_b_id: b,
          winner_team_id: isBye ? (a ?? b) : null,
          status: isBye ? 'done' : 'upcoming',
        });
        slots['1'].push(id);
        if (isBye) r2TeamSlots[i] = a ?? b; // advances to round 2
      }

      // Create subsequent knockout rounds. Round 2 is pre-filled with any
      // teams that advanced on a bye; later rounds start empty.
      let matchCount = r1MatchCount / 2;
      for (let s = 1; s < stages; s++) {
        const round = roundRows[s];
        const seq = String(s + 1);
        slots[seq] = [];
        for (let i = 0; i < matchCount; i++) {
          const id = randomUUID();
          const teamA = s === 1 ? r2TeamSlots[i * 2] : null;
          const teamB = s === 1 ? r2TeamSlots[i * 2 + 1] : null;
          matches.push({
            id, round_id: round.id, division_id: divisionId,
            team_a_id: teamA, team_b_id: teamB, winner_team_id: null, status: 'upcoming',
          });
          slots[seq].push(id);
        }
        matchCount /= 2;
      }

      if (wantsThirdPlace && stages >= 2) {
        appendThirdPlace({
          divisionId, roundRows, matches, slots, loserFeeders,
          semiSequence: stages - 1,   // rounds are 1-based here; the final is `stages`
          sequence: stages + 1,
          scoringRules: elimRules,
        });
      }
    }

    const { error: rError } = await supabaseAdmin.from('rounds').insert(roundRows);
    if (rError) return NextResponse.json({ error: `Failed to create rounds: ${rError.message}` }, { status: 500 });

    const { error: mError } = await supabaseAdmin.from('matches').insert(matches);
    if (mError) return NextResponse.json({ error: `Failed to create matches: ${mError.message}` }, { status: 500 });
  }

  // 3. Merge draw config into division settings (preserving setup-page keys).
  const settings = (division.settings ?? {}) as Record<string, unknown>;
  const prevDraw = (settings.draw ?? {}) as Record<string, unknown>;
  const prevAttempts = typeof prevDraw.attempts === 'number' ? prevDraw.attempts : 0;
  const topSeedIds = Array.isArray(body.topSeedIds) ? body.topSeedIds.filter(id => teamIdSet.has(id)) : (prevDraw.topSeedIds ?? []);
  const draw = {
    pools, advance, crossing,
    thirdPlace: typeof body.thirdPlace === 'boolean' ? body.thirdPlace : prevDraw.thirdPlace === true,
    attempts: body.generate ? prevAttempts + 1 : prevAttempts,
    topSeedIds,
    slots: body.generate ? slots : (prevDraw.slots ?? {}),
    crossSlots: body.generate ? crossSlots : (prevDraw.crossSlots ?? {}),
    loserFeeders: body.generate ? loserFeeders : (prevDraw.loserFeeders ?? {}),
  };
  const { error: sError } = await supabaseAdmin
    .from('divisions')
    .update({ settings: { ...settings, draw } })
    .eq('id', divisionId);
  if (sError) return NextResponse.json({ error: `Failed to save draw config: ${sError.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, generated: !!body.generate });
}

interface PatchDrawBody {
  topSeedIds?: string[];
  isLocked?: boolean;
}

// Lightweight autosave for top seeds and lock state
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  const body = (await request.json()) as PatchDrawBody;

  let division;
  try {
    division = await getDivision(slug, divisionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });

  const confirmedIds = new Set(division.teams.filter(t => t.status !== 'waitlist').map(t => t.id));
  const settings = (division.settings ?? {}) as Record<string, unknown>;
  const prevDraw = (settings.draw ?? {}) as Record<string, unknown>;

  const draw = {
    ...prevDraw,
    ...(Array.isArray(body.topSeedIds) ? { topSeedIds: body.topSeedIds.filter(id => confirmedIds.has(id)) } : {}),
    ...(typeof body.isLocked === 'boolean' ? { isLocked: body.isLocked } : {}),
  };

  const { error } = await supabaseAdmin.from('divisions').update({ settings: { ...settings, draw } }).eq('id', divisionId);
  if (error) return NextResponse.json({ error: `Failed to update draw settings: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
