import { NextResponse } from 'next/server';
import { requireOrganizer } from '../../../lib/auth';
import { authErrorResponse } from '../../../lib/authResponse';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

/* The organizer behind the current session. Previously a hardcoded
 * DEMO_ORGANIZER_ID; now whoever is actually signed in.
 *
 * Re-selects rather than returning requireOrganizer()'s row because the
 * dashboard header also wants avatar_url, which the auth path has no
 * reason to carry. */
export async function GET() {
  try {
    const organizer = await requireOrganizer();

    const { data, error } = await supabaseAdmin
      .from('organizers')
      .select('name, club, avatar_url')
      .eq('id', organizer.id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return authErrorResponse(err);
  }
}
