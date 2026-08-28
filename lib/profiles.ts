import 'server-only';
import { type User } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseAdmin';

/* Player-facing identity, and the lookup the invite search runs on.
 *
 * Separate from lib/auth.ts on purpose: that module answers "who is
 * signed in and what may they do", this one answers "who is this player,
 * and can a teammate find them". The organizer capability has nothing to
 * do with either. */

export interface Profile {
  id: string;
  player_id: string;
  name: string | null;
  avatar_url: string | null;
  club: string | null;
  hometown: string | null;
}

/* What a search may show about someone else. Deliberately narrow: the
 * 8-digit id is the only thing that opens this door, so what comes back
 * through it is the minimum needed to confirm you found the right
 * person. No email, no club, no hometown. */
export interface PublicProfile {
  userId: string;
  playerId: string;
  name: string | null;
  avatarUrl: string | null;
}

const PROFILE_COLUMNS = 'id, player_id, name, avatar_url, club, hometown';

/* Random rather than sequential. A sequential id would let anyone
 * holding one count the platform's accounts and walk to the rest. */
function randomPlayerId(): string {
  return String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
}

export function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{8}$/.test(value.trim());
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/* The one place a profile row is created. Idempotent and safe to race:
 * two concurrent sign-ins converge on the same row.
 *
 * Called at the first authenticated moment (/auth/callback), the same
 * place the organizer row is provisioned — so an account is searchable
 * from the moment it exists rather than from the first time it happens
 * to open its profile page. */
export async function ensureProfileForUser(user: User): Promise<Profile> {
  const existing = await getProfile(user.id);
  if (existing) return existing;

  const meta = user.user_metadata ?? {};
  const seed = {
    name:
      (meta.full_name as string | undefined)?.trim() ||
      (meta.name as string | undefined)?.trim() ||
      user.email?.split('@')[0] ||
      null,
    avatar_url:
      (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null,
    club: (meta.club as string | undefined) ?? null,
    hometown:
      (meta.hometown as string | undefined) ?? (meta.location as string | undefined) ?? null,
  };

  /* Retry on the unique constraint rather than checking first: the check
   * would be a race, the constraint is not. */
  for (let attempt = 0; attempt < 20; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .insert({ id: user.id, player_id: randomPlayerId(), ...seed })
      .select(PROFILE_COLUMNS)
      .single();

    if (!error) return data as Profile;

    if (error.code === '23505') {
      /* Either this id was taken, or another request created the row for
       * this user first. If it is the latter, that row is the answer. */
      const raced = await getProfile(user.id);
      if (raced) return raced;
      continue;
    }
    throw new Error(`Failed to create profile: ${error.message}`);
  }

  throw new Error('Could not allocate a unique player ID');
}

/* The invite search. Exact match only — no prefix, no name, nothing that
 * would let a caller enumerate accounts by trying. You have to have been
 * given the number. */
export async function findByPlayerId(playerId: string): Promise<PublicProfile | null> {
  if (!isPlayerId(playerId)) return null;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, player_id, name, avatar_url')
    .eq('player_id', playerId.trim())
    .maybeSingle();

  if (error) throw new Error(`Failed to look up player: ${error.message}`);
  if (!data) return null;

  return {
    userId: data.id as string,
    playerId: data.player_id as string,
    name: (data.name as string | null) ?? null,
    avatarUrl: (data.avatar_url as string | null) ?? null,
  };
}

/* Resolves a set of user ids to the same narrow public shape, for the
 * roster views that draw invited players. One query, not one per row. */
export async function publicProfilesByIds(
  userIds: string[]
): Promise<Map<string, PublicProfile>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, player_id, name, avatar_url')
    .in('id', unique);

  if (error) throw new Error(`Failed to load profiles: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      {
        userId: row.id as string,
        playerId: row.player_id as string,
        name: (row.name as string | null) ?? null,
        avatarUrl: (row.avatar_url as string | null) ?? null,
      },
    ])
  );
}
