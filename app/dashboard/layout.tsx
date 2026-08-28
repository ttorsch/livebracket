import { redirect } from 'next/navigation';
import { getCurrentUser, getOrganizerForUser, ensureOrganizerForUser } from '../../lib/auth';

/* The dashboard's real gate. middleware.ts only establishes that *someone*
 * is signed in; being an organizer is a database fact, and this is where it
 * gets checked. A signed-in player who navigates here is sent to their own
 * profile rather than shown an organizer surface with nothing in it. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?role=organizer&next=/dashboard');

  const organizer =
    (await getOrganizerForUser(user.id)) ?? (await ensureOrganizerForUser(user));
  if (!organizer) redirect('/profile');

  return <>{children}</>;
}
