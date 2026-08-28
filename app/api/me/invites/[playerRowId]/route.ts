import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { getCurrentUser } from '../../../../../lib/auth';

/* Answering an invitation.
 *
 * The `.eq('user_id', user.id)` on the update is the authorization, not a
 * filter: it is what stops one account answering an invitation addressed
 * to another. The row id in the path is untrusted on its own.
 *
 * Only a pending invite can be answered, so a reply cannot be replayed to
 * flip a decision later — and declining never removes the roster slot.
 * The organizer registered a team and that entry stands; what changes is
 * that the name stops being drawn as this account's, which is what the
 * public page greys out. Removing a player is the organizer's call, on
 * their own screen. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ playerRowId: string }> }
) {
  const { playerRowId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'Action must be accept or decline' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('players')
    .update({
      invite_status: action === 'accept' ? 'accepted' : 'declined',
      responded_at: new Date().toISOString(),
    })
    .eq('id', playerRowId)
    .eq('user_id', user.id)
    .eq('invite_status', 'pending')
    .select('id, invite_status')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    /* Not yours, not pending, or not there. One answer for all three: a
     * caller should not learn which invitations exist for other people. */
    return NextResponse.json({ error: 'That invitation is no longer open' }, { status: 404 });
  }

  return NextResponse.json({ id: data.id, status: data.invite_status });
}
