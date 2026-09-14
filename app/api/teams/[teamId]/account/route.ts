import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { resolveTeamEditAccess, readTeamEditSession } from '../../../../../lib/teamEditAccess';
import { ensureProfileForUser } from '../../../../../lib/profiles';

/* ── An account, offered at the one moment it is easy ─────────────
 *
 * Someone has just proved they control the team's contact address by
 * typing a code we mailed to it. That is the same thing Supabase's own
 * confirmation link proves, which is why the account created here is
 * created *already confirmed* — sending a second email, minutes after the
 * first, to the address the first one just validated, would be asking
 * them to prove the same fact twice.
 *
 * That makes this the only route in the app that can mint a confirmed
 * account, so the rules are narrow and none of them are negotiable:
 *
 *   1. The address is `session.destination` — the address the code was
 *      actually delivered to. Never the request body, and never the
 *      team's current contact_email, which may have changed since.
 *   2. The session's channel must be `email`. A WhatsApp code proves a
 *      phone number; it says nothing about an inbox, and must never
 *      produce an email-confirmed account.
 *   3. No session, no account. The cookie is checked against Redis on
 *      every call, exactly as editing is.
 *
 * Whether an address already has an account is answered by trying, not
 * by asking. An endpoint that reports "this email is registered" is a
 * user-enumeration oracle; `createUser` already tells us, and the caller
 * finds out only about the address they just proved they own.
 */

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Short enough not to nag, long enough to be worth requiring. Matches
 *  Supabase's own default minimum rather than inventing a second rule. */
const MIN_PASSWORD = 6;

interface Body {
  password?: string;
  /** Which roster slot is them, so the account links to the player row. */
  playerId?: string | null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  const access = await resolveTeamEditAccess(teamId);
  if (!access) return bad('Team not found', 404);

  /* Rule 3, then rule 2. Note this deliberately does not accept `via:
   * 'account'` or `'organizer'` — someone already signed in has no use
   * for this, and an organizer must not be able to mint accounts for
   * other people's addresses. */
  const session = await readTeamEditSession(teamId);
  if (!session) return bad('Confirm your team contact first', 403);
  if (session.channel !== 'email') {
    return bad('An account needs an email address confirmed by email', 400);
  }

  const email = session.destination; // Rule 1.
  const body = (await request.json().catch(() => ({}))) as Body;
  const password = body.password ?? '';
  if (password.length < MIN_PASSWORD) {
    return bad(`Choose a password of at least ${MIN_PASSWORD} characters`);
  }

  /* The roster slot, checked against this team rather than trusted. An
   * already-linked slot is refused: claiming to be someone who has their
   * own account is exactly what the invite flow exists to mediate. */
  let player: { id: string; name: string } | null = null;
  if (body.playerId) {
    const match = access.team.players.find((p) => p.id === body.playerId);
    if (!match) return bad('That player is not on this team');
    if (match.userId) return bad('That player already has an account linked');
    player = { id: match.id, name: match.name };
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...(player ? { full_name: player.name } : {}),
      /* An intent, read once by ensureOrganizerForUser — the same field
       * the signup form sets, and authorising nothing on its own. */
      role: 'player',
    },
  });

  if (createError) {
    /* The address is already registered. Told plainly, because the caller
     * has already proved this inbox is theirs — there is nothing here
     * they could not discover with a password reset. */
    if (/already/i.test(createError.message) || createError.status === 422) {
      return NextResponse.json({ exists: true, email }, { status: 409 });
    }
    console.error('Failed to create account from team edit:', createError.message);
    return bad('Could not create the account', 500);
  }

  const user = created.user;
  if (!user) return bad('Could not create the account', 500);

  /* The profile is normally minted at the first authenticated request.
   * Doing it here means the player id and name exist before the browser
   * has even signed in, so the card behind the modal is right first time. */
  try {
    await ensureProfileForUser(user);
  } catch (error) {
    console.error('Profile creation failed after signup:', error);
  }

  if (player) {
    /* 'accepted', not the column's 'none' default: the register route
     * writes 'accepted' whenever the person filling the form is the
     * account on the slot, and this is that same assertion. Leaving it
     * 'none' made a linked slot look like a hand-typed name. */
    const { error } = await supabaseAdmin
      .from('players')
      .update({ user_id: user.id, invite_status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', player.id)
      .eq('team_id', teamId)
      .is('user_id', null); // Lost race: someone else linked it first.
    if (error) console.error('Failed to link roster slot to new account:', error.message);
  }

  /* The team itself is claimed by the browser calling /api/auth/claim
   * after it signs in, which is the path every other sign-in already
   * takes. Doing it here as well would be a second implementation of a
   * rule that must only have one. */
  return NextResponse.json({ ok: true, email });
}
