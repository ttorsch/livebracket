import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { redis } from '../../../../lib/redis';
import { resolveScorekeeperToken, liveKey, type LiveScore } from '../../../../lib/scorekeeper';
import { deriveLastScorer } from '../../../../lib/lastScorer';

// Live state is worthless once the event is over; expiring it keeps Redis
// from accumulating a key per match forever.
const LIVE_TTL_SECONDS = 60 * 60 * 12;

/* Resolve the token into the match the referee is about to score. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let match;
  try {
    match = await resolveScorekeeperToken(token);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }

  // Same response for a malformed, unknown, or revoked token — the token is
  // the only credential, so the endpoint gives nothing away about which.
  if (!match) {
    return NextResponse.json({ error: 'This scorekeeper link is not valid.' }, { status: 404 });
  }

  return NextResponse.json(match);
}

/* Push the current score. Every tap lands here, so it writes only to Redis. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json()) as { sets?: { a: number; b: number }[]; a?: number; b?: number };

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
    return NextResponse.json({ error: 'This match is already finalized.' }, { status: 409 });
  }

  const sets = Array.isArray(body.sets) ? body.sets : [];
  const clamp = (n: unknown) => (typeof n === 'number' && n >= 0 && n < 1000 ? Math.trunc(n) : 0);

  const next = {
    sets: sets.map(s => ({ a: clamp(s?.a), b: clamp(s?.b) })),
    a: clamp(body.a),
    b: clamp(body.b),
  };

  const live: LiveScore = {
    matchId: match.matchId,
    ...next,
    // resolveScorekeeperToken already read the prior state out of Redis, so
    // the diff costs no extra round trip.
    lastScorer: deriveLastScorer(match.live, next),
    updatedAt: Date.now(),
  };

  try {
    await redis.set(liveKey(match.matchId), live, { ex: LIVE_TTL_SECONDS });
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not reach the live score service.', detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }

  // Flip the match to "live" once, the first time a point is scored, so the
  // public page and the dashboard court table stop calling it upcoming.
  if (match.status !== 'live') {
    await supabaseAdmin.from('matches').update({ status: 'live' }).eq('id', match.matchId);
  }

  return NextResponse.json({ ok: true, live });
}
