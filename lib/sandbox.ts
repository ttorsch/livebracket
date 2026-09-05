if (typeof window !== 'undefined') {
  throw new Error('lib/sandbox.ts must never be imported from client code.');
}
import crypto from 'crypto';
import { supabaseAdmin } from './supabaseAdmin.ts';

export const TEMPLATE_SLUG = 'andaman-beach-masters-template';
export const SANDBOX_DURATION_HOURS = 24;

export interface SandboxRecord {
  id: string;
  auth_user_id: string;
  expires_at: string;
  created_at: string;
}

export interface ClonedTournamentResult {
  tournamentId: string;
  slug: string;
  title: string;
}

/**
 * Generate a short random alphanumeric string for slugs and IDs.
 */
function shortId(length = 6): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Shift an ISO date/time string so its calendar date matches targetDate (YYYY-MM-DD)
 * while preserving the time-of-day, minutes, and timezone offset.
 */
function shiftTimeToDate(isoString: string | null, targetDateYMD: string): string | null {
  if (!isoString) return null;
  try {
    const timePart = isoString.slice(10); // e.g. "T09:00:00+07:00" or "T09:00:00.000Z"
    return `${targetDateYMD}${timePart}`;
  } catch {
    return isoString;
  }
}

/**
 * Find the Golden Template tournament row.
 */
export async function getGoldenTemplateTournament() {
  // First try querying with is_template: true
  const { data: byFlag, error: flagErr } = await supabaseAdmin
    .from('tournaments')
    .select('*')
    .eq('is_template', true)
    .maybeSingle();

  if (byFlag && !flagErr) return byFlag;

  // Fallback: query by well-known template slug
  const { data: bySlug, error: slugErr } = await supabaseAdmin
    .from('tournaments')
    .select('*')
    .eq('slug', TEMPLATE_SLUG)
    .maybeSingle();

  if (slugErr) {
    throw new Error(`Failed to query golden template tournament: ${slugErr.message}`);
  }

  return bySlug;
}

/**
 * Deep-copy the Golden Template tournament for a specific sandbox and organizer.
 * Performs a depth-first walk with UUID remap and fresh scorekeeper tokens.
 */
