import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';
import type { CrossSlot } from '../../../../../../../lib/data';
import { crossBracket, seedPlacement } from '../../../../../../../lib/crossing';
import { requireTournamentOwner } from '../../../../../../../lib/auth';
import { authErrorResponse } from '../../../../../../../lib/authResponse';
import { isGroupFormat, isKnockoutFormat, knockoutStageName as stageName } from '../../../../../../../lib/roundFormat';
import { planThirdPlace, type KnockoutRound } from '../../../../../../../lib/thirdPlacePlan';
import {
  NO_DISCARD_COST,
  isEmptyCost,
  tallyDiscardCost,
  type DiscardCost,
  type PlacementRow,
} from '../../../../../../../lib/schedule/discardCost';

// Persists the organizer's draw for one division: seed order on teams,
// draw configuration on divisions.settings.draw, and (optionally) the
// generated pool + knockout rounds and matches.
//
// Matches have no slot column, so the generated bracket's render order is
// recorded in settings.draw.slots as { [roundSequence]: matchId[] } — ids
// are generated here (not read back from the insert) so the mapping never
// depends on returned row order.
//
// Three write modes:
//   mode 'draw' (default) — the full draw: seeds, pools and (optionally) the
//     whole bracket, regenerated from scratch.
//   mode 'crossing' — bracket crossing only: pools, their matches and the
//     seeds are left exactly as they are; just the knockout rounds are
//     rebuilt from the new advance/crossing config.
//   mode 'thirdPlace' — the play-off for 3rd, added or removed on its own. The
//     narrowest write of the three: it touches one round and nothing else.
//     'crossing' can already carry this flag, but it demands a pool round and
//     rebuilds the whole knockout to deliver it — which a division that is
//     *only* a knockout cannot ask for and should not have to pay. The
//     play-off is a leaf: nothing is fed by it, so adding or removing it
//     leaves every other match, and every result already recorded, alone.

interface DrawBody {
  seedOrder: string[]; // team ids, index 0 = seed 1
  pools: number;
  advance: number;
  crossing: string;
  generate?: boolean;
  topSeedIds?: string[]; // organizer-picked top seeds, in order (subset of seedOrder)
  mode?: 'draw' | 'crossing' | 'thirdPlace';
  thirdPlace?: boolean; // play off for 3rd between the beaten semifinalists
  // Acknowledges, in full knowledge of the count, that rebuilding these
  // rounds destroys the placements on them. See readDiscardCost.
  confirmDiscard?: boolean;
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

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

