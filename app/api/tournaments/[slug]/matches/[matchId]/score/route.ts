import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';
import { redis } from '../../../../../../../lib/redis';
import { liveKey } from '../../../../../../../lib/scorekeeper';
import { requireTournamentOwner } from '../../../../../../../lib/auth';
import { authErrorResponse } from '../../../../../../../lib/authResponse';
import { cleanSets, scoreProblem, scoreWinner } from '../../../../../../../lib/matchScore';

/* ── The organizer's own way in to a result ───────────────────────
 *
 * The scorekeeper screen is the happy path: a referee holds a link, taps
 * points into Redis, and one finalize writes the result. This is what
 * happens when that never took place — the link was never opened, the
 * phone died, the score came in on paper — or when what it wrote is
 * wrong.
 *
 * It differs from `/api/score/[token]/finalize` in three ways, and each
 * one is why it can't just be that route with a different door:
 *
 *  1. It authenticates as the tournament's owner rather than by token, so
 *     an organizer can score any match in their event without hunting for
 *     its scorekeeper link.
 *  2. It overwrites a match that is already `done`. Finalize refuses that
 *     on purpose — a referee must not be able to re-decide a finished
 *     match — but correcting a finished match is the whole point here.
 *  3. It accepts an empty set list, which takes the result back off the
 *     match and returns it to `upcoming`.
 *
 * What it will not do is touch a match that is being scored right now.
 * The referee's screen pushes whole state, not deltas, so a write from
 * here would be silently overwritten by their next tap — or would erase
 * the set on court. The live key's existence is the test, not the match's
 * `status`: a match left in `live` by an abandoned scorekeeper session has
 * no key once it expires, and that one *should* be scoreable from here.
 */

interface MatchRow {
  id: string;
  status: 'upcoming' | 'live' | 'done';
  team_a_id: string | null;
  team_b_id: string | null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; matchId: string }> }
) {
  const { slug, matchId } = await params;

  let tournamentId: string;
  try {
    ({ tournamentId } = await requireTournamentOwner(slug));
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = (await request.json().catch(() => ({}))) as { sets?: unknown };
  const sets = cleanSets(body.sets);

  const problem = scoreProblem(sets);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  /* The match id comes from the URL, so ownership of the tournament says
   * nothing about it until the join proves the match hangs off this
   * tournament's divisions. */
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, status, team_a_id, team_b_id, rounds!inner ( divisions!inner ( tournament_id ) )')
    .eq('id', matchId)
    .eq('rounds.divisions.tournament_id', tournamentId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Match not found in this tournament.' }, { status: 404 });
  const match = data as unknown as MatchRow;

  /* A referee mid-match owns the score. Redis being unreachable is not a
   * reason to refuse: the scorekeeper's own writes fail in that state too,
   * so nothing can be in flight to protect. */
  try {
    const live = await redis.get(liveKey(matchId));
    if (live) {
      return NextResponse.json(
        { error: 'This match is being scored live — enter the result on the scorekeeper screen.' },
        { status: 409 }
      );
    }
  } catch {
    /* Fall through and write. */
  }

  const clearing = sets.length === 0;
  const winnerSide = scoreWinner(sets);

  // A result needs two teams to have a winner between them. A slot still
  // waiting on an earlier round has nobody to award it to.
  if (!clearing && (!match.team_a_id || !match.team_b_id)) {
    return NextResponse.json(
      { error: 'Both teams have to be decided before this match can be scored.' },
      { status: 400 }
    );
  }

  const update = clearing
    ? {
        score_a: null,
        score_b: null,
        winner_team_id: null,
        status: 'upcoming' as const,
        updated_at: new Date().toISOString(),
      }
    : {
        score_a: sets.map(s => s.a),
        score_b: sets.map(s => s.b),
        winner_team_id: winnerSide === 'A' ? match.team_a_id : match.team_b_id,
        status: 'done' as const,
        updated_at: new Date().toISOString(),
      };

  const { data: saved, error: saveError } = await supabaseAdmin
    .from('matches')
    .update(update)
    .eq('id', matchId)
    .select('id, score_a, score_b, winner_team_id, status')
    .single();

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  /* Any live key left over from an abandoned session is now stale noise
   * that would re-appear as a score on the public page. Best effort: it
   * expires on its own, and the durable write already landed. */
  try {
    await redis.del(liveKey(matchId));
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    match: {
      id: saved.id,
      scoreA: saved.score_a ?? undefined,
      scoreB: saved.score_b ?? undefined,
      winner: winnerSide ?? undefined,
      status: saved.status,
    },
  });
}
