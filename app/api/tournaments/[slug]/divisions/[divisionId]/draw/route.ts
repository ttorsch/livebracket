import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';

// Persists the organizer's draw for one division: seed order on teams,
// draw configuration on divisions.settings.draw, and (optionally) the
// generated pool + knockout rounds and matches.
//
// Matches have no slot column, so the generated bracket's render order is
// recorded in settings.draw.slots as { [roundSequence]: matchId[] } — ids
// are generated here (not read back from the insert) so the mapping never
// depends on returned row order.

interface DrawBody {
  seedOrder: string[]; // team ids, index 0 = seed 1
  pools: number;
  advance: number;
  crossing: string;
  generate?: boolean;
  topSeedIds?: string[]; // organizer-picked top seeds, in order (subset of seedOrder)
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
    .select('id, settings, tournaments!inner(slug), teams(id, name, status), rounds(id, sequence, format, scoring_rules)')
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

function getStaticElimSlots(poolAdvancing: string[][], r1Count: number): { elimSlotsA: (string | null)[]; elimSlotsB: (string | null)[] } {
  const elimSlotsA: (string | null)[] = Array(r1Count).fill(null);
  const elimSlotsB: (string | null)[] = Array(r1Count).fill(null);
  const pools = poolAdvancing.length;

  if (pools === 4) {
    const k = Math.max(...poolAdvancing.map(p => p.length), 1);
    if (k === 4 && r1Count >= 8) {
      // 16-Team Static Cross-Bracket (A1-D4, C2-B3, B1-C4, D2-A3, C1-B4, A2-D3, D1-A4, B2-C3)
      const pairs: [[number, number], [number, number]][] = [
        [ [0, 0], [3, 3] ], // Match 1: A1 vs D4
        [ [2, 1], [1, 2] ], // Match 2: C2 vs B3
        [ [1, 0], [2, 3] ], // Match 3: B1 vs C4
        [ [3, 1], [0, 2] ], // Match 4: D2 vs A3
        [ [2, 0], [1, 3] ], // Match 5: C1 vs B4
        [ [0, 1], [3, 2] ], // Match 6: A2 vs D3
        [ [3, 0], [0, 3] ], // Match 7: D1 vs A4
        [ [1, 1], [2, 2] ], // Match 8: B2 vs C3
      ];
      pairs.forEach(([a, b], idx) => {
        elimSlotsA[idx] = poolAdvancing[a[0]]?.[a[1]] ?? null;
        elimSlotsB[idx] = poolAdvancing[b[0]]?.[b[1]] ?? null;
      });
      return { elimSlotsA, elimSlotsB };
    }

    if (k === 2 && r1Count >= 4) {
      // 8-Team Static Cross-Bracket (A1-D2, C1-B2, B1-C2, D1-A2)
      const pairs: [[number, number], [number, number]][] = [
        [ [0, 0], [3, 1] ], // Match 1: A1 vs D2
        [ [2, 0], [1, 1] ], // Match 2: C1 vs B2
        [ [1, 0], [2, 1] ], // Match 3: B1 vs C2
        [ [3, 0], [0, 1] ], // Match 4: D1 vs A2
      ];
      pairs.forEach(([a, b], idx) => {
        elimSlotsA[idx] = poolAdvancing[a[0]]?.[a[1]] ?? null;
        elimSlotsB[idx] = poolAdvancing[b[0]]?.[b[1]] ?? null;
      });
      return { elimSlotsA, elimSlotsB };
    }

    if (k === 1 && r1Count >= 2) {
      // 4-Team Static Cross-Bracket (A1-D1, B1-C1)
      const pairs: [[number, number], [number, number]][] = [
        [ [0, 0], [3, 0] ], // Match 1: A1 vs D1
        [ [1, 0], [2, 0] ], // Match 2: B1 vs C1
      ];
      pairs.forEach(([a, b], idx) => {
        elimSlotsA[idx] = poolAdvancing[a[0]]?.[a[1]] ?? null;
        elimSlotsB[idx] = poolAdvancing[b[0]]?.[b[1]] ?? null;
      });
      return { elimSlotsA, elimSlotsB };
    }
  }

  // Fallback for general pool configurations
  let idx = 0;
  for (let p = 0; p < pools; p++) {
    const opp = pools - 1 - p;
    const teamA = poolAdvancing[p]?.[0] ?? null;
    const teamB = poolAdvancing[opp]?.[1] ?? poolAdvancing[opp]?.[0] ?? null;
    if (idx < r1Count) {
      elimSlotsA[idx] = teamA;
      elimSlotsB[idx] = teamB;
      idx++;
    }
  }
  return { elimSlotsA, elimSlotsB };
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  const body = (await request.json()) as DrawBody;

  const pools = Math.max(1, Math.min(8, Math.trunc(body.pools) || 1));
  const advance = Math.max(1, Math.min(4, Math.trunc(body.advance) || 1));
  const crossing = typeof body.crossing === 'string' ? body.crossing : 'fivb';

  let division;
  try {
    division = await getDivision(slug, divisionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });

  const confirmedTeams = division.teams.filter(t => t.status !== 'waitlist');
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

    // Knockout field: pad to the next power of two
    let size = 2;
    while (size < seedOrder.length) size *= 2;
    const stages = Math.log2(size);

    const roundRows = hasRoundRobin
      ? [
          { id: randomUUID(), division_id: divisionId, sequence: 1, format: 'round-robin', name: 'Round Robin', scoring_rules: poolRules },
          ...(hasElimRound
            ? Array.from({ length: stages }, (_, s) => ({
                id: randomUUID(),
                division_id: divisionId,
                sequence: s + 2,
                format: 'single',
                name: stageName(size >> s),
                scoring_rules: elimRules,
              }))
            : []),
        ]
      : Array.from({ length: stages }, (_, s) => ({
          id: randomUUID(),
          division_id: divisionId,
          sequence: s + 1,
          format: 'single',
          name: stageName(size >> s),
          scoring_rules: elimRules,
        }));

    const { error: rError } = await supabaseAdmin.from('rounds').insert(roundRows);
    if (rError) return NextResponse.json({ error: `Failed to create rounds: ${rError.message}` }, { status: 500 });

    const matches: MatchInsert[] = [];

    if (hasRoundRobin) {
      // Pool play: round robin within each serpentine-assigned pool.
      const poolRound = roundRows[0];
      slots['1'] = [];
      for (const pool of assignPools(seedOrder, pools)) {
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

      if (hasElimRound) {
        const poolList = assignPools(seedOrder, pools);
        const advancingPerPool = Math.max(1, Math.min(4, advance));

        // Gather advancing team IDs per pool in rank order
        const poolAdvancing: string[][] = poolList.map(p => p.slice(0, advancingPerPool));
        const totalAdvancing = poolAdvancing.reduce((sum, p) => sum + p.length, 0);

        let elimSize = 2;
        while (elimSize < totalAdvancing) elimSize *= 2;
        const elimStages = Math.log2(elimSize);
        const r1Count = elimSize / 2;

        let elimSlotsA: (string | null)[];
        let elimSlotsB: (string | null)[];

        if (crossing === 'static') {
          const res = getStaticElimSlots(poolAdvancing, r1Count);
          elimSlotsA = res.elimSlotsA;
          elimSlotsB = res.elimSlotsB;
        } else {
          // Standard / FIVB Crossing
          elimSlotsA = Array(r1Count).fill(null);
          elimSlotsB = Array(r1Count).fill(null);
          for (let p = 0; p < pools; p++) {
            const matchIdx = Math.floor((p * r1Count) / pools);
            const crossedPoolIdx = (p + Math.floor(pools / 2)) % pools;

            if (elimSlotsA[matchIdx] === null) {
              elimSlotsA[matchIdx] = poolAdvancing[p]?.[0] ?? null;
            }
            if (elimSlotsB[matchIdx] === null) {
              elimSlotsB[matchIdx] = poolAdvancing[crossedPoolIdx]?.[1] ?? poolAdvancing[crossedPoolIdx]?.[0] ?? null;
            }
          }

          // Fill any remaining empty slots with unassigned advancing teams
          const allAdvancingFlat = poolAdvancing.flat();
          const placedSet = new Set([...elimSlotsA, ...elimSlotsB].filter(Boolean));
          const remainingAdvancing = allAdvancingFlat.filter(id => !placedSet.has(id));

          let remIdx = 0;
          for (let i = 0; i < r1Count; i++) {
            if (elimSlotsA[i] === null && remIdx < remainingAdvancing.length) {
              elimSlotsA[i] = remainingAdvancing[remIdx++];
            }
            if (elimSlotsB[i] === null && remIdx < remainingAdvancing.length) {
              elimSlotsB[i] = remainingAdvancing[remIdx++];
            }
          }
        }

        // Create Round 1 of Knockout (sequence 2)
        const r1ElimRound = roundRows[1];
        slots['2'] = [];
        for (let i = 0; i < r1Count; i++) {
          const id = randomUUID();
          matches.push({
            id,
            round_id: r1ElimRound.id,
            division_id: divisionId,
            team_a_id: elimSlotsA[i],
            team_b_id: elimSlotsB[i],
            winner_team_id: null,
            status: 'upcoming',
          });
          slots['2'].push(id);
        }

        // Create remaining knockout stages (sequence 3, 4...)
        let mCount = r1Count / 2;
        for (let s = 1; s < elimStages; s++) {
          const round = roundRows[s + 1];
          if (!round) break;
          const seq = String(s + 2);
          slots[seq] = [];
          for (let i = 0; i < mCount; i++) {
            const id = randomUUID();
            matches.push({
              id, round_id: round.id, division_id: divisionId,
              team_a_id: null, team_b_id: null, winner_team_id: null, status: 'upcoming',
            });
            slots[seq].push(id);
          }
          mCount /= 2;
        }
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
    }

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
    attempts: body.generate ? prevAttempts + 1 : prevAttempts,
    topSeedIds,
    slots: body.generate ? slots : (prevDraw.slots ?? {}),
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
