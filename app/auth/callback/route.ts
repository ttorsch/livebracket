import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { ensureOrganizerForUser, claimTeamsForUser } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

/* The single landing point for every link Supabase sends a user back on:
 * OAuth returns (Google/Facebook), email confirmations, and the recovery
 * link behind password resets. Each arrives as a one-time `code` that has
 * to be exchanged for a session server-side, which is what puts the auth
 * cookie in place — the reason we can no longer point these redirects
 * straight at /profile the way the old client-only flow did. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const type = searchParams.get('type');
  const roleParam = searchParams.get('role');

  const errorDescription = searchParams.get('error_description');
  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/auth/auth-error?message=${encodeURIComponent(errorDescription)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/auth-error?message=${encodeURIComponent('This link is missing its sign-in code.')}`
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/auth-error?message=${encodeURIComponent(error.message)}`
    );
  }

  const user = data.user;

  /* A recovery link must land on the form that changes the password, never
   * on the dashboard — the session it just created is the one thing that
   * lets them set a new one. */
  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  /* First authenticated moment is where a chosen organizer role becomes a
   * real organizers row. Doing it here rather than at sign-up time means it
   * also covers OAuth users, who never touch the sign-up form. */
  let isOrganizer = false;
  if (user) {
    try {
      /* An OAuth user never filled in the sign-up form, so their role
       * choice arrives on the callback URL instead. Record it only if they
       * have none yet — otherwise re-signing in through the other tab
       * would silently rewrite an existing account's role. */
      let effectiveUser = user;
      if (!user.user_metadata?.role && (roleParam === 'organizer' || roleParam === 'player')) {
        const { data: updated } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: { ...user.user_metadata, role: roleParam },
        });
        if (updated?.user) effectiveUser = updated.user;
      }

      isOrganizer = (await ensureOrganizerForUser(effectiveUser)) !== null;
    } catch (err) {
      console.error('Failed to provision organizer on callback:', err);
    }

    /* The same first authenticated moment is where any team they entered
     * anonymously — before this account existed, or while signed out —
     * becomes visible on their profile. Its own try/catch: a failed claim
     * must not cost them the sign-in they just completed. */
    try {
      await claimTeamsForUser(user);
    } catch (err) {
      console.error('Failed to claim registrations on callback:', err);
    }
  }

  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (type === 'signup' || type === 'email') {
    return NextResponse.redirect(`${origin}/auth/confirmed`);
  }

  return NextResponse.redirect(`${origin}${isOrganizer ? '/dashboard' : '/profile'}`);
}
