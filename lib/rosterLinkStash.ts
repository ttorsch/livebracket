/* ── A choice that has to outlive a redirect ──────────────────────
 *
 * Signing in with Facebook takes the browser to Facebook and back, and
 * the modal that asked "which one of these is you" does not survive the
 * trip. The answer does, here, until the page comes back with a session
 * and can act on it.
 *
 * sessionStorage rather than localStorage: this is true for one tab and
 * for the next few seconds, and an answer that outlived the tab would be
 * a stale claim waiting to be applied to whoever signs in next.
 *
 * Nothing here is trusted. It names a roster slot, not an account — the
 * account comes from the session at the other end, and the API re-checks
 * that the caller may touch this team at all. The worst a tampered stash
 * can do is fail.
 *
 * Every read and write is guarded: Safari in private mode throws on
 * sessionStorage rather than returning null, and losing the stash must
 * only ever mean the slot stays unlinked.
 */

const KEY = 'lb_roster_link';

export interface RosterLinkStash {
  teamId: string;
  playerId: string;
  /* Stale entries are dropped rather than applied. A sign-in that took
     ten minutes is no longer the one that made this choice. */
  at: number;
}

const MAX_AGE_MS = 15 * 60 * 1000;

export function stashRosterLink(teamId: string, playerId: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ teamId, playerId, at: Date.now() }));
  } catch {
    /* No stash means no link, which is the same as never choosing. */
  }
}

export function readRosterLink(): RosterLinkStash | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RosterLinkStash>;
    if (typeof parsed?.teamId !== 'string' || typeof parsed?.playerId !== 'string') return null;
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return { teamId: parsed.teamId, playerId: parsed.playerId, at: parsed.at };
  } catch {
    return null;
  }
}

export function clearRosterLink(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Ignored: a stash that cannot be cleared expires on its own. */
  }
}
