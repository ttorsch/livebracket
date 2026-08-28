import { NextResponse } from 'next/server';
import { getSessionInfo } from '../../../../lib/auth';

/* Who the caller is, decided on the server and reported as a set — every
 * account is a player, and an organizers row adds organizer on top.
 *
 * The same resolver the root layout uses (getSessionInfo), so the header
 * rendered on the server and anything re-read here can never disagree.
 * This endpoint is for the cases with no server render to hang the answer
 * on: the login form checking what it just signed into, and
 * AuthProvider.refresh().
 *
 * Strictly read-only: it never provisions. The login form asks this instead
 * of reading user_metadata, because metadata is a claim the browser can
 * write and the organizers table is not. */
export async function GET() {
  return NextResponse.json(await getSessionInfo());
}
