import 'server-only';
import { type User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from './supabaseServer';
import { supabaseAdmin } from './supabaseAdmin';

export interface Organizer {
  id: string;
  auth_user_id: string;
  email: string;
  name: string;
  club: string | null;
}

/* Roles are additive, not exclusive. Every account is a player — that is
 * the baseline of having signed up at all. An `organizers` row adds the
 * organizer capability on top; it never replaces the player one. So the
 * answer to "what is this account" is a set, and the login tabs choose a
 * destination rather than an identity. */
export type Role = 'player' | 'organizer';

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

/* The organizer row owned by this auth user, or null if they are a player.
 *
 * This — not user_metadata — is what "is an organizer" means. Metadata is
 * writable by the browser holding the session (supabase.auth.updateUser),
 * so anything that reads a role out of it is reading a claim the user made
 * about themselves. A row in `organizers` is written only by the service
 * role, from this module. */
export async function getOrganizerForUser(userId: string): Promise<Organizer | null> {
  const { data, error } = await supabaseAdmin
    .from('organizers')
    .select('id, auth_user_id, email, name, club')
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
    .select('id, auth_user_id, email, name, club')
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
      .select('id, auth_user_id, email, name, club')
      .single();
    if (adoptError) throw new Error(`Failed to link organizer: ${adoptError.message}`);
    return adopted as Organizer;
  }

  const { data, error } = await supabaseAdmin
    .from('organizers')
    .insert({ auth_user_id: user.id, email, name, club })
    .select('id, auth_user_id, email, name, club')
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
