import { NextResponse } from 'next/server';
import { getCurrentUser, getOrganizerForUser, ensureOrganizerForUser } from '../../../../lib/auth';

/* Who the caller actually is, decided on the server. The login form asks
 * this right after signing in rather than reading user_metadata, because
 * metadata is a claim the browser can write and the organizers table is
 * not. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ signedIn: false, role: null, redirectTo: '/login' });
  }

  let organizer = await getOrganizerForUser(user.id);
  if (!organizer) organizer = await ensureOrganizerForUser(user);

  const role = organizer ? 'organizer' : 'player';
  return NextResponse.json({
    signedIn: true,
    role,
    // Their own organizer id — the dashboard scopes its listing by it.
    organizerId: organizer?.id ?? null,
    email: user.email ?? null,
    name: organizer?.name ?? user.user_metadata?.full_name ?? null,
    redirectTo: organizer ? '/dashboard' : '/profile',
  });
}
