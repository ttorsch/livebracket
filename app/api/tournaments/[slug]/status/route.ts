import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { isPhase, retirementFor, selectablePhases, type Phase } from '../../../../../lib/tournamentLifecycle';
import { requireTournamentOwner } from '../../../../../lib/auth';
import { authErrorResponse } from '../../../../../lib/authResponse';

/* Where a tournament's lifecycle changes.
 *
 * Kept off the main PATCH deliberately: that one saves the details an
 * organizer edits in a form, and a stray `phase` in a form payload should
 * never be able to open registration. Every move here is checked against
 * where the tournament actually is, read inside the request rather than
 * trusted from the client.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
  const body = await request.json().catch(() => ({}));
  const { phase: wantPhase, action } = body as { phase?: unknown; action?: unknown };

  const { data: current, error: readError } = await supabaseAdmin
    .from('tournaments')
    .select('slug, phase, archived_at, cancelled_at')
    .eq('slug', slug)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

  const from = current.phase as Phase;
  const patch: Record<string, unknown> = {};

  if (action !== undefined) {
    const allowed = retirementFor(from);
    switch (action) {
      case 'archive':
        // Refused past announced: people have registered by then, and making
        // the event vanish is how they find out the hard way.
        if (allowed !== 'archive') {
          return NextResponse.json(
            { error: 'This tournament has opened registration — cancel it instead of archiving.' },
            { status: 409 },
          );
        }
        patch.archived_at = new Date().toISOString();
        break;
      case 'cancel':
        if (allowed !== 'cancel') {
          return NextResponse.json(
            { error: 'This tournament has not opened registration — archive it instead of cancelling.' },
            { status: 409 },
          );
        }
        patch.cancelled_at = new Date().toISOString();
        break;
      case 'restore':
        patch.archived_at = null;
        break;
      case 'uncancel':
        patch.cancelled_at = null;
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } else if (wantPhase !== undefined) {
    if (!isPhase(wantPhase)) {
      return NextResponse.json({ error: 'phase must be 1, 2, 3 or 4' }, { status: 400 });
    }
    if (!selectablePhases(from).includes(wantPhase)) {
      return NextResponse.json(
        { error: 'A tournament can only be set to Draft or Announced. Registration follows each division\'s own dates.' },
        { status: 409 },
      );
    }
    patch.phase = wantPhase;
  } else {
    return NextResponse.json({ error: 'Provide a phase or an action' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('tournaments')
    .update(patch)
    .eq('slug', slug)
    .select('slug, phase, archived_at, cancelled_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
