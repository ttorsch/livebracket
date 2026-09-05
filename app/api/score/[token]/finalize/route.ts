import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { redis } from '../../../../../lib/redis';
import { resolveScorekeeperToken, liveKey, setWins } from '../../../../../lib/scorekeeper';

/* The one durable write. Everything up to here lived in Redis; this is what
 * puts the result in the bracket. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json()) as { sets?: { a: number; b: number }[]; isBye?: boolean };

  let match;
  try {
    match = await resolveScorekeeperToken(token);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json({ error: 'This scorekeeper link is not valid.' }, { status: 404 });
  }
  if (match.status === 'done') {
    return NextResponse.json({ error: 'This match has already been finalized.' }, { status: 409 });
  }

  const sets = (Array.isArray(body.sets) ? body.sets : []).map(s => ({
    a: Math.max(0, Math.trunc(Number(s?.a) || 0)),
    b: Math.max(0, Math.trunc(Number(s?.b) || 0)),
  }));

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Cannot finalize a match with no completed sets.' }, { status: 400 });
  }
  // A drawn set can't decide a match, and silently storing one would produce
  // a result nobody can explain later.
  if (sets.some(s => s.a === s.b)) {
    return NextResponse.json({ error: 'Every set needs a winner — one side must have more points.' }, { status: 400 });
  }

  const wins = setWins(sets);
  if (wins.a === wins.b) {
    return NextResponse.json({ error: 'The match is tied on sets — play a deciding set before finalizing.' }, { status: 400 });
  }

  const winnerTeamId = wins.a > wins.b ? match.teamA.id : match.teamB.id;

  const updatePayload: Record<string, unknown> = {
    score_a: sets.map(s => s.a),
    score_b: sets.map(s => s.b),
    winner_team_id: winnerTeamId,
    status: 'done',
    updated_at: new Date().toISOString(),
  };
  if (body.isBye) {
    updatePayload.live_snapshot = { isBye: true };
  }

  const { data, error } = await supabaseAdmin
    .from('matches')
    .update(updatePayload)
    .eq('id', match.matchId)
    .select('id, score_a, score_b, winner_team_id, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The result is durable now, so the live key is just stale noise. A failure
  // here is not worth failing the request over — it expires on its own.
  try {
    await redis.del(liveKey(match.matchId));
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    match: data,
    wins,
    winner: wins.a > wins.b ? 'A' : 'B',
  });
}
