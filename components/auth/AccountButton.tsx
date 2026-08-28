'use client';

import Link from 'next/link';
import { initialsFor } from '@/lib/session';
import { useSession } from './AuthProvider';
import styles from './AccountButton.module.css';

/* What a signed-in visitor sees where "Sign In" and "Create a tournament"
 * used to be.
 *
 * It renders nothing at all when signed out — the caller keeps owning the
 * signed-out controls, since those differ per header (the homepage offers
 * two buttons, the tournament pages one). This component is only the
 * signed-in half of that swap.
 *
 * The destination is always /profile, for everyone. An organizer reaches
 * their dashboard from the link already on that page, which keeps one
 * control meaning one thing rather than quietly routing by role. */
export default function AccountButton({
  className,
  onNavigate,
}: {
  className?: string;
  /* Lets a header save its scroll position (or close its mobile menu)
     before the navigation, the same way its sign-in link does. */
  onNavigate?: () => void;
}) {
  const session = useSession();
  if (!session.signedIn) return null;

  const label = session.name?.trim() || session.email || 'your profile';

  return (
    <Link
      href="/profile"
      className={className ? `${styles.button} ${className}` : styles.button}
      onClick={onNavigate}
      title={label}
      aria-label={`Your profile — ${label}`}
    >
      {session.avatarUrl ? (
        /* A plain img: avatars come from arbitrary OAuth provider hosts,
           and next/image would need each one declared in next.config.ts. */
        <img src={session.avatarUrl} alt="" className={styles.avatar} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initialsFor(session)}
        </span>
      )}
    </Link>
  );
}
