import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabaseServer';
import { ensureOrganizerForUser, claimTeamsForUser, getOrganizerForUser } from '../../../lib/auth';
import { signInDestination } from '../../../lib/authRedirect';
import { ensureProfileForUser } from '../../../lib/profiles';
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

      await ensureOrganizerForUser(effectiveUser);

      /* Read the row, do not infer it from what provisioning returned.
       * ensureOrganizerForUser is gated on user_metadata.role and hands
       * back null for anyone whose metadata does not say 'organizer' —
       * including someone who added the capability later through
       * POST /api/auth/organizer, which writes the row and never touches
       * metadata. Holding the capability is what the organizers table
       * says, exactly as lib/auth.ts insists everywhere else. */
      isOrganizer = (await getOrganizerForUser(user.id)) !== null;
    } catch (err) {
      console.error('Failed to provision organizer on callback:', err);
    }

    /* Every account gets its player profile here, so it is searchable by
     * player ID from the moment it exists rather than from the first time
     * it happens to open /profile. */
    try {
      await ensureProfileForUser(user);
    } catch (err) {
      console.error('Failed to provision profile on callback:', err);
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

  /* Where an OAuth sign-in lands, decided by the same rule the password
   * form uses — signInDestination in lib/authRedirect.
   *
   * This used to redirect to `next` directly, which quietly beat the role:
   * a visitor who reached /login from the homepage carries `next=/`, so
   * picking the Organizer tab and signing in with Google dropped them back
   * on the homepage instead of their dashboard. signInDestination is built
   * for exactly that — it honours `next` only where it agrees with the
   * chosen destination, keeping a /dashboard next for an organizer and
   * dropping one that would send them somewhere else.
   *
   * The tab is a request, not a verdict: it only counts as organizer if
   * the account actually holds the capability, so someone who picks that
   * tab without an organizers row still lands on a page that works. */
  const role = roleParam === 'organizer' && isOrganizer ? 'organizer' : 'player';

  if (next) {
    return NextResponse.redirect(`${origin}${signInDestination(role, next)}`);
  }

  if (type === 'signup' || type === 'email') {
    return NextResponse.redirect(`${origin}/auth/confirmed`);
  }

  return NextResponse.redirect(`${origin}${signInDestination(role, null)}`);
}
