'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import styles from './NotificationBell.module.css';
import NotificationList from './NotificationList';
import { useNotifications } from '../hooks/useNotifications';
import type { NotificationAudience } from '../lib/notificationKinds';

/* ── The bell, and the list hanging off it ────────────────────────
 *
 * The count and the thing it counts are one control. A badge that only
 * navigates somewhere makes you leave the page to find out a team
 * invitation arrived; this opens over it, and the row can be answered
 * where it sits — NotificationList is the same component the full page
 * renders, so accepting from here is not a second, thinner code path.
 *
 * Only the newest few are drawn. The panel is a peek, not the archive:
 * `/notifications` is the archive, and the footer says so with the
 * number still below the fold.
 */

const PREVIEW = 6;

export default function NotificationBell({
  userId,
  audience = 'personal',
  seeAllHref = '/notifications',
  buttonClassName,
}: {
  userId: string | null;
  audience?: NotificationAudience;
  /** Where "See all notifications" goes. Organizers have their own list. */
  seeAllHref?: string;
  /** A bar with its own icon styling passes it here, and the button
   *  keeps nothing of its own but the anchoring the badge needs — two
   *  modules each declaring padding and colour would otherwise be
   *  settled by whichever landed later in the bundle. */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  /* Where the panel's top edge goes when it spans the screen — see the
   * mobile block in the stylesheet for why that is not a constant. */
  const [anchorTop, setAnchorTop] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /* On a phone the panel is a full-height sheet pinned to the viewport,
   * and it is drawn into <body> rather than beside the bell. The bars the
   * bell sits in slide with `transform`, and a transformed ancestor
   * becomes the box a `position: fixed` child is fixed to — the sheet was
   * squeezed into the header, off the top of the screen, whenever the
   * homepage nav had moved. Rendered at the top level it has nothing to
   * be trapped by. */
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setSheet(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const {
    items,
    unread,
    loading,
    error,
    markAllRead,
    answerInvite,
  } = useNotifications(userId, audience);

  /* Dismissal, both ways out. `mousedown` rather than `click` so a press
   * that starts outside closes it before the click lands on whatever is
   * underneath — otherwise the first click out is spent on the panel. */
  /* On a phone the panel is `fixed` and spans the viewport, so it needs
   * the bell's position in viewport coordinates rather than being able
   * to hang off it. Re-measured on scroll and resize because a fixed box
   * does not travel with the header the way an absolute one does. */
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      // A bar that has slid away leaves the bell above the screen; the
      // sheet then starts at the top rather than following it off.
      if (r) setAnchorTop(Math.max(10, r.bottom + 10));
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel may be portalled out of the wrapper, so check both.
      if (!wrapRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const preview = items.slice(0, PREVIEW);
  const hidden = items.length - preview.length;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName ? `${styles.bellBare} ${buttonClassName}` : styles.bellButton}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Bell size={21} strokeWidth={1.8} />
        {unread > 0 && (
          <span className={styles.bellBadge}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (() => {
        const panel = (
        <div
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label="Notifications"
          style={{ '--bell-bottom': `${anchorTop}px` } as CSSProperties}
        >
          <div className={styles.head}>
            <h2 className={styles.title}>Notifications</h2>
            {unread > 0 && (
              <button type="button" className={styles.markReadBtn} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.body}>
            <NotificationList
              items={preview}
              loading={loading}
              error={error}
              onAnswer={answerInvite}
              audience={audience}
            />
          </div>

          <Link href={seeAllHref} className={styles.seeAll} onClick={() => setOpen(false)}>
            {hidden > 0 ? `See all notifications (${items.length})` : 'See all notifications'}
          </Link>
        </div>
        );
        return sheet ? createPortal(panel, document.body) : panel;
      })()}
    </div>
  );
}
