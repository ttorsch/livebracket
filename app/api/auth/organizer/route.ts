import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, addOrganizerToUser } from '../../../../lib/auth';

/* Adds the organizer capability to the signed-in account.
 *
 * This is the additive half of the role model: a player who decides to run
 * an event calls this and keeps everything they already had, rather than
 * needing a second email address. It requires a live session, so it can
 * only ever act on the caller's own account. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name : undefined;
  const club = typeof body.club === 'string' ? body.club : undefined;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'An organizer name is required' }, { status: 400 });
  }

  try {
    const organizer = await addOrganizerToUser(user, { name, club });
    if (!organizer) {
      /* provisionOrganizer returns null when an organizers row already
       * belongs to a different auth user with this email — a genuine
       * conflict a retry will not fix. */
      return NextResponse.json(
        { error: 'An organizer account already exists for this email address.' },
        { status: 409 }
      );
    }
    return NextResponse.json({
      organizerId: organizer.id,
      name: organizer.name,
      club: organizer.club,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create the organizer profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
