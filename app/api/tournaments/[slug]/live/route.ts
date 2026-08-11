import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { redis } from '../../../../../lib/redis';
import { liveKey, ensureStartedAt, type LiveScore } from '../../../../../lib/scorekeeper';

/* In-progress scores for every match still being played in a tournament.
 *
 * The scorekeeper writes points to Redis, but the dashboard court board and
 * the public bracket both build their view from getTournamentDetail, which
 * runs in the browser against the anon Supabase client and so can't read
 * Redis itself. This route is the server-side half: one round trip that
 * turns a tournament slug into "what is the score right now on every
 * court".
 *
 * Returns only scores — no tokens — so it is safe for the public page.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data: tournament, error: tError } = await supabaseAdmin
    .from('tournaments')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (tError) return NextResponse.json({ error: tError.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, rounds!inner ( divisions!inner ( tournament_id ) )')
    .eq('rounds.divisions.tournament_id', tournament.id)
    .neq('status', 'done');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map(m => m.id as string);
  if (ids.length === 0) return NextResponse.json({ scores: {} });

  /* A dead or unreachable Redis must not take the dashboard and the public
   * bracket down with it. Both callers treat an empty map as "no live
   * scores", which is exactly the pre-existing behaviour, so degrade to
   * that rather than surfacing a 5xx they'd have to special-case. */
  let values: (LiveScore | null)[] = [];
  try {
    values = await redis.mget<LiveScore[]>(...ids.map(liveKey));
  } catch {
    return NextResponse.json({ scores: {}, degraded: true });
  }

  const scores: Record<
    string,
    {
      sets: { a: number; b: number }[];
      a: number;
      b: number;
      lastScorer: 'a' | 'b' | null;
      startedAt: number | null;
    }
  > = {};
  // Backfill a clock origin for anything still running from before the match
  // clock existed; a no-op for every key written since.
  const stamped = await Promise.all(
    ids.map((id, i) => (values[i] ? ensureStartedAt(id, values[i]!) : null))
  );

  stamped.forEach((v, i) => {
    const id = ids[i];
    if (!v) return;
    // lastScorer and startedAt post-date the first live keys, so anything
    // written before they existed reads as null rather than undefined.
    scores[id] = {
      sets: v.sets ?? [],
      a: v.a ?? 0,
      b: v.b ?? 0,
      lastScorer: v.lastScorer ?? null,
      startedAt: v.startedAt ?? null,
    };
  });

  return NextResponse.json({ scores });
}
