import 'server-only';
import { type User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from './supabaseServer';
import { supabaseAdmin } from './supabaseAdmin';
import { type Role, type SessionInfo, SIGNED_OUT } from './session';

export interface Organizer {
  id: string;
  auth_user_id: string;
  email: string;
  name: string;
  club: string | null;
  hometown: string | null;
  avatar_url: string | null;
}

/* Roles are additive, not exclusive. Every account is a player — that is
 * the baseline of having signed up at all. An `organizers` row adds the
 * organizer capability on top; it never replaces the player one. So the
 * answer to "what is this account" is a set, and the login tabs choose a
 * destination rather than an identity.
 *
 * The type itself lives in lib/session.ts: this module is server-only, and
 * client components need to name a Role too. */
export type { Role };

export function rolesFor(organizer: Organizer | null): Role[] {
  return organizer ? ['player', 'organizer'] : ['player'];
}

/* The signed-in user, verified against the Supabase auth server rather than
 * decoded from the cookie. Always prefer this over reading the session
 * locally: a cookie is whatever the client sent, `getUser()` is what the
 * auth server will actually vouch for. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/* Find the organizer row belonging to this auth user, if they have one.
 * Uses the service role client so the lookup is not bound to RLS —
 * critical during the provisionOrganizer step where the user is signed in
 * but does not yet own the row they are about to link. */
export async function getOrganizerForUser(userId: string): Promise<Organizer | null> {
  const { data, error } = await supabaseAdmin
    .from('organizers')
    .select('id, auth_user_id, email, name, club, hometown, avatar_url')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load organizer: ${error.message}`);
  return (data as Organizer | null) ?? null;
}

/* Convenience for the common "who is hitting this route" question. */
export async function getCurrentOrganizer(): Promise<Organizer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return getOrganizerForUser(user.id);
}

export async function getCurrentRoles(): Promise<Role[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return rolesFor(await getOrganizerForUser(user.id));
}

/* The whole session in the shape the UI wants it, resolved on the server.
 *
 * The single source for both the root layout (which seeds AuthProvider, so
 * the header renders signed-in on the first paint rather than flipping) and
 * GET /api/auth/session (which the client uses to re-read after signing in
 * or out). Two callers, one answer.
 *
 * Never throws. A missing or misconfigured Supabase returns "signed out"
 * the same way middleware.ts fails open — a broken env var should not take
 * the public pages down with it. */
export async function getSessionInfo(): Promise<SessionInfo> {
  try {
    const user = await getCurrentUser();
    if (!user) return SIGNED_OUT;

    const organizer = await getOrganizerForUser(user.id);

    return {
      signedIn: true,
      roles: rolesFor(organizer),
      userId: user.id,
      organizerId: organizer?.id ?? null,
      email: user.email ?? null,
      name:
        organizer?.name ??
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
      club:
        organizer?.club ??
        (user.user_metadata?.club as string | undefined) ??
        null,
      hometown:
        organizer?.hometown ??
        (user.user_metadata?.hometown as string | undefined) ??
        (user.user_metadata?.location as string | undefined) ??
        null,
      avatarUrl:
        organizer?.avatar_url ??
        (user.user_metadata?.avatar_url as string | undefined) ??
        (user.user_metadata?.picture as string | undefined) ??
        null,
    };
  } catch (err) {
    console.error('Failed to resolve session:', err);
    return SIGNED_OUT;
  }
}

/* The one place an organizers row is ever created. Idempotent, and safe to
 * race: two concurrent callers converge on the same row.
 *
 * Adopting by email matters for two real cases — an organizer seeded before
 * they had a login, and someone who signed up as a player first and is now
 * adding the organizer capability to the same address. */
async function provisionOrganizer(
  user: User,
  opts: { name?: string; club?: string } = {}
): Promise<Organizer | null> {
  const existing = await getOrganizerForUser(user.id);
  if (existing) return existing;

  const email = user.email;
  if (!email) return null;

  const name =
    opts.name?.trim() ||
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim() ||
    email.split('@')[0];
  const club = opts.club?.trim() || null;

  const { data: byEmail } = await supabaseAdmin
    .from('organizers')
    .select('id, auth_user_id, email, name, club, avatar_url')
    .eq('email', email)
    .maybeSingle();

  if (byEmail) {
    const row = byEmail as Organizer;
    /* Already claimed by a different auth user — do not steal it. The
     * caller sees "not an organizer" rather than someone else's account. */
    if (row.auth_user_id && row.auth_user_id !== user.id) return null;
    if (row.auth_user_id === user.id) return row;

    const { data: adopted, error: adoptError } = await supabaseAdmin
      .from('organizers')
      .update({ auth_user_id: user.id, ...(opts.club?.trim() ? { club: opts.club.trim() } : {}) })
      .eq('id', row.id)
      .select('id, auth_user_id, email, name, club, avatar_url')
      .single();
    if (adoptError) throw new Error(`Failed to link organizer: ${adoptError.message}`);
    return adopted as Organizer;
  }

  const { data, error } = await supabaseAdmin
    .from('organizers')
    .insert({ auth_user_id: user.id, email, name, club })
    .select('id, auth_user_id, email, name, club, avatar_url')
    .single();

  if (error) {
    // Lost an insert race; the winner's row is the answer.
    if (error.code === '23505') return getOrganizerForUser(user.id);
    throw new Error(`Failed to create organizer: ${error.message}`);
  }
  return data as Organizer;
}

/* Sign-up intent path: called from /auth/callback once, at the first
 * authenticated moment. `user_metadata.role` is a claim the browser can
 * write, which is fine here — acting on it only ever gives the caller their
 * own organizer account, exactly what the button they pressed promised. It
 * grants no reach into anyone else's rows.
 *
 * Deliberately NOT called when merely reading a session: provisioning is a
 * write, and a GET that reports who you are should not also change it. */
export async function ensureOrganizerForUser(user: User): Promise<Organizer | null> {
  if (user.user_metadata?.role !== 'organizer') return null;
  return provisionOrganizer(user);
}

/* Explicit path: an existing account adding the organizer capability to
 * itself, from the login form or the signup modal. This is what makes roles
 * additive rather than a choice made once at sign-up. */
export async function addOrganizerToUser(
  user: User,
  details: { name?: string; club?: string }
): Promise<Organizer | null> {
  return provisionOrganizer(user, details);
}

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
    this.name = 'AuthError';
  }
}

/* Route-handler guard: returns the organizer or throws an AuthError that
 * `authErrorResponse` turns into the right status. Use in every route that
 * reads or writes organizer-owned data. */
export async function requireOrganizer(): Promise<Organizer> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Not signed in', 401);

  /* Read-only on purpose. A guard that quietly created the thing it was
   * checking for could never actually fail. */
  const organizer = await getOrganizerForUser(user.id);
  if (!organizer) throw new AuthError('This account is not an organizer', 403);
  return organizer;
}

/* The ownership check that matters for anything addressed by tournament
 * slug: being *an* organizer is not permission to touch *this* tournament. */
export async function requireTournamentOwner(
  slug: string
): Promise<{ organizer: Organizer; tournamentId: string }> {
  const organizer = await requireOrganizer();

  const { data, error } = await supabaseAdmin
    .from('tournaments')
    .select('id, organizer_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load tournament: ${error.message}`);
  if (!data) throw new AuthError('Tournament not found', 403);
  if (data.organizer_id !== organizer.id) {
    throw new AuthError('You do not own this tournament', 403);
  }
  return { organizer, tournamentId: data.id as string };
}

