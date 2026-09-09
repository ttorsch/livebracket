/* ── The division's plan ───────────────────────────────────────────────
 *
 * Pool count and whether a play-off for 3rd is played: the two per-division
 * numbers the schedule generator needs to derive a plan before anything has
 * been drawn. See lib/provisionalDraw.
 *
 * Its own route because the divisions route writes settings wholesale, and a
 * caller that holds only these two fields cannot use it without sending back
 * every other key it never asked about. This one merges instead, so the
 * generator panel can change a pool count without knowing or caring what else
 * a division carries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';
import { requireTournamentOwner } from '../../../../../../../lib/auth';
import { authErrorResponse } from '../../../../../../../lib/authResponse';
import { plannedPools } from '../../../../../../../lib/provisionalDraw';

interface PlanBody {
  pools?: number;
  thirdPlace?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; divisionId: string }> },
) {
  const { slug, divisionId } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = (await request.json()) as PlanBody;

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('divisions')
    .select('id, settings, division_team_cap, tournaments!inner(slug)')
    .eq('id', divisionId)
    .eq('tournaments.slug', slug)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Division not found' }, { status: 404 });
  }

  const settings = (existing.settings ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...settings };

  if (body.pools !== undefined) {
    // Clamped through the same reader the rest of the app uses, so a
    // hand-made request cannot store a count the draw screen cannot show.
    next.pools = plannedPools({ pools: body.pools }, existing.division_team_cap as number);
  }
  if (typeof body.thirdPlace === 'boolean') {
    next.thirdPlace = body.thirdPlace;
  }

  /* Keep an existing draw's own copy in step. The draw screen reads
     settings.draw for a division that has been drawn, so leaving it behind
     would let the generator panel and the bracket disagree about the same
     division. A division with no draw yet has nothing to sync. */
  const prevDraw = settings.draw as Record<string, unknown> | undefined;
  if (prevDraw) {
    next.draw = {
      ...prevDraw,
      ...(next.pools !== undefined ? { pools: next.pools } : {}),
      ...(typeof next.thirdPlace === 'boolean' ? { thirdPlace: next.thirdPlace } : {}),
    };
  }

  const { error } = await supabaseAdmin
    .from('divisions')
    .update({ settings: next })
    .eq('id', divisionId);
  if (error) {
    return NextResponse.json({ error: `Failed to save the division plan: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    pools: next.pools ?? null,
    thirdPlace: next.thirdPlace ?? null,
  });
}
