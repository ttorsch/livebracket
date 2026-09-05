import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { listNotifications, markRead } from '../../../../lib/notifications';

/* The signed-in account's own notifications.
 *
 * Scoped by the session, never by an id in the request — the where
 * clause is the whole of the authorization here, the same way
 * /api/me/invites works.
 *
 * The badge updates over Realtime rather than by polling this (see
 * hooks/useNotifications.ts); this is the read that fills the list, and
 * the one Realtime's insert events send the client back to. */

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { items, unread } = await listNotifications(user.id);
    return NextResponse.json({ items, unread });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load notifications' },
      { status: 500 }
    );
  }
}

/** Mark notifications read — the ones named, or every unread one. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : undefined;

  try {
    const marked = await markRead(user.id, ids);
    return NextResponse.json({ ok: true, marked });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mark read' },
      { status: 500 }
    );
  }
}