/* ── Claiming anonymous registrations ─────────────────────────────
 *
 * Registration does not require an account, so a team's row may carry no
 * `registered_by` at all. This links those rows to an account afterwards,
 * matching the account's own address against the contact email the team
 * gave on the registration form.
 *
 * Three rules keep that from attaching a team to the wrong person:
 *
 *  1. It runs only in an authenticated context, and only ever matches the
 *     caller's own address. There is no lookup in the other direction —
 *     nothing resolves an arbitrary email to an account — so an anonymous
 *     form submission can never bind itself to someone else's login.
 *  2. The address must be confirmed. An unverified sign-up could otherwise
 *     type a stranger's email and inherit their registrations.
 *  3. Only unowned rows move. A team already claimed is never reassigned,
 *     so the first (verified) claimant keeps it and a later one silently
 *     gets nothing rather than stealing it.
 *
 * What it does not defend against is a shared address — a captain who
 * enters their own email for a whole team, or a couple using one inbox,
 * ends up owning every team registered with it. That is the accepted
 * trade of matching on email: for the common case it is exactly right,
 * and the fix for the rest is for the team to register signed in.
 *
 * Best-effort by design: a failure here is a profile listing that is
 * missing a row, never a blocked sign-in. Callers do not await a result. */
export async function claimTeamsForUser(user: User): Promise<number> {
  const email = user.email?.trim().toLowerCase();
  if (!email) return 0;

  /* Rule 2. `email_confirmed_at` covers the password flow; an OAuth account
   * arrives with the provider's verification already recorded. */
  if (!user.email_confirmed_at && !user.confirmed_at) return 0;

  const { data: playerRows, error: playerError } = await supabaseAdmin
    .from('players')
    .select('team_id, email')
    .ilike('email', email);
  if (playerError) throw new Error(`Failed to match registrations: ${playerError.message}`);

  /* ilike has no wildcards here so it is a plain case-insensitive equality,
   * but the address is re-checked rather than trusted: a stray % or _ in an
   * email would otherwise turn the filter into a pattern. */
  const teamIds = [
    ...new Set(
      (playerRows ?? [])
        .filter((r) => (r.email as string | null)?.trim().toLowerCase() === email)
        .map((r) => r.team_id as string)
    ),
  ];
  if (teamIds.length === 0) return 0;

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('teams')
    .update({ registered_by: user.id })
    .in('id', teamIds)
    .is('registered_by', null) // Rule 3.
    .select('id');
  if (claimError) throw new Error(`Failed to claim registrations: ${claimError.message}`);

  return claimed?.length ?? 0;
}
