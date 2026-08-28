import { redirect } from 'next/navigation';
import { getCurrentUser, getOrganizerForUser } from '../../lib/auth';

/* The dashboard's real gate. middleware.ts only establishes that *someone*
 * is signed in; holding the organizer capability is a database fact, and
 * this is where it gets checked.
 *
 * Read-only: an account without an organizers row is sent to the player
 * surface it does have, not quietly given one. Adding the capability is an
 * explicit act (POST /api/auth/organizer), offered on the login form. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?role=organizer&next=/dashboard');

  const organizer = await getOrganizerForUser(user.id);
  if (!organizer) redirect('/profile');

  return <>{children}</>;
}
