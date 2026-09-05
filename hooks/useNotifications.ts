'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { NotificationItem } from '../lib/notifications';

/* ── The list, and the badge that keeps up with it ────────────────
 *
 * Two halves that have to agree:
 *
 *  · The *list* comes from /api/me/notifications, which reads through
 *    the service role and can join the actor's profile and the
 *    invitation's current status onto each row. A Realtime payload
 *    carries none of that — it is the bare row — so a new one is a
 *    signal to re-read rather than something to append.
 *
 *  · The *badge* moves the moment a row lands. The subscription is
 *    filtered to this account, and the RLS policy in 0018 is what makes
 *    that filter a permission rather than a request: without it, anyone
 *    with the anon key could ask for everyone's.
 *
 * If Realtime never connects — a dropped socket, a proxy that eats
 * websockets — the list is still correct on every mount and after every
 * action. What is lost is only the liveness.
 */

const unreadIdsOf = (items: NotificationItem[]) =>
  items.filter(i => !i.readAt).map(i => i.id);

interface State {
  items: NotificationItem[];
  unread: number;
  loading: boolean;
  error: string | null;
}

export function useNotifications(userId: string | null) {
  const [state, setState] = useState<State>({
    items: [],
    unread: 0,
    loading: !!userId,
    error: null,
  });
  /* Refresh is called from a subscription callback that outlives any one
   * render, so it is held rather than closed over. */
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({ items: [], unread: 0, loading: false, error: null });
      return;
    }
    try {
      const res = await fetch('/api/me/notifications');
      if (!res.ok) throw new Error('Could not load notifications');
      const body = await res.json();
      if (!alive.current) return;
      setState({
        items: (body.items ?? []) as NotificationItem[],
        unread: (body.unread ?? 0) as number,
        loading: false,
        error: null,
      });
    } catch (err) {
      if (!alive.current) return;
      setState(s => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Could not load notifications',
      }));
    }
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => { alive.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let dropped = false;

    (async () => {
      /* The socket carries its own credential, separate from the cookie
       * the REST calls use. Without this the subscription authenticates
       * as anon, the RLS policy matches nothing, and the badge simply
       * never moves — no error anywhere, which is the worst way for this
       * to fail. */
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (dropped) return;

      /* One channel per account. The filter is applied server-side, and
       * the policy behind it is what makes the filter a permission. */
      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_id=eq.${userId}`,
          },
          () => { refresh(); },
        )
        .subscribe();
    })();

    return () => {
      dropped = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  /** Mark everything read. The badge clears immediately — the server is
   *  being told the same thing, and a badge that lingers while the list
   *  is plainly open reads as broken. */
  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const unreadIds = unreadIdsOf(state.items);
    if (unreadIds.length === 0) return;

    setState(s => ({
      ...s,
      unread: 0,
      items: s.items.map(i => (i.readAt ? i : { ...i, readAt: new Date().toISOString() })),
    }));

    try {
      await fetch('/api/me/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds }),
      });
    } catch {
      /* The rows are still unread server-side; the next load says so. */
    }
  }, [userId, state.items]);

  /** Answer an invitation from the list itself. */
  const answerInvite = useCallback(
    async (playerRowId: string, action: 'accept' | 'decline') => {
      const res = await fetch(`/api/me/invites/${playerRowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'That invitation is no longer open');
      await refresh();
      return body.status as 'accepted' | 'declined';
    },
    [refresh],
  );

  return { ...state, refresh, markAllRead, answerInvite };
}
