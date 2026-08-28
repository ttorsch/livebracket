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
  } catch {
    // Ignore storage quota or disabled errors
  }
}

export function useRestoreScrollPosition(
  isReady: boolean = true,
  onRestoreState?: (state: { activeDiv?: string; activeTab?: string }) => void
) {
  const pathname = usePathname();
  const restoredRef = useRef(false);

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

        if (!isNaN(top) && top > 0) {
          restoredRef.current = true;
          requestAnimationFrame(() => {
            setTimeout(() => {
              window.scrollTo({ top, behavior: 'instant' });
            }, 30);
          });
        }
        sessionStorage.removeItem(key);
      }
    } catch {
      // Ignore storage errors
    }
  }, [pathname, isReady, onRestoreState]);
}

/* Builds the /login link for a public "Sign in" control.
 *
 * Two things ride along. `role` picks which tab opens — a destination hint,
 * never a claim about the account. `next` is where the person already was,
 * so signing in resumes the page they were reading (a tournament, the
 * registration form, the homepage) instead of dumping them on /profile.
 *
 * Only the pathname is carried, not the query string: the login form
 * refuses anything that is not a same-origin path, and a bare path is the
 * part that reliably identifies where they were. */
export function useSignInHref(role: 'player' | 'organizer' = 'player'): string {
  const pathname = usePathname();

  const params = new URLSearchParams({ role });
  if (pathname && pathname !== '/login' && !pathname.startsWith('/auth')) {
    params.set('next', pathname);
  }
  return `/login?${params.toString()}`;
}
