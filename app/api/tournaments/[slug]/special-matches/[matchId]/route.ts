import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { requireTournamentOwner } from '../../../../../../lib/auth';
import { authErrorResponse } from '../../../../../../lib/authResponse';
import { redis } from '../../../../../../lib/redis';
import { liveKey } from '../../../../../../lib/scorekeeper';

/* Takes a special match back off the schedule. Only special matches — the
 * competition's own matches come and go with the draw, never one at a time —
 * and never one a referee is scoring right now. Deleting its round takes the
 * match with it (matches.round_id cascades), and the round was its alone. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; matchId: string }> },
) {
  const { slug, matchId } = await params;
  let tournamentId: string;
  try {
    ({ tournamentId } = await requireTournamentOwner(slug));
  } catch (err) {
    return authErrorResponse(err);
  }

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, status, round_id, rounds!inner ( format, divisions!inner ( tournament_id ) )')
    .eq('id', matchId)
    .eq('rounds.divisions.tournament_id', tournamentId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const match = data as unknown as { id: string; status: string; round_id: string; rounds: { format: string } } | null;
  if (!match) return NextResponse.json({ error: 'Match not found in this tournament.' }, { status: 404 });
  if (match.rounds.format !== 'special') {
    return NextResponse.json({ error: 'Only a special match can be removed on its own.' }, { status: 400 });
  }

  let live = match.status === 'live';
  try {
    live = live || !!(await redis.get(liveKey(matchId)));
  } catch {
    /* Redis unreachable: the status column is all there is to go on. */
  }
  if (live) {
    return NextResponse.json({ error: 'This match is being scored right now — finish it first.' }, { status: 409 });
  }

  const { error: delError } = await supabaseAdmin.from('rounds').delete().eq('id', match.round_id);
  if (delError) return NextResponse.json({ error: `Failed to remove the match: ${delError.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
