'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export interface SavedPageState {
  scrollY: number;
  activeDiv?: string;
  activeTab?: string;
}

export function saveScrollPosition(
  path?: string,
  extraState?: { activeDiv?: string; activeTab?: string }
) {
  if (typeof window === 'undefined') return;
  const targetPath = path || window.location.pathname;
  try {
    const payload: SavedPageState = {
      scrollY: window.scrollY,
      activeDiv: extraState?.activeDiv,
      activeTab: extraState?.activeTab,
    };
    sessionStorage.setItem(`lb_scroll_${targetPath}`, JSON.stringify(payload));
    sessionStorage.setItem('lb_has_internal_history', '1');
  } catch {
    // Ignore storage quota or disabled errors
  }
}

/* `restoreScroll: false` restores the saved tab and division but leaves the
 * page where it loads — for a page that should always open at its own top,
 * whatever the reader was looking at before they left it. */
export function useRestoreScrollPosition(
  isReady: boolean = true,
  onRestoreState?: (state: { activeDiv?: string; activeTab?: string }) => void,
  options?: { restoreScroll?: boolean }
) {
  const restoreScroll = options?.restoreScroll !== false;
  const pathname = usePathname();
  const restoredRef = useRef(false);

  /* Opting out of the app's own restore is not enough on its own: the
     browser has a restore of its own, and history.scrollRestoration defaults
     to 'auto'. On a revisit — the back button, or simply opening a
     tournament you had scrolled through earlier — that put the reader
     halfway down the page before any of this ran, which looked exactly like
     the page scrolling itself on open. Turned off for as long as a page that
     wants its own top is mounted, and handed back afterwards so pages that
     do want the browser's behaviour keep it. */
  useEffect(() => {
    if (restoreScroll || typeof window === 'undefined' || !('scrollRestoration' in history)) return;
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = previous; };
  }, [restoreScroll]);

  useEffect(() => {
    if (!isReady || typeof window === 'undefined' || restoredRef.current) return;
    try {
      const key = `lb_scroll_${pathname}`;
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        let top = 0;
        let activeDiv: string | undefined;
        let activeTab: string | undefined;

        if (saved.startsWith('{')) {
          const parsed = JSON.parse(saved) as SavedPageState;
          top = parsed.scrollY || 0;
          activeDiv = parsed.activeDiv;
          activeTab = parsed.activeTab;
        } else {
          top = parseInt(saved, 10);
        }

        if (onRestoreState && (activeDiv || activeTab)) {
          onRestoreState({ activeDiv, activeTab });
        }

        if (restoreScroll && !isNaN(top) && top > 0) {
          restoredRef.current = true;
          // Apply scroll immediately and retry on subsequent layout frames
          // to ensure async content and dynamic image heights do not clamp the scroll position.
          const delays = [0, 40, 120, 250, 500];
          delays.forEach((delay) => {
            setTimeout(() => {
              window.scrollTo({ top, behavior: 'instant' });
            }, delay);
          });
        }
        setTimeout(() => {
          sessionStorage.removeItem(key);
        }, 1000);
      }
    } catch {
      // Ignore storage errors
    }
  }, [pathname, isReady, onRestoreState, restoreScroll]);
}

/* Builds the /login link for a public "Sign in" control.
 *
 * Three things ride along. `role` picks which tab opens — a destination hint,
 * never a claim about the account. `mode` picks which form opens on top of
 * that tab: a control that promises a new account ("Create a tournament")
 * passes 'signup' so the visitor lands on the sign-up form instead of a
 * login form they cannot yet fill in. `next` is where the person already was,
 * so signing in resumes the page they were reading (a tournament, the
 * registration form, the homepage) instead of dumping them on /profile.
 *
 * Only the pathname is carried, not the query string: the login form
 * refuses anything that is not a same-origin path, and a bare path is the
 * part that reliably identifies where they were. */
export function useSignInHref(
  role: 'player' | 'organizer' = 'player',
  mode?: 'signup'
): string {
  const pathname = usePathname();

  const params = new URLSearchParams({ role });
  if (mode) params.set('mode', mode);
  if (pathname && pathname !== '/login' && !pathname.startsWith('/auth')) {
    params.set('next', pathname);
  }
  return `/login?${params.toString()}`;
}
