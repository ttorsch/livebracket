'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function saveScrollPosition(path?: string) {
  if (typeof window === 'undefined') return;
  const targetPath = path || window.location.pathname;
  try {
    sessionStorage.setItem(`lb_scroll_${targetPath}`, window.scrollY.toString());
  } catch {
    // Ignore storage quota or disabled errors
  }
}

export function useRestoreScrollPosition() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = `lb_scroll_${pathname}`;
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        const top = parseInt(saved, 10);
        if (!isNaN(top) && top > 0) {
          requestAnimationFrame(() => {
            window.scrollTo({ top, behavior: 'instant' });
          });
        }
        sessionStorage.removeItem(key);
      }
    } catch {
      // Ignore storage errors
    }
  }, [pathname]);
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
