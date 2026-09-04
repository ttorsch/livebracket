import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';
import { joinTeamName, formatPlayerNames } from '../../../../../../../lib/teamName';
import { requireTournamentOwner } from '../../../../../../../lib/auth';
import { authErrorResponse } from '../../../../../../../lib/authResponse';

interface ImportPlayer {
  name: string;
  phone?: string;
  email?: string;
  shirtSize?: string;
  /* The division's non-core questions (nationality, club/hometown, and
   * anything the organizer wrote), keyed by reg_field id — the same bag
   * public registration writes, so the two paths read back identically
   * on the organizer's side. */
  custom?: Record<string, string>;
}

interface ImportTeam {
  players: ImportPlayer[];
}

/* Which caller this is, because they do not deserve the same benefit of
 * the doubt.
 *
 * 'manual' is the organizer typing a team into the Add Team modal: they
 * are looking at the form, so a half-filled roster is a decision. Only a
 * name is asked for, and only one, since the team is named by joining
 * its players and a team with no names would render blank everywhere.
 *
 * 'import' is a CSV, where a blank row is much more likely a malformed
 * file than an intent — and quietly turning it into a placeholder team
 * that eats a division slot is hard to notice and tedious to undo. It
 * keeps the stricter rule, and is the default so that any future caller
 * has to opt into leniency deliberately. */
type AddTeamMode = 'manual' | 'import';

/* A row the organizer tabbed past and left completely alone. Dropped
 * rather than stored, so an empty slot does not become a nameless player
 * on the roster. */
function isBlankPlayer(p: ImportPlayer): boolean {
  return (
    !p.name?.trim() &&
    !p.phone?.trim() &&
    !p.email?.trim() &&
    !p.shirtSize?.trim() &&
    !Object.values(p.custom ?? {}).some((v) => typeof v === 'string' && v.trim())
  );
}

async function findDivision(slug: string, divisionId: string) {
  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select('id, division_team_cap, tournaments!inner(slug)')
    .eq('id', divisionId)
    .eq('tournaments.slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Bulk-creates teams (+ their players) for a division — used by both the
// manual "Add Team" form (one team) and the CSV importer (many). Teams are
// assigned confirmed/waitlist status the same way public registration would:
// first-come into the cap, everything after it waitlisted.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
  const body = (await request.json()) as { teams?: ImportTeam[]; mode?: AddTeamMode };
  const mode: AddTeamMode = body.mode === 'manual' ? 'manual' : 'import';

  const rawTeams = Array.isArray(body.teams) ? body.teams : [];
  if (rawTeams.length === 0) {
    return NextResponse.json({ error: 'No teams provided' }, { status: 400 });
  }

  const teamsIn: ImportTeam[] = [];
  for (const t of rawTeams) {
    if (!Array.isArray(t.players) || t.players.length === 0) {
      return NextResponse.json({ error: 'Every team needs at least one player with a name' }, { status: 400 });
    }

    if (mode === 'import') {
      if (t.players.some((p) => !p.name?.trim())) {
        return NextResponse.json({ error: 'Every team needs at least one player with a name' }, { status: 400 });
      }
      teamsIn.push(t);
      continue;
    }

    /* Manual: everything is optional except having someone to name the
     * team after. Untouched rows go, half-filled ones stay. */
    const players = t.players.filter((p) => !isBlankPlayer(p));
    if (!players.some((p) => p.name?.trim())) {
      return NextResponse.json(
        { error: 'Add at least one player name — the team is named after its players.' },
        { status: 400 }
      );
    }
    teamsIn.push({ players });
  }

  let division;
  try {
    division = await findDivision(slug, divisionId);
    if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }

  const { count, error: countError } = await supabaseAdmin
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', divisionId)
    .neq('status', 'waitlist');
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  let confirmedCount = count ?? 0;
  const cap = division.division_team_cap as number;
  const createdIds: string[] = [];

  for (const t of teamsIn) {
    const willWaitlist = confirmedCount >= cap;

    /* Into the cap, a manually added team lands 'unpaid' — the same place
     * a team that registers itself lands. Typing a team in records that
     * they entered, not that they settled up, and the organizer clears
     * payment from the roster once they have. A CSV import still arrives
     * 'confirmed': that path is used to carry over a roster that was
     * already sorted out elsewhere.
     *
     * Waitlisted is unchanged either way — past the cap there is no slot
     * yet to have paid for. */
    const status = willWaitlist ? 'waitlist' : mode === 'manual' ? 'unpaid' : 'confirmed';
    const paymentCleared = !willWaitlist && mode !== 'manual';

    // 'unpaid' still holds a slot, so it counts against the cap.
    if (!willWaitlist) confirmedCount++;

    const teamName = joinTeamName(t.players.map((p) => p.name));
    const { data: teamRow, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({ division_id: divisionId, name: teamName, status, payment_cleared: paymentCleared })
      .select('id')
      .single();
    if (teamError) return NextResponse.json({ error: teamError.message }, { status: 500 });

    const playerRows = t.players.map((p) => ({
      team_id: teamRow.id,
      name: (p.name ?? '').trim(),
      phone: p.phone?.trim() || null,
      email: p.email?.trim() || null,
      shirt_size: p.shirtSize?.trim() || null,
      custom_fields: Object.fromEntries(
        Object.entries(p.custom ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())
      ),
    }));
    const { error: playersError } = await supabaseAdmin.from('players').insert(playerRows);
    if (playersError) return NextResponse.json({ error: playersError.message }, { status: 500 });

    createdIds.push(teamRow.id);
  }

  const { data: created, error: fetchError } = await supabaseAdmin
    .from('teams')
    .select('id, name, seed, payment_cleared, status, players(id, name, phone, email, shirt_size)')
    .in('id', createdIds);
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const teams = (created ?? []).map((t: any) => ({
    id: t.id,
    name: formatPlayerNames(t.players, t.name, t.seed),
    seed: t.seed,
    paymentCleared: t.payment_cleared,
    status: t.status,
    players: (t.players ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      shirtSize: p.shirt_size,
    })),
  }));

  return NextResponse.json({ created: teams }, { status: 201 });
}
