/* ── The vocabulary, on both sides of the wire ────────────────────
 *
 * Everything in here is shared by the route handlers that write
 * notifications and the components that draw them. It lives apart from
 * `lib/notifications.ts` for one concrete reason: that module is
 * `server-only`, and the moment a client component needs more than a
 * type from it — an audience map, a kind list — the build fails.
 *
 * So: no imports, no data access, nothing that touches the service role.
 * Kinds, shapes, and the rule that turns a kind into an audience.
 * `lib/notifications.ts` re-exports all of it, so server code can keep
 * reading from the one place it always has.
 */

export type NotificationKind =
  | 'thumb_up'
  | 'team_invite'
  | 'invite_accepted'
  | 'invite_declined'
  | 'team_registered'
  | 'team_updated';

/* ── Which list a kind belongs in ─────────────────────────────────
 *
 * An organizer is also a player. The same account can be thumbed up on
 * Tuesday and take four registrations on Wednesday, and those two things
 * belong on two different screens — the profile is about the person, the
 * dashboard is about the event.
 *
 * The audience is derived from the kind rather than stored beside it,
 * because it is never an independent fact: a team_registered is
 * organizer-facing in every case there will ever be. Both lists are then
 * the same query with a different `kind in (...)`, which the existing
 * (recipient_id, created_at desc) index already serves. */
export type NotificationAudience = 'personal' | 'organizer';

export const NOTIFICATION_AUDIENCE: Record<NotificationKind, NotificationAudience> = {
  thumb_up: 'personal',
  team_invite: 'personal',
  invite_accepted: 'personal',
  invite_declined: 'personal',
  team_registered: 'organizer',
  team_updated: 'organizer',
};

export const KINDS_FOR: Record<NotificationAudience, NotificationKind[]> = {
  personal: (Object.keys(NOTIFICATION_AUDIENCE) as NotificationKind[])
    .filter(k => NOTIFICATION_AUDIENCE[k] === 'personal'),
  organizer: (Object.keys(NOTIFICATION_AUDIENCE) as NotificationKind[])
    .filter(k => NOTIFICATION_AUDIENCE[k] === 'organizer'),
};

export const isAudience = (v: unknown): v is NotificationAudience =>
  v === 'personal' || v === 'organizer';

/* What travels in the payload, per kind. Denormalised on purpose: a
 * notification should still read correctly after the team is renamed or
 * the tournament is gone, and drawing a list should not mean four joins
 * per row. */
export interface NotificationPayload {
  teamName?: string;
  tournamentTitle?: string;
  tournamentSlug?: string;
  divisionName?: string;
  /** The name on the roster slot, for the reply kinds. */
  playerName?: string;
  /** The roster as it reads everywhere else on the site — "Ananda / Mali".
   *  The organizer kinds lead with this rather than with the actor: a
   *  registration is the *team* arriving, and half of them are entered by
   *  nobody signed in at all. */
  teamDisplay?: string;
  /** team_updated: what the save actually touched, already in the words
   *  the row will use. Computed by diffing the stored team before and
   *  after, so it never claims a change that did not happen. */
  changed?: string[];
  /** The team, so the organizer can open it from the row. */
  teamId?: string;
}

export interface NotificationActor {
  userId: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  payload: NotificationPayload;
  /** Present on team_invite, and only while it can still be answered. */
  playerRowId: string | null;
  inviteStatus: 'pending' | 'accepted' | 'declined' | null;
  actor: NotificationActor;
  readAt: string | null;
  createdAt: string;
}
