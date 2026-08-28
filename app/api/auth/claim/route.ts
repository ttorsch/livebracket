import { NextResponse } from 'next/server';
import { getCurrentUser, claimTeamsForUser } from '../../../../lib/auth';

/* Attaches this account's anonymous registrations to it.
 *
 * The password sign-in never passes through /auth/callback — it happens in
 * the browser against Supabase directly — so the login form calls this
 * afterwards to cover the same ground the callback covers for OAuth and
 * email links.
 *
 * A POST rather than part of GET /api/auth/session because it writes, and
 * the endpoint that reports who you are should not also change your data.
 *
 * Safe to call on every sign-in: claimTeamsForUser only ever moves unowned
 * rows matching the caller's own verified address, so a second call finds
 * nothing left to do. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  try {
    return NextResponse.json({ claimed: await claimTeamsForUser(user) });
  } catch (err) {
    /* Not the sign-in's problem. The visitor is authenticated either way;
     * the cost of failing here is a profile listing that is missing rows
     * until the next sign-in retries it. */
    console.error('Failed to claim registrations:', err);
    return NextResponse.json({ claimed: 0 });
  }
}
