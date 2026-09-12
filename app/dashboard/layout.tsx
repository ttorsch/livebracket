import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getOrganizerForUser } from '../../lib/auth';

/* The organizer surface gets its own tab icon: the orange mark on black,
 * so a dashboard tab is distinguishable at a glance from the public pages
 * carrying the orange-circle favicon. Spelled out here rather than left to
 * the `app/dashboard/icon.svg` file convention because the root layout sets
 * `icons` explicitly, and a config-based value there wins over a file
 * convention in a child segment. `apple` is repeated because a child's
 * `icons` replaces the parent's wholesale — omit it and these routes lose
 * the touch icon.
 *
 * The SVG itself stays at app/dashboard/icon.svg, which Next serves at the
 * URL referenced below. */
export const metadata: Metadata = {
  icons: {
    icon: '/dashboard/icon.svg',
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

/* The dashboard's real gate. middleware.ts only establishes that *someone*
 * is signed in; holding the organizer capability is a database fact, and
 * this is where it gets checked.
 *
 * Read-only: an account without an organizers row is sent to the player
 * surface it does have, not quietly given one. Adding the capability is an
 * explicit act (POST /api/auth/organizer), offered on the login form. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user && process.env.NODE_ENV !== 'development') redirect('/login?role=organizer&next=/dashboard');

  const organizer = user ? await getOrganizerForUser(user.id) : null;
  if (user && !organizer && process.env.NODE_ENV !== 'development') redirect('/profile');

  return <>{children}</>;
}
