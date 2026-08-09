import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../../lib/supabaseAdmin';

interface ImportPlayer {
  name: string;
  phone?: string;
  email?: string;
}

interface ImportTeam {
  players: ImportPlayer[];
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
  const body = (await request.json()) as { teams?: ImportTeam[] };

  const teamsIn = Array.isArray(body.teams) ? body.teams : [];
  if (teamsIn.length === 0) {
    return NextResponse.json({ error: 'No teams provided' }, { status: 400 });
  }
  for (const t of teamsIn) {
    if (!Array.isArray(t.players) || t.players.length === 0 || t.players.some((p) => !p.name?.trim())) {
      return NextResponse.json({ error: 'Every team needs at least one player with a name' }, { status: 400 });
    }
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
    const status = willWaitlist ? 'waitlist' : 'confirmed';
    const paymentCleared = !willWaitlist;
    if (!willWaitlist) confirmedCount++;

    const teamName = t.players.map((p) => p.name.trim()).join(' / ');
    const { data: teamRow, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({ division_id: divisionId, name: teamName, status, payment_cleared: paymentCleared })
      .select('id')
      .single();
    if (teamError) return NextResponse.json({ error: teamError.message }, { status: 500 });

    const playerRows = t.players.map((p) => ({
      team_id: teamRow.id,
      name: p.name.trim(),
      phone: p.phone?.trim() || null,
      email: p.email?.trim() || null,
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
    name: t.name,
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