export async function cloneTournamentForSandbox(
  templateTournament: Record<string, any>,
  sandboxId: string,
  organizerId: string
): Promise<ClonedTournamentResult> {
  const idMap = new Map<string, string>();
  const remap = (oldId: string | null | undefined): string | null =>
    oldId ? idMap.get(oldId) ?? null : null;

  const now = new Date();
  const day1 = now.toISOString().slice(0, 10);
  const day2 = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const templateDay1 = templateTournament.start_date || day1;

  // 1. Tournaments
  const newTournamentId = crypto.randomUUID();
  idMap.set(templateTournament.id, newTournamentId);
  const newSlug = `andaman-masters-${shortId(5)}`;

  const tournamentRow: Record<string, any> = {
    ...templateTournament,
    id: newTournamentId,
    organizer_id: organizerId,
    slug: newSlug,
    start_date: day1,
    end_date: templateTournament.is_one_day ? day1 : day2,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  // Attach sandbox_id and clear template marker if columns exist
  tournamentRow.sandbox_id = sandboxId;
  if ('is_template' in tournamentRow) tournamentRow.is_template = false;

  const { error: tourneyErr } = await supabaseAdmin
    .from('tournaments')
    .insert([tournamentRow]);

  if (tourneyErr) {
    // If sandbox_id column is missing from DB, retry without sandbox_id
    if (tourneyErr.message.includes('sandbox_id') || tourneyErr.message.includes('is_template')) {
      delete tournamentRow.sandbox_id;
      delete tournamentRow.is_template;
      const { error: retryErr } = await supabaseAdmin
        .from('tournaments')
        .insert([tournamentRow]);
      if (retryErr) throw new Error(`Failed to clone tournament: ${retryErr.message}`);
    } else {
      throw new Error(`Failed to clone tournament: ${tourneyErr.message}`);
    }
  }

  // 2. Divisions
  const { data: divisions, error: divFetchErr } = await supabaseAdmin
    .from('divisions')
    .select('*')
    .eq('tournament_id', templateTournament.id);

  if (divFetchErr) throw new Error(`Failed to fetch template divisions: ${divFetchErr.message}`);

  const templateDivIds = (divisions ?? []).map((d) => d.id as string);
  const newDivisions = (divisions ?? []).map((d) => {
    const newDivId = crypto.randomUUID();
    idMap.set(d.id, newDivId);
    return {
      ...d,
      id: newDivId,
      tournament_id: newTournamentId,
      created_at: now.toISOString(),
    };
  });

  if (newDivisions.length > 0) {
    const { error: divInsertErr } = await supabaseAdmin.from('divisions').insert(newDivisions);
    if (divInsertErr) throw new Error(`Failed to clone divisions: ${divInsertErr.message}`);
  }

  if (templateDivIds.length === 0) {
    return { tournamentId: newTournamentId, slug: newSlug, title: tournamentRow.title };
  }

  // 3. Rounds
  const { data: rounds, error: roundFetchErr } = await supabaseAdmin
    .from('rounds')
    .select('*')
    .in('division_id', templateDivIds);

  if (roundFetchErr) throw new Error(`Failed to fetch template rounds: ${roundFetchErr.message}`);

  const newRounds = (rounds ?? []).map((r) => {
    const newRoundId = crypto.randomUUID();
    idMap.set(r.id, newRoundId);
    return {
      ...r,
      id: newRoundId,
      division_id: remap(r.division_id)!,
    };
  });

  if (newRounds.length > 0) {
    const { error: roundInsertErr } = await supabaseAdmin.from('rounds').insert(newRounds);
    if (roundInsertErr) throw new Error(`Failed to clone rounds: ${roundInsertErr.message}`);
  }

  // 4. Teams (Null out registered_by so demo doesn't link to real accounts)
  const { data: teams, error: teamFetchErr } = await supabaseAdmin
    .from('teams')
    .select('*')
    .in('division_id', templateDivIds);

  if (teamFetchErr) throw new Error(`Failed to fetch template teams: ${teamFetchErr.message}`);

  const templateTeamIds = (teams ?? []).map((t) => t.id as string);
  const newTeams = (teams ?? []).map((t) => {
    const newTeamId = crypto.randomUUID();
    idMap.set(t.id, newTeamId);
    return {
      ...t,
      id: newTeamId,
      division_id: remap(t.division_id)!,
      registered_by: null, // nulled per launch-kit spec
      created_at: now.toISOString(),
    };
  });

  if (newTeams.length > 0) {
    const { error: teamInsertErr } = await supabaseAdmin.from('teams').insert(newTeams);
    if (teamInsertErr) throw new Error(`Failed to clone teams: ${teamInsertErr.message}`);
  }

  // 5. Players (Null out user_id and reset invite_status)
  if (templateTeamIds.length > 0) {
    const { data: players, error: playerFetchErr } = await supabaseAdmin
      .from('players')
      .select('*')
      .in('team_id', templateTeamIds);

    if (playerFetchErr) throw new Error(`Failed to fetch template players: ${playerFetchErr.message}`);

    const newPlayers = (players ?? []).map((p) => {
      const newPlayerId = crypto.randomUUID();
      idMap.set(p.id, newPlayerId);
      return {
        ...p,
        id: newPlayerId,
        team_id: remap(p.team_id)!,
        user_id: null, // nulled per launch-kit spec
        invite_status: 'none',
        invited_at: null,
        responded_at: null,
      };
    });

    if (newPlayers.length > 0) {
      const { error: playerInsertErr } = await supabaseAdmin.from('players').insert(newPlayers);
      if (playerInsertErr) throw new Error(`Failed to clone players: ${playerInsertErr.message}`);
    }
  }

  // 6. Registrations
  const { data: registrations, error: regFetchErr } = await supabaseAdmin
    .from('registrations')
    .select('*')
    .in('division_id', templateDivIds);

  if (regFetchErr) throw new Error(`Failed to fetch template registrations: ${regFetchErr.message}`);

  const newRegistrations = (registrations ?? []).map((reg) => {
    const newRegId = crypto.randomUUID();
    return {
      ...reg,
      id: newRegId,
      division_id: remap(reg.division_id)!,
      team_id: remap(reg.team_id)!,
      submitted_at: now.toISOString(),
    };
  });

  if (newRegistrations.length > 0) {
    const { error: regInsertErr } = await supabaseAdmin.from('registrations').insert(newRegistrations);
    if (regInsertErr) throw new Error(`Failed to clone registrations: ${regInsertErr.message}`);
  }

  // 7. Matches (Fresh scorekeeper tokens, remap 4 team foreign keys, shift times to today/tomorrow)
  const { data: matches, error: matchFetchErr } = await supabaseAdmin
    .from('matches')
    .select('*')
    .in('division_id', templateDivIds);

  if (matchFetchErr) throw new Error(`Failed to fetch template matches: ${matchFetchErr.message}`);

  const newMatches = (matches ?? []).map((m) => {
    const newMatchId = crypto.randomUUID();

    // Work out target date (Day 1 or Day 2) based on whether scheduled time was on templateDay1
    const matchTime = m.scheduled_time || m.planned_time;
    const isDay2 = matchTime && !matchTime.startsWith(templateDay1);
    const targetDate = isDay2 ? day2 : day1;

    return {
      ...m,
      id: newMatchId,
      round_id: remap(m.round_id)!,
      division_id: remap(m.division_id)!,
      team_a_id: remap(m.team_a_id),
      team_b_id: remap(m.team_b_id),
      winner_team_id: remap(m.winner_team_id),
      referee_team_id: remap(m.referee_team_id),
      scorekeeper_token: crypto.randomBytes(16).toString('hex'), // fresh unguessable token
      scheduled_time: shiftTimeToDate(m.scheduled_time, targetDate),
      planned_time: shiftTimeToDate(m.planned_time, targetDate),
      updated_at: now.toISOString(),
    };
  });

  if (newMatches.length > 0) {
    const { error: matchInsertErr } = await supabaseAdmin.from('matches').insert(newMatches);
    if (matchInsertErr) throw new Error(`Failed to clone matches: ${matchInsertErr.message}`);
  }

  // 8. Vouchers
  const { data: vouchers, error: voucherFetchErr } = await supabaseAdmin
    .from('vouchers')
    .select('*')
    .eq('tournament_id', templateTournament.id);

  if (voucherFetchErr) throw new Error(`Failed to fetch template vouchers: ${voucherFetchErr.message}`);

  const newVouchers = (vouchers ?? []).map((v) => {
    const newVoucherId = crypto.randomUUID();
    return {
      ...v,
      id: newVoucherId,
      tournament_id: newTournamentId,
      expires_at: shiftTimeToDate(v.expires_at, day2) || v.expires_at,
    };
  });

  if (newVouchers.length > 0) {
    const { error: voucherInsertErr } = await supabaseAdmin.from('vouchers').insert(newVouchers);
    if (voucherInsertErr) throw new Error(`Failed to clone vouchers: ${voucherInsertErr.message}`);
  }

  return { tournamentId: newTournamentId, slug: newSlug, title: tournamentRow.title };
}

/**
 * Initialize a brand new sandbox session for a visitor:
 * 1. Creates throwaway auth user.
 * 2. Creates throwaway organizer.
 * 3. Records sandbox entry with 24-hour expiration.
 * 4. Deep-clones the Golden Template tournament.
 * 5. Signs in the visitor through SSR client to write auth cookies.
 */
export async function createDemoSandbox(): Promise<{
  sandboxId: string;
  userId: string;
  organizerId: string;
  clonedTournament: ClonedTournamentResult;
}> {
  const sandboxId = crypto.randomUUID();
  const visitorHex = shortId(6);
  const email = `demo-${Date.now()}-${visitorHex}@demo.livebracket.app`;
  const password = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SANDBOX_DURATION_HOURS * 60 * 60 * 1000).toISOString();

  // 1. Create throwaway auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: 'organizer',
      name: 'Demo Organizer',
      is_sandbox: true,
      sandbox_id: sandboxId,
    },
  });

  if (authError || !authData.user) {
    throw new Error(`Failed to create demo auth user: ${authError?.message ?? 'unknown'}`);
  }

  const userId = authData.user.id;

  // 2. Insert into sandboxes table (if table exists)
  try {
    await supabaseAdmin.from('sandboxes').insert({
      id: sandboxId,
      auth_user_id: userId,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.warn('Could not record into sandboxes table (schema migration may still be pending):', err);
  }

  // 3. Create throwaway organizer row
  const organizerId = crypto.randomUUID();
  const organizerRow: Record<string, any> = {
    id: organizerId,
    auth_user_id: userId,
    email,
    name: 'Demo Organizer',
    club: 'Beach Demo Club',
    hometown: 'Khao Lak, Thailand',
    sandbox_id: sandboxId,
  };

  const { error: orgErr } = await supabaseAdmin.from('organizers').insert([organizerRow]);
  if (orgErr) {
    if (orgErr.message.includes('sandbox_id')) {
      delete organizerRow.sandbox_id;
      const { error: retryOrgErr } = await supabaseAdmin.from('organizers').insert([organizerRow]);
      if (retryOrgErr) throw new Error(`Failed to create demo organizer: ${retryOrgErr.message}`);
    } else {
      throw new Error(`Failed to create demo organizer: ${orgErr.message}`);
    }
  }

  // 4. Locate golden template tournament and clone it
  const template = await getGoldenTemplateTournament();
  if (!template) {
    throw new Error('Golden template tournament not found. Run "npm run seed:golden" first.');
  }

  const clonedTournament = await cloneTournamentForSandbox(template, sandboxId, organizerId);

  // 5. Sign in through the SSR client to set session cookies on the response
  try {
    const { createSupabaseServerClient } = await import('./supabaseServer.ts');
    const supabaseServer = await createSupabaseServerClient();
    const { error: signInErr } = await supabaseServer.auth.signInWithPassword({
      email,
      password,
    });

    if (signInErr) {
      console.error('Failed to sign in demo user on server:', signInErr.message);
    }
  } catch (cookieErr: any) {
    // Expected when called outside Next.js request context (e.g. testing)
    console.log('Notice: skipping SSR cookie write (outside Next.js request context)');
  }

  return {
    sandboxId,
    userId,
    organizerId,
    clonedTournament,
  };
}

/**
 * Reset an existing sandbox session:
 * Deletes all tournament rows belonging to this organizer/sandbox,
 * then clones a fresh copy from the golden template.
 */
export async function resetDemoSandbox(userId: string): Promise<ClonedTournamentResult> {
  const { data: organizer, error: orgErr } = await supabaseAdmin
    .from('organizers')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (orgErr || !organizer) {
    throw new Error(`Organizer row not found for demo reset: ${orgErr?.message || 'unknown'}`);
  }

  const sandboxId = crypto.randomUUID();

  // Find tournaments owned by this organizer
  const { data: tournaments, error: tErr } = await supabaseAdmin
    .from('tournaments')
    .select('id')
    .eq('organizer_id', organizer.id);

  if (tErr) throw new Error(`Failed to query existing sandbox tournaments: ${tErr.message}`);

  const tourneyIds = (tournaments ?? []).map((t) => t.id as string);
  if (tourneyIds.length > 0) {
    // Cascade delete wipes divisions, rounds, teams, players, matches, vouchers
    const { error: delErr } = await supabaseAdmin
      .from('tournaments')
      .delete()
      .in('id', tourneyIds);

    if (delErr) throw new Error(`Failed to remove old sandbox tournaments: ${delErr.message}`);
  }

  // Re-clone fresh from golden template
  const template = await getGoldenTemplateTournament();
  if (!template) {
    throw new Error('Golden template tournament not found. Run "npm run seed:golden" first.');
  }

  return cloneTournamentForSandbox(template, sandboxId, organizer.id);
}

/**
 * Look up sandbox info for a user (returns remaining duration, expiry, etc.)
 */
export async function getSandboxInfoForUser(userId: string): Promise<{
  id: string;
  expiresAt: string;
} | null> {
  // First check sandboxes table if available
  try {
    const { data: sandbox, error } = await supabaseAdmin
      .from('sandboxes')
      .select('id, expires_at')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (!error && sandbox) {
      return {
        id: sandbox.id,
        expiresAt: sandbox.expires_at,
      };
    }
  } catch {
    // sandboxes table not created yet, fall back to user_metadata
  }

  // Fallback: check auth user metadata
  const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = authData?.user?.user_metadata;
  if (meta?.is_sandbox) {
    const createdAt = authData.user?.created_at ? new Date(authData.user.created_at) : new Date();
    const expiresAt = new Date(createdAt.getTime() + SANDBOX_DURATION_HOURS * 3600 * 1000).toISOString();
    return {
      id: meta.sandbox_id || userId,
      expiresAt,
    };
  }

  return null;
}

/**
 * Sweep expired sandboxes:
 * Deletes expired sandboxes and their auth accounts (cascade deletes all tournaments, organizers, etc.)
 */
export async function sweepExpiredSandboxes(): Promise<{ prunedCount: number }> {
  const now = new Date().toISOString();
  let prunedCount = 0;

  // 1. Query expired sandboxes from the table if available
  const { data: expiredSandboxes, error } = await supabaseAdmin
    .from('sandboxes')
    .select('id, auth_user_id')
    .lt('expires_at', now);

  if (!error && expiredSandboxes && expiredSandboxes.length > 0) {
    for (const sb of expiredSandboxes) {
      if (sb.auth_user_id) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(sb.auth_user_id);
        } catch (e) {
          console.warn(`Failed to delete expired auth user ${sb.auth_user_id}:`, e);
        }
      }
      await supabaseAdmin.from('sandboxes').delete().eq('id', sb.id);
      prunedCount++;
    }
  }

  return { prunedCount };
}
