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

export type NotificationKind = 'thumb_up' | 'team_invite' | 'invite_accepted' | 'invite_declined';

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
  limit = 50,
): Promise<{ items: NotificationItem[]; unread: number }> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id, kind, payload, player_row_id, actor_id, read_at, created_at')
    .eq('recipient_id', userId)
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
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  let query = supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null);

  if (ids && ids.length > 0) query = query.in('id', ids.slice(0, 200));

  const { data, error } = await query.select('id');
  if (error) throw new Error(`Failed to mark read: ${error.message}`);
  return (data ?? []).length;
}
