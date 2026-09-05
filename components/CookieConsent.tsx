'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { getConsent, setConsent } from '@/lib/consent';
import styles from './CookieConsent.module.css';

/* Reading the cookie through useSyncExternalStore rather than in an effect.
 *
 * The cookie does not exist during the server render, so the bar has to be
 * absent from the HTML and appear on the client — but doing that with
 * `useEffect(() => setVisible(...))` means a cascading second render on
 * every page load for every visitor, banner or no banner. This hook exists
 * for exactly this shape: an external, non-React source of truth with a
 * separate server snapshot.
 *
 * Nothing else writes this cookie while the page is open, so `subscribe`
 * has nobody to listen to and returns a no-op teardown. The one writer is
 * the click handler below, and it drives its own unmount through
 * `dismissed` instead of waiting to be told. */
const subscribe = () => () => {};
const needsAnswerSnapshot = () => getConsent() === null;
const serverSnapshot = () => false;

/* The consent bar.
 *
 * Deliberately not a modal and not a scroll-blocker: nothing on this site
 * needs permission to work, so trapping a spectator who just wants to see a
 * score behind a dialog would be a dark pattern in the other direction.
 *
 * Accept and Reject are the same size, weight and prominence. That is not
 * decoration — a banner where refusing is harder than agreeing is not valid
 * consent under GDPR, and it is the single most common way these things
 * fail an audit. If you restyle this, keep the two buttons equal.
 *
 * See lib/consent.ts for what the recorded answer is actually for. */
export default function CookieConsent() {
  const needsAnswer = useSyncExternalStore(
    subscribe,
    needsAnswerSnapshot,
    serverSnapshot
  );
  const [dismissed, setDismissed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (!needsAnswer || dismissed) return null;

  const answer = (decision: 'accepted' | 'rejected') => {
    /* Recorded first, animated second: someone who clicks and immediately
     * navigates away has still answered. */
    setConsent(decision);
    setLeaving(true);
    /* Let the slide-out finish before unmounting, so the bar leaves the way
     * it arrived rather than vanishing mid-animation. */
    window.setTimeout(() => setDismissed(true), 220);
  };

  return (
    <div
      /* region, not dialog: it does not trap focus, and a spectator is free
       * to ignore it and keep reading the page underneath. */
      role="region"
      aria-label="Cookie notice"
      className={`${styles.bar} ${leaving ? styles.barLeaving : ''}`}
    >
      <div className={styles.inner}>
        <p className={styles.copy}>
          Live Bracket uses a single cookie to keep you signed in. We don&rsquo;t run
          ads or third-party trackers. Accepting also lets us add anonymous usage
          analytics later &mdash; nothing loads until you say yes.{' '}
          <Link href="/privacy" className={styles.link}>
            Privacy &amp; cookies
          </Link>
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.reject}
            onClick={() => answer('rejected')}
          >
            Reject
          </button>
          <button
            type="button"
            className={styles.accept}
            onClick={() => answer('accepted')}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
