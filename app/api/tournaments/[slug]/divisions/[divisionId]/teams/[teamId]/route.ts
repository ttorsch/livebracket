import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../../lib/supabaseAdmin';
import { formatTeamName } from '../../../../../../../../lib/teamName';

/* ── One registered team ──────────────────────────────────────────
 *
 * The organizer's three per-row actions on the setup page: mark a team
 * paid or unpaid, move a waitlisted team into the draw, and remove a team
 * altogether.
 *
 * Promotion is deliberately allowed past the cap. A seat usually frees up
 * because someone was removed, but an organizer who promotes anyway has
 * decided to run an over-full division, and the setup page says so with a
 * banner rather than refusing the click.
 */

const TEAM_COLS = 'id, name, seed, payment_cleared, status, players(id, name, phone, email, shirt_size)';

interface TeamRow {
  id: string;
  name: string;
  seed: number | null;
  payment_cleared: boolean;
  status: string;
  players?: { id: string; name: string; phone: string | null; email: string | null; shirt_size: string | null }[];
}

const toTeam = (t: TeamRow) => ({
  id: t.id,
  name: formatTeamName(t.name),
  seed: t.seed,
  paymentCleared: t.payment_cleared,
  status: t.status,
  players: (t.players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    shirtSize: p.shirt_size,
  })),
});

/** The team row, but only if it really hangs off this division of this
 *  tournament — the ids come from the URL, so none of them are trusted. */
async function findTeam(slug: string, divisionId: string, teamId: string) {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('id, status, divisions!inner(id, tournaments!inner(slug))')
    .eq('id', teamId)
    .eq('division_id', divisionId)
    .eq('divisions.tournaments.slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; status: string } | null;
}

/** The waitlisted team that has been waiting longest, read in the same
 *  order the setup page lists them so the one promoted is the one the
 *  organizer saw at the top. */
async function firstWaitlisted(divisionId: string) {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select(TEAM_COLS)
    .eq('division_id', divisionId)
    .eq('status', 'waitlist')
    .order('seed', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TeamRow | null) ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; divisionId: string; teamId: string }> },
) {
  const { slug, divisionId, teamId } = await params;
  const body = (await request.json()) as { paymentCleared?: boolean; promote?: boolean };

  let existing;
  try {
    existing = await findTeam(slug, divisionId, teamId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.paymentCleared === 'boolean') patch.payment_cleared = body.paymentCleared;
  // Promotion only ever moves a team off the waiting list. It does not mark
  // them paid — nobody has handed over any money by being moved up.
  if (body.promote) {
    if (existing.status !== 'waitlist') {
      return NextResponse.json({ error: 'Only a waitlisted team can be moved up' }, { status: 400 });
    }
    patch.status = 'confirmed';
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .update(patch)
    .eq('id', teamId)
    .select(TEAM_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ team: toTeam(data as TeamRow) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; divisionId: string; teamId: string }> },
) {
  const { slug, divisionId, teamId } = await params;

  let existing;
  try {
    existing = await findTeam(slug, divisionId, teamId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const freedASeat = existing.status !== 'waitlist';

  // players cascade off the team row (see migration 0001).
  const { error: delError } = await supabaseAdmin.from('teams').delete().eq('id', teamId);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  // Removing a confirmed team opens a seat, and the point of a waiting list
  // is that the seat does not sit empty. Removing a waitlisted team frees
  // nothing, so nobody moves.
  let promoted = null;
  if (freedASeat) {
    try {
      const next = await firstWaitlisted(divisionId);
      if (next) {
        const { data, error } = await supabaseAdmin
          .from('teams')
          .update({ status: 'confirmed' })
          .eq('id', next.id)
          .select(TEAM_COLS)
          .single();
        if (error) throw new Error(error.message);
        promoted = toTeam(data as TeamRow);
      }
    } catch (err) {
      // The delete already happened and is not coming back. Report the
      // promotion failure rather than a phantom 500 on the whole call.
      return NextResponse.json(
        {
          deletedId: teamId,
          promoted: null,
          warning: err instanceof Error ? err.message : 'Team removed, but promoting the next team failed',
        },
        { status: 200 },
      );
    }
  }

  return NextResponse.json({ deletedId: teamId, promoted });
}
