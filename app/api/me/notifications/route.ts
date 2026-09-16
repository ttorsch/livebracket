import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { isAudience, listNotifications, markRead } from '../../../../lib/notifications';

/* The signed-in account's own notifications.
 *
 * Scoped by the session, never by an id in the request — the where
 * clause is the whole of the authorization here, the same way
 * /api/me/invites works.
 *
 * The badge updates over Realtime rather than by polling this (see
 * hooks/useNotifications.ts); this is the read that fills the list, and
 * the one Realtime's insert events send the client back to. */

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  /* Which list is being drawn. The profile asks for `personal`, the
   * dashboard for `organizer`; the same account may hold both and they
   * are two different screens. An absent or unrecognised value returns
   * everything, which is the honest answer to a caller that did not say.
   * It is a view filter, never a permission — the recipient check inside
   * listNotifications is still the whole of the authorization. */
  const requested = request.nextUrl.searchParams.get('audience');
  const audience = isAudience(requested) ? requested : undefined;

  try {
    const { items, unread } = await listNotifications(user.id, { audience });
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

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; audience?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : undefined;
  /* Scoped the same way the list is: "mark all read" on the dashboard
   * must not clear the badge on the profile. */
  const audience = isAudience(body.audience) ? body.audience : undefined;

  try {
    const marked = await markRead(user.id, ids, audience);
    return NextResponse.json({ ok: true, marked });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mark read' },
      { status: 500 }
    );
  }
}
