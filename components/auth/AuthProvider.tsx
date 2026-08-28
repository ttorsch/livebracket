'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { type SessionInfo, SIGNED_OUT } from '@/lib/session';

/* One answer to "who is signed in", shared by every client component.
 *
 * The value is seeded on the server in app/layout.tsx, which matters more
 * than it sounds: a provider that fetched on mount would paint the
 * signed-out header first and flip a moment later, on every page load. By
 * the time this component hydrates it already knows.
 *
 * There is no cache to invalidate. The server layout re-runs on every
 * navigation and on router.refresh(), and the effect below adopts whatever
 * it produced — so signing in, signing out, or adding the organizer
 * capability all reach the header without anything here being told about
 * it. `refresh()` exists only for the case where the session changed
 * without a server round trip to hang it on. */

interface AuthContextValue {
  session: SessionInfo;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: SIGNED_OUT,
  refresh: async () => {},
});

export function AuthProvider({
  initialSession,
  children,
}: {
  initialSession: SessionInfo;
  children: React.ReactNode;
}) {
  const [refreshed, setRefreshed] = useState<SessionInfo | null>(null);
  const [lastFromServer, setLastFromServer] = useState(initialSession);

  /* Adjusting state during render, not in an effect: a fresh answer from
   * the server supersedes whatever refresh() last fetched, and doing it
   * here means the very first paint after a navigation already shows it
   * rather than rendering the stale value and correcting itself. */
  if (lastFromServer !== initialSession) {
    setLastFromServer(initialSession);
    setRefreshed(null);
  }

  const session = refreshed ?? initialSession;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!res.ok) return;
      setRefreshed((await res.json()) as SessionInfo);
    } catch {
      /* Offline or mid-deploy. Keeping the last known session beats
       * blanking the header on a failed poll. */
    }
  }, []);

  return (
    <AuthContext.Provider value={{ session, refresh }}>{children}</AuthContext.Provider>
  );
}

/* The session, for drawing decisions only — what to show, never what to
 * allow. Anything that guards data re-checks on the server. */
export function useSession(): SessionInfo {
  return useContext(AuthContext).session;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
