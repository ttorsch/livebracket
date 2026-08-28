/* The session as the UI sees it.
 *
 * Deliberately free of `server-only` and of every Supabase import: the root
 * layout fills this in on the server, the AuthProvider hands it to client
 * components, and /api/auth/session returns the same shape. One definition
 * so those three can never drift.
 *
 * Note what is not here. There is no `role` field, because roles are
 * additive (see lib/auth.ts) — `roles` is a set, and holding 'organizer'
 * is a capability rather than an identity. And nothing in this object is
 * trusted for authorization: it is what to draw, not what to allow. Every
 * guard re-checks on the server. */

export type Role = 'player' | 'organizer';

/* The organizer identity, kept apart from the player one above.
 *
 * The same account can be both, and the two are deliberately not the same
 * person as far as the app is concerned: a player profile is who you are
 * on a roster, an organizer profile is who runs the event — the name and
 * photo printed on the public event page. Editing one never touches the
 * other, which is why these are separate fields rather than one identity
 * with a fallback. */
export interface OrganizerIdentity {
  id: string;
  name: string | null;
  hometown: string | null;
  club: string | null;
  avatarUrl: string | null;
}

export interface SessionInfo {
  signedIn: boolean;
  roles: Role[];
  userId: string | null;
  /* Their own organizer id, so the dashboard can scope its listing. */
  organizerId: string | null;
  /* Null for an account that only plays. */
  organizer: OrganizerIdentity | null;
  email: string | null;
  name: string | null;
  club: string | null;
  hometown: string | null;
  avatarUrl: string | null;
  /* The 8-digit code this account shares so a teammate can add them to a
   * roster. Null only before the profile row exists — every signed-in
   * account has one from its first authenticated moment. */
  playerId: string | null;
}

export const SIGNED_OUT: SessionInfo = {
  signedIn: false,
  roles: [],
  userId: null,
  organizerId: null,
  organizer: null,
  email: null,
  name: null,
  club: null,
  hometown: null,
  avatarUrl: null,
  playerId: null,
};

export function isOrganizer(session: SessionInfo): boolean {
  return session.roles.includes('organizer');
}

/* The one or two letters shown in the header avatar when there is no
 * picture. Falls back through name → email → a neutral mark, so it never
 * renders empty for an account that has only ever supplied an address. */
export function initialsFor(session: SessionInfo): string {
  const source = session.name?.trim() || session.email?.split('@')[0]?.trim() || '';
  if (!source) return '·';

  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
