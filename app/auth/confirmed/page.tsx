import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import AuthShell from '../../../components/auth/AuthShell';
import shell from '../../../components/auth/AuthShell.module.css';
import { getCurrentUser, getOrganizerForUser } from '../../../lib/auth';

export const metadata = {
  title: 'Email confirmed · Live Bracket',
};

/* Where the confirm-email link lands. By the time this renders,
 * /auth/callback has already exchanged the code for a session, so the
 * person is signed in — this page just tells them so and points at the
 * right next surface for their role. */
export default async function EmailConfirmedPage() {
  const user = await getCurrentUser();
  const organizer = user ? await getOrganizerForUser(user.id) : null;

  const destination = organizer ? '/dashboard' : '/profile';
  const destinationLabel = organizer ? 'Go to your dashboard' : 'Go to your profile';

  return (
    <AuthShell
      title="You're all set"
      footer={
        user ? null : <Link href="/login" className={shell.link}>Log in</Link>
      }
    >
      <div className={shell.done}>
        <span className={shell.doneIcon}><CircleCheck size={26} /></span>
        {user ? (
          <>
            <p>
              Your email is confirmed and you&apos;re signed in
              {user.email ? <> as <strong>{user.email}</strong></> : null}.
            </p>
            <div className={shell.doneActions}>
              <Link href={destination} className={shell.primaryAction}>
                {destinationLabel}
              </Link>
            </div>
          </>
        ) : (
          <p>Your email is confirmed. Log in to pick up where you left off.</p>
        )}
      </div>
    </AuthShell>
  );
}
