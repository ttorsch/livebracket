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

export type Role = 'player' | 'organizer';

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

export async function getCurrentRole(): Promise<Role | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return (await getOrganizerForUser(user.id)) ? 'organizer' : 'player';
}

/* Provision the organizer row for a user who signed up (or signed in with
 * Google/Facebook) choosing the organizer role.
 *
 * The role choice arrives as `user_metadata.role`, which the user controls.
 * That is deliberate and safe: acting on it only ever creates the caller
 * their *own* organizer account, which is precisely what the "Sign up as
 * organizer" button promises. It grants no reach into anyone else's rows —
 * every organizer-scoped query filters by the id returned here. What the
 * user cannot do is write the row directly; only this service-role path can.
 *
 * Idempotent: safe to call on every sign-in. */
export async function ensureOrganizerForUser(user: User): Promise<Organizer | null> {
  const intendedRole = user.user_metadata?.role;
  if (intendedRole !== 'organizer') return null;

  const existing = await getOrganizerForUser(user.id);
  if (existing) return existing;

  const email = user.email;
  if (!email) return null;

  const name =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim() ||
    email.split('@')[0];

  /* An organizers row may already exist for this email from before the user
   * had an auth account (seeded data, or an earlier signup that never
   * confirmed). Adopt it rather than colliding with the unique email index. */
  const { data: byEmail } = await supabaseAdmin
    .from('organizers')
    .select('id, auth_user_id, email, name, club')
    .eq('email', email)
    .maybeSingle();

  if (byEmail) {
    if ((byEmail as Organizer).auth_user_id) return byEmail as Organizer;
    const { data: adopted, error: adoptError } = await supabaseAdmin
      .from('organizers')
      .update({ auth_user_id: user.id })
      .eq('id', (byEmail as Organizer).id)
      .select('id, auth_user_id, email, name, club')
      .single();
    if (adoptError) throw new Error(`Failed to link organizer: ${adoptError.message}`);
    return adopted as Organizer;
  }

  const { data, error } = await supabaseAdmin
    .from('organizers')
    .insert({ auth_user_id: user.id, email, name })
    .select('id, auth_user_id, email, name, club')
    .single();

  if (error) {
    /* Two concurrent sign-ins can race to insert. The loser re-reads. */
    if (error.code === '23505') return getOrganizerForUser(user.id);
    throw new Error(`Failed to create organizer: ${error.message}`);
  }
  return data as Organizer;
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

  const organizer = (await getOrganizerForUser(user.id)) ?? (await ensureOrganizerForUser(user));
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
