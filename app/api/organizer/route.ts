import { NextRequest, NextResponse } from 'next/server';
import { requireOrganizer, getSessionInfo } from '../../../lib/auth';
import { authErrorResponse } from '../../../lib/authResponse';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

/* The organizer profile — the identity printed on a public event page.
 *
 * Separate from the player profile at /api/me on purpose. One account can
 * hold both, and they are edited independently: renaming yourself on a
 * roster must not rename the person running the tournament, and vice
 * versa. Neither endpoint writes the other's table.
 *
 * Both handlers go through requireOrganizer, so they can only ever read or
 * write the caller's own row — there is no id in the request to forge. */

const COLUMNS = 'id, name, club, hometown, avatar_url';

export async function GET() {
  try {
    const organizer = await requireOrganizer();

    const { data, error } = await supabaseAdmin
      .from('organizers')
      .select(COLUMNS)
      .eq('id', organizer.id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  let organizerId: string;
  try {
    organizerId = (await requireOrganizer()).id;
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => ({}));

  /* Only the three display fields. Notably not email or auth_user_id —
   * migration 0013 narrowed the column grant for exactly this reason, and
   * an id the owner can rewrite is an id that orphans their tournaments. */
  const patch: Record<string, string | null> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: 'An organizer name is required' }, { status: 400 });
    }
    patch.name = name;
  }
  if (typeof body.hometown === 'string') patch.hometown = body.hometown.trim() || null;
  if (typeof body.avatarUrl === 'string') patch.avatar_url = body.avatarUrl.trim() || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('organizers')
    .update(patch)
    .eq('id', organizerId)
    .select(COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /* The fresh session comes back with it so the dashboard can update its
   * header without a second round trip. */
  return NextResponse.json({ organizer: data, session: await getSessionInfo() });
}
