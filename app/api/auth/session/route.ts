import { NextResponse } from 'next/server';
import { getCurrentUser, getOrganizerForUser, rolesFor } from '../../../../lib/auth';

/* Who the caller is, decided on the server and reported as a set — every
 * account is a player, and an organizers row adds organizer on top.
 *
 * Strictly read-only: it never provisions. The login form asks this instead
 * of reading user_metadata, because metadata is a claim the browser can
 * write and the organizers table is not. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ signedIn: false, roles: [], organizerId: null });
  }

  const organizer = await getOrganizerForUser(user.id);

  return NextResponse.json({
    signedIn: true,
    roles: rolesFor(organizer),
    // Their own organizer id — the dashboard scopes its listing by it.
    organizerId: organizer?.id ?? null,
    email: user.email ?? null,
    name: organizer?.name ?? user.user_metadata?.full_name ?? null,
    club: organizer?.club ?? null,
  });
}
