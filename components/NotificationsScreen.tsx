'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import styles from './NotificationsScreen.module.css';
import { Card, Logo } from './livebracket-ds';
import NotificationList from './NotificationList';
import { useNotifications } from '../hooks/useNotifications';
import type { NotificationAudience } from '../lib/notificationKinds';

/* ── Everything one account has been told ─────────────────────────
 *
 * Where the bell's panel ends, on both surfaces: /notifications for the
 * player, /dashboard/notifications for the organizer. The panel shows
 * the newest few over whatever page you were on; this is the whole list,
 * with nothing clipped and nothing to scroll inside — which is what
 * "See all" has to mean to be worth the navigation.
 *
 * One screen for two audiences rather than two that drift apart: the
 * only things that differ are which list is asked for and where "back"
 * goes, and both are arguments.
 */

export default function NotificationsScreen({
  userId,
  audience,
  backHref,
  backLabel,
  actions,
}: {
  userId: string | null;
  audience: NotificationAudience;
  backHref: string;
  backLabel: string;
  /** Whatever the surface keeps in the top bar's right side. */
  actions?: ReactNode;
}) {
  const {
    items,
    unread,
    loading,
    error,
    markAllRead,
    answerInvite,
  } = useNotifications(userId, audience);

  return (
    <div className={styles.page}>
      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div className={`${styles.shell} ${styles.topbar}`}>
        <Link href="/" className={styles.brand} aria-label="Live Bracket — home">
          <Logo variant="lockup" size={30} />
        </Link>
        {/* No bell here. It counts this page. */}
        {actions && <div className={styles.topbarActions}>{actions}</div>}
      </div>

      <div className={`${styles.shell} ${styles.content}`}>
        <Link href={backHref} className={styles.back}>
          <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
        </Link>

        <div className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>Notifications</h1>
            <p className={styles.subtitle}>
              {loading
                ? 'Loading…'
                : unread > 0
                  ? `${unread} unread of ${items.length}`
                  : `${items.length} notification${items.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {unread > 0 && (
            <button type="button" className={styles.markReadBtn} onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>

        <Card radius="xl" padding={24}>
          <NotificationList
            items={items}
            loading={loading}
            error={error}
            onAnswer={answerInvite}
            audience={audience}
          />
        </Card>
      </div>
    </div>
  );
}
