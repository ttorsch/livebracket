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
    const poolRules = prevRounds.find(r => r.format === 'pool' || r.format === 'round-robin')?.scoring_rules ?? {};
    const elimRules = prevRounds.find(r => r.format === 'single' || r.format === 'double')?.scoring_rules ?? {};

    const { error: delError } = await supabaseAdmin.from('rounds').delete().eq('division_id', divisionId);
    if (delError) return NextResponse.json({ error: `Failed to clear rounds: ${delError.message}` }, { status: 500 });

    // Knockout field: pad to the next power of two; byes sit at the bottom seeds.
    let size = 2;
    while (size < seedOrder.length) size *= 2;
    const stages = Math.log2(size);

    const roundRows = [
      { id: randomUUID(), division_id: divisionId, sequence: 1, format: 'pool', name: 'Pool Play', scoring_rules: poolRules },
      ...Array.from({ length: stages }, (_, s) => ({
        id: randomUUID(),
        division_id: divisionId,
        sequence: s + 2,
        format: 'single',
        name: stageName(size >> s),
        scoring_rules: elimRules,
      })),
    ];
    const { error: rError } = await supabaseAdmin.from('rounds').insert(roundRows);
    if (rError) return NextResponse.json({ error: `Failed to create rounds: ${rError.message}` }, { status: 500 });

    const matches: MatchInsert[] = [];

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

    // Knockout: empty placeholders only. Pairings depend on pool standings,
    // which aren't known until pool play finishes, so nothing is seeded here.
    let matchCount = size / 2;
    for (let s = 0; s < stages; s++) {
      const round = roundRows[s + 1];
      const seq = String(s + 2);
      slots[seq] = [];
      for (let i = 0; i < matchCount; i++) {
        const id = randomUUID();
        matches.push({
          id, round_id: round.id, division_id: divisionId,
          team_a_id: null, team_b_id: null, winner_team_id: null, status: 'upcoming',
        });
        slots[seq].push(id);
      }
      matchCount /= 2;
    }

    const { error: mError } = await supabaseAdmin.from('matches').insert(matches);
    if (mError) return NextResponse.json({ error: `Failed to create matches: ${mError.message}` }, { status: 500 });
  }

  // 3. Merge draw config into division settings (preserving setup-page keys).
  const settings = (division.settings ?? {}) as Record<string, unknown>;
  const prevDraw = (settings.draw ?? {}) as Record<string, unknown>;
  const prevAttempts = typeof prevDraw.attempts === 'number' ? prevDraw.attempts : 0;
  const draw = {
    pools, advance, crossing,
    attempts: body.generate ? prevAttempts + 1 : prevAttempts,
    slots: body.generate ? slots : (prevDraw.slots ?? {}),
  };
  const { error: sError } = await supabaseAdmin
    .from('divisions')
    .update({ settings: { ...settings, draw } })
    .eq('id', divisionId);
  if (sError) return NextResponse.json({ error: `Failed to save draw config: ${sError.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, generated: !!body.generate });
}
