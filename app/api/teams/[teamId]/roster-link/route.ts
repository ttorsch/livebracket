import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { getCurrentUser } from '../../../../../lib/auth';
import { resolveTeamEditAccess } from '../../../../../lib/teamEditAccess';

/* ── "Which one of these is me" ───────────────────────────────────
 *
 * Points a roster slot at the signed-in account. Needed because a team of
 * six is six names and one contact address: proving the address says the
 * team is yours, not which of the six you are. Only the person knows, so
 * only the person is asked.
 *
 * Separate from the account route because the timing differs. Creating an
 * account knows the new user id server-side and links in the same breath;
 * signing in does not exist until the browser has a session, so this is
 * the call that closes the gap afterwards — for a password sign-in
 * immediately, and for OAuth once the redirect has come back.
 *
 * Two independent facts authorise it, and both are required:
 *
 *   1. There is a session. The slot is linked to *that* account and never
 *      to an id from the body — there is no way to point a roster slot at
 *      somebody else.
 *   2. This caller may edit this team at all: they hold a verified
 *      session for it, or the team is already theirs. Being signed in is
 *      not on its own a right to attach yourself to a stranger's roster.
 *
 * `is('user_id', null)` on the update is the third guard and the one that
 * matters most: a slot that already names an account belongs to that
 * person, and taking it over is what the invite flow exists to mediate.
 */

export async function POST(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const access = await resolveTeamEditAccess(teamId);
  if (!access) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (!access.via) return NextResponse.json({ error: 'This is not your team' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { playerId?: string };
  if (!body.playerId) return NextResponse.json({ error: 'Pick a player' }, { status: 400 });

  const slot = access.team.players.find((p) => p.id === body.playerId);
  if (!slot) return NextResponse.json({ error: 'That player is not on this team' }, { status: 400 });
  if (slot.userId) {
    return NextResponse.json(
      { error: slot.userId === user.id ? 'Already linked to you' : 'That player already has an account linked' },
      { status: slot.userId === user.id ? 200 : 409 },
    );
  }

  /* 'accepted' rather than the column's 'none' default, matching what the
   * registration route writes when the person filling the form is the
   * account on the slot — this is the same assertion, made later. It is
   * not an invitation: nobody has to answer a claim you make about
   * yourself, having already proved the team's contact address. */
  const { data, error } = await supabaseAdmin
    .from('players')
    .update({ user_id: user.id, invite_status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', body.playerId)
    .eq('team_id', teamId)
    .is('user_id', null)
    .select('id, name')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  /* Nothing updated means someone linked it between the read and the
   * write. Reported as the conflict it is rather than as success. */
  if (!data) return NextResponse.json({ error: 'That player already has an account linked' }, { status: 409 });

  return NextResponse.json({ ok: true, playerId: data.id, name: data.name });
}
