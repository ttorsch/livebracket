import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { getCurrentUser } from '../../../../../lib/auth';
import { notify } from '../../../../../lib/notifications';

/* Thumbing a player up, and taking it back.
 *
 * One per account per player — the unique constraint in 0018 is what
 * makes that true, so "have I already?" is a fact about the database
 * rather than something the client is trusted to report. A second call
 * removes yours, which is why this is one endpoint and not two.
 *
 * Signing in is the price of the actor id: without one there is no way to
 * count people rather than clicks, and no one to name in the notification.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function countThumbs(targetId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('player_thumbs')
    .select('id', { count: 'exact', head: true })
    .eq('target_id', targetId);
  return count ?? 0;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  if (!UUID.test(userId)) {
    return NextResponse.json({ error: 'Not a player id' }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to thumb a player up' }, { status: 401 });
  }
  if (user.id === userId) {
    return NextResponse.json({ error: 'You cannot thumb yourself up' }, { status: 400 });
  }

  // The player has to exist as an account before it can be recognised.
  const { data: target } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'No player found' }, { status: 404 });

  const { data: existing } = await supabaseAdmin
    .from('player_thumbs')
    .select('id')
    .eq('target_id', userId)
    .eq('actor_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin.from('player_thumbs').delete().eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    /* The notification stays. It was true when it was sent, and a list
     * that quietly loses rows as people change their minds is a list
     * nobody can trust — you would remember being told, and find
     * nothing. */
    return NextResponse.json({ thumbed: false, count: await countThumbs(userId) });
  }

  const { error } = await supabaseAdmin
    .from('player_thumbs')
    .insert({ target_id: userId, actor_id: user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /* Told once, however many times the button is toggled. Un-thumbing and
   * thumbing again is a change of mind, not news, and re-announcing it
   * would hand one person a way to fill someone's list. */
  const { data: told } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('recipient_id', userId)
    .eq('actor_id', user.id)
    .eq('kind', 'thumb_up')
    .limit(1)
    .maybeSingle();

  if (!told) {
    await notify({ recipientId: userId, actorId: user.id, kind: 'thumb_up' });
  }

  return NextResponse.json({ thumbed: true, count: await countThumbs(userId) });
}
