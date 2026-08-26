import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { joinTeamName } from '../../../../../lib/teamName';
import { normalizeRegFields, rosterSize, targetFor, FORMAT_PLAYERS } from '../../../../../lib/registrationFields';
import { divisionRegistrationState, PHASE } from '../../../../../lib/tournamentLifecycle';

/* ── Public registration ──────────────────────────────────────────
 *
 * Deliberately not the organizer's POST .../divisions/[id]/teams route,
 * which means something different: an organizer adding a team already
 * knows it is coming and has been paid, so that route writes
 * confirmed/payment_cleared. A team registering itself has done neither
 * — it holds a slot as `unpaid` until the organizer clears payment, and
 * is `waitlist` once the cap is gone.
 *
 * Every rule the form enforces is enforced again here. The form is a
 * client component and can be bypassed; the cap, the registration
 * window and the division's own required fields cannot be.
 */

interface PlayerBody {
  name?: string;
  phone?: string;
  email?: string;
  shirtSize?: string;
  custom?: Record<string, string>;
}

interface RegisterBody {
  divisionId?: string;
  players?: PlayerBody[];
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as RegisterBody;

  if (!body.divisionId) return bad('Pick a division to register for');
  const playersIn = Array.isArray(body.players) ? body.players : [];
  if (playersIn.length === 0) return bad('A team needs at least one player');

  const { data: division, error: dError } = await supabaseAdmin
    .from('divisions')
    .select('id, name, division_team_cap, registration_fee, format_type_on_sand, reg_fields, settings, tournaments!inner(slug, phase, cancelled_at, deleted_at)')
    .eq('id', body.divisionId)
    .eq('tournaments.slug', slug)
    .maybeSingle();
  if (dError) return bad(dError.message, 500);
  if (!division) return bad('Division not found', 404);

  const tournament = division.tournaments as unknown as {
    phase: number; cancelled_at: string | null; deleted_at: string | null;
  };
  if (tournament.deleted_at) return bad('Division not found', 404);
  if (tournament.phase < PHASE.announced) return bad('This tournament is not open to the public yet', 403);
  if (tournament.cancelled_at) return bad('This tournament has been cancelled', 409);

  const settings = (division.settings ?? {}) as Record<string, unknown>;
  const state = divisionRegistrationState({
    registrationOpens: typeof settings.registrationOpenDate === 'string' ? settings.registrationOpenDate : '',
    registrationCloses: typeof settings.registrationCloseDate === 'string' ? settings.registrationCloseDate : '',
  });
  if (state === 'closed') return bad(`Registration for ${division.name} has closed`, 409);
  if (state === 'opens-soon') return bad(`Registration for ${division.name} has not opened yet`, 409);

  // ── The roster the division actually asked for ────────────────
  const format = division.format_type_on_sand as string;
  const minPlayers = FORMAT_PLAYERS[format] ?? 2;
  const maxPlayers = rosterSize(format, settings.maxRosterSize);
  if (playersIn.length < minPlayers || playersIn.length > maxPlayers) {
    return bad(`A ${format} team needs between ${minPlayers} and ${maxPlayers} players`);
  }

  const fields = normalizeRegFields(division.reg_fields);
  for (let i = 0; i < playersIn.length; i++) {
    const p = playersIn[i];
    for (const field of fields) {
      if (!field.required) continue;
      const target = targetFor(field);
      const value =
        target === 'name' ? p.name
        : target === 'phone' ? p.phone
        : target === 'email' ? p.email
        : target === 'shirtSize' ? p.shirtSize
        : p.custom?.[field.id];
      if (!value?.trim()) return bad(`Player ${i + 1}: ${field.label} is required`);
    }
    if (!p.name?.trim()) return bad(`Player ${i + 1} needs a name`);
  }

  // ── Cap, then waitlist ────────────────────────────────────────
  // Read-then-write, like the organizer's import route: two teams landing
  // in the same instant can both read the last free slot. The organizer
  // sees the overflow on the setup page and can waitlist one by hand,
  // which is a better trade than serializing every registration.
  const cap = division.division_team_cap as number;
  const { count: takenCount, error: cError } = await supabaseAdmin
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', division.id)
    .neq('status', 'waitlist');
  if (cError) return bad(cError.message, 500);

  const taken = takenCount ?? 0;
  let status: 'unpaid' | 'waitlist' = 'unpaid';

  if (taken >= cap) {
    const waitlistCap = typeof settings.waitlistCap === 'number' ? Math.max(0, Math.trunc(settings.waitlistCap)) : 0;
    const { count: waitingCount, error: wError } = await supabaseAdmin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', division.id)
      .eq('status', 'waitlist');
    if (wError) return bad(wError.message, 500);
    if ((waitingCount ?? 0) >= waitlistCap) {
      return bad(`${division.name} is full and its waitlist is closed`, 409);
    }
    status = 'waitlist';
  }

  const names = playersIn.map(p => (p.name ?? '').trim());
  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .insert({ division_id: division.id, name: joinTeamName(names), status, payment_cleared: false })
    .select('id')
    .single();
  if (teamError) return bad(teamError.message, 500);

  const playerRows = playersIn.map(p => ({
    team_id: team.id,
    name: (p.name ?? '').trim(),
    phone: p.phone?.trim() || null,
    email: p.email?.trim() || null,
    shirt_size: p.shirtSize?.trim() || null,
    custom_fields: Object.fromEntries(
      Object.entries(p.custom ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()),
    ),
  }));
  const { error: playersError } = await supabaseAdmin.from('players').insert(playerRows);
  if (playersError) {
    // A team with no players is invisible on every surface but still eats a
    // slot, so don't leave one behind.
    await supabaseAdmin.from('teams').delete().eq('id', team.id);
    return bad(playersError.message, 500);
  }

  const fee = Number(division.registration_fee ?? 0) || 0;
  // The money side of the same event. Nothing has been paid yet — this row is
  // what the organizer clears against when it is.
  const { error: regError } = await supabaseAdmin
    .from('registrations')
    .insert({ division_id: division.id, team_id: team.id, payment_status: 'pending', amount_paid: 0 });
  if (regError) return bad(regError.message, 500);

  return NextResponse.json({
    teamId: team.id,
    teamName: joinTeamName(names),
    status,
    fee,
    divisionName: division.name,
  }, { status: 201 });
}