  // The crossing, or standard seeding where the crossing can't draw this
  // field — see lib/crossing.
  const { size: elimSize, slotsA, slotsB } = crossBracket(crossing, counts);
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

/* What a regenerate would destroy.
 *
 * A schedule is not stored beside the matches — it *is* columns on them, and
 * matches.round_id cascades on delete. So rebuilding a division's rounds does
 * not orphan its placements, it deletes them outright, along with every hand
 * edit pinned into them. Nothing survives to be reported afterwards, which is
 * exactly why this is counted *before* the delete.
 *
 * Read from the rows themselves rather than trusted from the client, so the
 * number the organizer is shown is the number that will actually be lost. */
async function readDiscardCost(roundIds: string[]): Promise<DiscardCost | { error: string }> {
  if (roundIds.length === 0) return NO_DISCARD_COST;
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('court, planned_time, scheduled_time, referee_team_id')
    .in('round_id', roundIds);
  if (error) return { error: error.message };
  return tallyDiscardCost((data ?? []) as PlacementRow[]);
}

/* The refusal itself. 409 rather than 400: the request is well formed, it is
 * the state that makes it destructive. The cost rides along so the client can
 * name real numbers in its confirmation without a second round trip — and so
 * a client that never asks still cannot destroy the work silently. */
function discardRefusal(cost: DiscardCost, scope: 'division' | 'knockout') {
  return NextResponse.json(
    {
      error: 'This would discard a saved schedule. Retry with confirmDiscard to proceed.',
      needsDiscardConfirm: true,
      scope,
      cost,
    },
    { status: 409 },
  );
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
  const body = (await request.json()) as DrawBody;

  const pools = Math.max(1, Math.min(8, Math.trunc(body.pools) || 1));
  const advance = Math.max(1, Math.min(4, Math.trunc(body.advance) || 1));
  const crossing = typeof body.crossing === 'string' ? body.crossing : 'fivb';
  const wantsThirdPlace = body.thirdPlace !== undefined ? body.thirdPlace === true : true;

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
    const poolRound = prevRounds.find(r => isGroupFormat(r.format));
    if (!poolRound) {
      return NextResponse.json({ error: 'This division has no pool round — draw the pools first' }, { status: 400 });
    }
    const elimRounds = prevRounds.filter(r => isKnockoutFormat(r.format));
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
      thirdPlace: typeof body.thirdPlace === 'boolean' ? body.thirdPlace : (prevDraw.thirdPlace !== undefined ? prevDraw.thirdPlace === true : true),
    });

    const elimRoundIds = elimRounds.map(r => r.id);

    /* Crossing costs less than a redraw — the pool round is untouched, so pool
       placements survive — but the knockout placements still go. */
    if (body.confirmDiscard !== true) {
      const cost = await readDiscardCost(elimRoundIds);
      if ('error' in cost) {
        return NextResponse.json({ error: `Failed to check the saved schedule: ${cost.error}` }, { status: 500 });
      }
      if (!isEmptyCost(cost)) return discardRefusal(cost, 'knockout');
    }

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
      thirdPlace: typeof body.thirdPlace === 'boolean' ? body.thirdPlace : (prevDraw.thirdPlace !== undefined ? prevDraw.thirdPlace === true : true),
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

  /* The play-off for 3rd, on its own.
   *
   * Everything else about the bracket stays exactly as it is — seeds, pools,
   * every knockout pairing and every result already recorded. That is the
   * whole point: this round is a leaf, nothing is fed by it, so it can be
   * added to or taken off a bracket that is already being played.
   *
   * Works for a pure knockout and for a bracket drawn off pools alike, though
   * only the first has no other way to ask: pool play reaches the same flag
   * through 'crossing', which rebuilds its whole knockout to get there. */
  if (body.mode === 'thirdPlace') {
    const settings = (division.settings ?? {}) as Record<string, unknown>;
    const prevDraw = (settings.draw ?? {}) as Record<string, unknown>;
    const prevSlots = (prevDraw.slots ?? {}) as Record<string, string[]>;
    const prevFeeders = (prevDraw.loserFeeders ?? {}) as Record<string, [string, string]>;

    const elimRounds = (division.rounds ?? []).filter(r => isKnockoutFormat(r.format));

    /* The rounds as the planner needs them: their matches read from the
       matches themselves rather than from `settings.draw.slots`, which is a
       record of the last draw and can be behind the board. */
    const { data: elimMatches, error: emError } = await supabaseAdmin
      .from('matches')
      .select('id, round_id')
      .in('round_id', elimRounds.map(r => r.id));
    if (emError) {
      return NextResponse.json({ error: `Failed to read the bracket: ${emError.message}` }, { status: 500 });
    }
    const byRound = new Map<string, string[]>();
    for (const m of (elimMatches ?? []) as { id: string; round_id: string }[]) {
      byRound.set(m.round_id, [...(byRound.get(m.round_id) ?? []), m.id]);
    }
    const rounds: KnockoutRound[] = elimRounds.map(r => ({
      id: r.id,
      sequence: r.sequence,
      matchIds: byRound.get(r.id) ?? [],
    }));

    // Which round is the play-off, which round feeds it, and whether this is
    // an add, a removal or nothing — decided in lib/thirdPlacePlan, where it
    // is a pure function with its own tests. What is left here is the writing.
    const plan = planThirdPlace(rounds, prevFeeders, wantsThirdPlace);
    if (plan.action === 'impossible') {
      return NextResponse.json({ error: plan.reason }, { status: 400 });
    }

    const saveDrawConfig = async (draw: Record<string, unknown>) => {
      const { error } = await supabaseAdmin
        .from('divisions')
        .update({ settings: { ...settings, draw } })
        .eq('id', divisionId);
      return error ? `Failed to save the draw config: ${error.message}` : null;
    };

    if (plan.action === 'none') {
      /* Nothing to build or delete, but the flag is still written: a division
         whose bracket and whose config disagree is worth quietly repairing. */
      const err = await saveDrawConfig({ ...prevDraw, thirdPlace: wantsThirdPlace });
      if (err) return NextResponse.json({ error: err }, { status: 500 });
      return NextResponse.json({ ok: true, mode: 'thirdPlace', thirdPlace: wantsThirdPlace, changed: false });
    }

    if (plan.action === 'add') {
      /* The same builder the draw itself uses, so a round added to a live
         bracket is indistinguishable from one drawn in from the start. It
         writes into the collections it is handed; `slots` goes in carrying the
         semifinal, which is what it reads to find its two feeders. */
      const roundRows: RoundInsert[] = [];
      const matches: MatchInsert[] = [];
      const slots: Record<string, string[]> = {
        ...prevSlots,
        [String(plan.semi.sequence)]: plan.semi.matchIds,
      };
      const loserFeeders: Record<string, [string, string]> = { ...prevFeeders };
      appendThirdPlace({
        divisionId,
        roundRows,
        matches,
        slots,
        loserFeeders,
        semiSequence: plan.semi.sequence,
        sequence: plan.sequence,
        scoringRules: elimRounds[0]?.scoring_rules ?? {},
      });
      if (roundRows.length === 0 || matches.length === 0) {
        return NextResponse.json({ error: 'Could not build the play-off round' }, { status: 500 });
      }

      const { error: rInsError } = await supabaseAdmin.from('rounds').insert(roundRows);
      if (rInsError) return NextResponse.json({ error: `Failed to create the play-off round: ${rInsError.message}` }, { status: 500 });
      const { error: mInsError } = await supabaseAdmin.from('matches').insert(matches);
      if (mInsError) return NextResponse.json({ error: `Failed to create the play-off match: ${mInsError.message}` }, { status: 500 });

      const err = await saveDrawConfig({ ...prevDraw, thirdPlace: true, slots, loserFeeders });
      if (err) return NextResponse.json({ error: err }, { status: 500 });
      return NextResponse.json({ ok: true, mode: 'thirdPlace', thirdPlace: true, changed: true });
    }

    /* Removing. One round's worth of placements, but they are still someone's
       work — the same accounting a crossing rebuild does, over a smaller
       scope. */
    if (body.confirmDiscard !== true) {
      const cost = await readDiscardCost([plan.round.id]);
      if ('error' in cost) {
        return NextResponse.json({ error: `Failed to check the saved schedule: ${cost.error}` }, { status: 500 });
      }
      if (!isEmptyCost(cost)) return discardRefusal(cost, 'knockout');
    }

    const { error: mDelError } = await supabaseAdmin.from('matches').delete().eq('round_id', plan.round.id);
    if (mDelError) return NextResponse.json({ error: `Failed to clear the play-off match: ${mDelError.message}` }, { status: 500 });
    const { error: rDelError } = await supabaseAdmin.from('rounds').delete().eq('id', plan.round.id);
    if (rDelError) return NextResponse.json({ error: `Failed to clear the play-off round: ${rDelError.message}` }, { status: 500 });

    const nextSlots = { ...prevSlots };
    delete nextSlots[String(plan.round.sequence)];
    const nextFeeders = { ...prevFeeders };
    for (const id of plan.round.matchIds) delete nextFeeders[id];

    const err = await saveDrawConfig({ ...prevDraw, thirdPlace: false, slots: nextSlots, loserFeeders: nextFeeders });
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    return NextResponse.json({ ok: true, mode: 'thirdPlace', thirdPlace: false, changed: true });
  }

  const teamIdSet = new Set(confirmedTeams.map(t => t.id));
  const seedOrder = (body.seedOrder ?? []).filter(id => teamIdSet.has(id));
  if (seedOrder.length !== teamIdSet.size || new Set(seedOrder).size !== seedOrder.length) {
    return NextResponse.json({ error: 'seedOrder must list every confirmed team in the division exactly once' }, { status: 400 });
  }
  if (body.generate && seedOrder.length < 2) {
    return NextResponse.json({ error: 'At least two teams are required to generate a bracket' }, { status: 400 });
  }

  /* Every round in the division goes, so every placement in it goes with it.
     Checked ahead of the seed write as well as the delete: a refused request
     must leave the division exactly as it found it, and reseeding is a write.
     Refused rather than reported, because once the delete lands there is
     nothing left to report. */
  if (body.generate && body.confirmDiscard !== true) {
    const cost = await readDiscardCost((division.rounds ?? []).map(r => r.id));
    if ('error' in cost) {
      return NextResponse.json({ error: `Failed to check the saved schedule: ${cost.error}` }, { status: 500 });
    }
    if (!isEmptyCost(cost)) return discardRefusal(cost, 'division');
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
    const poolRules = prevRounds.find(r => isGroupFormat(r.format))?.scoring_rules ?? {};
    const elimRules = prevRounds.find(r => isKnockoutFormat(r.format))?.scoring_rules ?? {};

    const { error: delError } = await supabaseAdmin.from('rounds').delete().eq('division_id', divisionId);
    if (delError) return NextResponse.json({ error: `Failed to clear rounds: ${delError.message}` }, { status: 500 });

    const hasRoundRobin = prevRounds.some(r => isGroupFormat(r.format));
    const hasElimRound = prevRounds.some(r => isKnockoutFormat(r.format));

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
    thirdPlace: typeof body.thirdPlace === 'boolean' ? body.thirdPlace : (prevDraw.thirdPlace !== undefined ? prevDraw.thirdPlace === true : true),
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
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
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
