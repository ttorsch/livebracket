import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';

/* ── Telling one player about another ─────────────────────────────
 *
 * A notification is an *addressed* copy of something that already
 * happened elsewhere: a roster slot claiming to be you (0016), or a
 * thumb-up row. The copy exists because neither of those is something a
 * player would ever find by looking.
 *
 * Writing one is best-effort by design — see `notify`. The thing being
 * announced has already been recorded by the time we get here, and a
 * failure to announce it must never fail the registration or the reply
 * that caused it.
 */

/* The vocabulary — kinds, audiences, payload and item shapes — lives in
 * ./notificationKinds so client components can import it without
 * dragging `server-only` into the browser bundle. Re-exported here so
 * server code still has one place to read from. */
export * from './notificationKinds';
import {
  KINDS_FOR,
  type NotificationAudience,
  type NotificationActor,
  type NotificationItem,
  type NotificationKind,
  type NotificationPayload,
} from './notificationKinds';

interface NotifyInput {
  recipientId: string;
  actorId: string | null;
  kind: NotificationKind;
  payload?: NotificationPayload;
  playerRowId?: string | null;
}

/* Record one.
 *
 * Never throws and never returns a failure worth acting on: every caller
 * is a route that has already done the thing being announced, and an
 * unreachable notifications table is not a reason to tell the user their
 * registration failed. It returns whether the row landed so a caller can
 * log, not so it can branch. */
export async function notify(input: NotifyInput): Promise<boolean> {
  // Nobody needs telling about their own doing.
  if (input.actorId && input.actorId === input.recipientId) return false;

  try {
    const { error } = await supabaseAdmin.from('notifications').insert({
      recipient_id: input.recipientId,
      actor_id: input.actorId,
      kind: input.kind,
      payload: input.payload ?? {},
      player_row_id: input.playerRowId ?? null,
    });
    if (error) {
      console.error('notify failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('notify failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/* Several at once, for the invited half of a roster. One insert rather
 * than one per player: a doubles team is two rows, but a format with
 * six is six round trips for no reason. */
export async function notifyMany(inputs: NotifyInput[]): Promise<number> {
  const rows = inputs
    .filter(i => !i.actorId || i.actorId !== i.recipientId)
    .map(i => ({
      recipient_id: i.recipientId,
      actor_id: i.actorId,
      kind: i.kind,
      payload: i.payload ?? {},
      player_row_id: i.playerRowId ?? null,
    }));
  if (rows.length === 0) return 0;

  try {
    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) {
      console.error('notifyMany failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.error('notifyMany failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  payload: NotificationPayload | null;
  player_row_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

/* The list, newest first, with everything a row needs to draw itself.
 *
 * Two follow-up reads rather than embeds: the actor lives in `profiles`
 * with no foreign key PostgREST can traverse (actor_id points at
 * auth.users), and the invite's current status has to come from the
 * `players` row itself — the payload cannot carry it, because it changes
 * after the notification is written. */
export async function listNotifications(
  userId: string,
  opts: { audience?: NotificationAudience; limit?: number } = {},
): Promise<{ items: NotificationItem[]; unread: number }> {
  const limit = opts.limit ?? 50;

  let query = supabaseAdmin
    .from('notifications')
    .select('id, kind, payload, player_row_id, actor_id, read_at, created_at')
    .eq('recipient_id', userId);

  /* Asking for one audience is asking for its kinds. Omitting it returns
   * everything, which is what a caller that is not a screen wants. */
  if (opts.audience) query = query.in('kind', KINDS_FOR[opts.audience]);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load notifications: ${error.message}`);
  const rows = (data ?? []) as NotificationRow[];

  const actorIds = [...new Set(rows.map(r => r.actor_id).filter((id): id is string => !!id))];
  const actors = new Map<string, NotificationActor>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, avatar_url')
      .in('id', actorIds);
    profiles?.forEach(p => {
      actors.set(p.id as string, {
        userId: p.id as string,
        name: (p.name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    });
  }

  const inviteIds = [...new Set(rows.map(r => r.player_row_id).filter((id): id is string => !!id))];
  const inviteStatus = new Map<string, 'pending' | 'accepted' | 'declined'>();
  if (inviteIds.length > 0) {
    const { data: players } = await supabaseAdmin
      .from('players')
      .select('id, invite_status')
      .in('id', inviteIds);
    players?.forEach(p => {
      const s = p.invite_status as string;
      if (s === 'pending' || s === 'accepted' || s === 'declined') {
        inviteStatus.set(p.id as string, s);
      }
    });
  }

  const items: NotificationItem[] = rows.map(r => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    playerRowId: r.player_row_id,
    inviteStatus: r.player_row_id ? inviteStatus.get(r.player_row_id) ?? null : null,
    actor: actors.get(r.actor_id ?? '') ?? { userId: r.actor_id, name: null, avatarUrl: null },
    readAt: r.read_at,
    createdAt: r.created_at,
  }));

  return { items, unread: items.filter(i => !i.readAt).length };
}

/* Mark them read. Scoped by recipient rather than trusting the ids: the
 * list is the only place they come from, but an id in a request body is
 * an id anyone can type. */
export async function markRead(
  userId: string,
  ids?: string[],
  audience?: NotificationAudience,
): Promise<number> {
  let query = supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null);

  /* "Mark all read" means all of *this list*. Without the audience the
   * dashboard's button would silently clear the profile's badge too —
   * the two screens share a table, not a meaning. */
  if (audience) query = query.in('kind', KINDS_FOR[audience]);
  if (ids && ids.length > 0) query = query.in('id', ids.slice(0, 200));

  const { data, error } = await query.select('id');
  if (error) throw new Error(`Failed to mark read: ${error.message}`);
  return (data ?? []).length;
}

/* ── Who to tell about a tournament ───────────────────────────────
 *
 * Two hops, and deliberately not one embedded select: `organizer_id`
 * names a row in `organizers`, but a notification is addressed to an
 * auth user, and the two are only joined by `organizers.auth_user_id`.
 *
 * Null is an ordinary answer, not a failure. An organizer account made
 * before sign-in existed has no auth user behind it, and a tournament
 * whose organizer row has gone has nobody to tell — in both cases the
 * caller should carry on and skip the announcement. Errors are swallowed
 * for the same reason every write in this file is best-effort: the
 * registration has already happened.
 */
export async function organizerUserIdForTournament(slug: string): Promise<string | null> {
  try {
    const { data: tournament } = await supabaseAdmin
      .from('tournaments')
      .select('organizer_id')
      .eq('slug', slug)
      .maybeSingle();

    const organizerId = (tournament as { organizer_id?: string | null } | null)?.organizer_id;
    if (!organizerId) return null;

    const { data: organizer } = await supabaseAdmin
      .from('organizers')
      .select('auth_user_id')
      .eq('id', organizerId)
      .maybeSingle();

    return (organizer as { auth_user_id?: string | null } | null)?.auth_user_id ?? null;
  } catch (err) {
    console.error('organizerUserIdForTournament failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
