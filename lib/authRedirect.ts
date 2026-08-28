/* Where a sign-in lands.
 *
 * Kept dependency-free on purpose: middleware, the login form and the tests
 * all import it, so it must not pull in `server-only` or next/headers.
 *
 * The subtlety is `next`. Public "Sign in" controls attach the page the
 * visitor was reading, which is the right answer for a player and the wrong
 * one for an organizer — someone who picked the Organizer tab asked for
 * their dashboard, not to be dropped back on the homepage they happened to
 * start from. So `next` is honoured only where it agrees with the chosen
 * destination. */

export type SignInRole = 'player' | 'organizer';

/* Auth surfaces are never a landing target — redirecting to one loops. */
const AUTH_PATHS = ['/login', '/forgot-password', '/reset-password', '/auth'];

/* A `next` is usable only if it is a same-origin path. A protocol-relative
 * value like //evil.example is a URL to another host, so it is refused:
 * otherwise the login becomes an open redirect. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (AUTH_PATHS.some((p) => raw === p || raw.startsWith(`${p}/`) || raw.startsWith(`${p}?`))) {
    return null;
  }
  return raw;
}

export function isOrganizerPath(path: string): boolean {
  return path === '/dashboard' || path.startsWith('/dashboard/');
}

export function signInDestination(role: SignInRole, rawNext: string | null | undefined): string {
  const next = safeNext(rawNext);

  if (role === 'organizer') {
    /* Only an organizer-area `next` survives — that is the case worth
     * keeping, where middleware bounced them off /dashboard/tournament/x
     * and should return them to it after signing in. */
    return next && isOrganizerPath(next) ? next : '/dashboard';
  }

  /* A player cannot use the dashboard, so a /dashboard next is dropped
   * rather than followed into a redirect back out again. */
  return next && !isOrganizerPath(next) ? next : '/profile';
}
