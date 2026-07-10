import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';

interface DivisionBody {
  name: string;
  divisionTeamCap: number;
  formatTypeOnSand: string;
  maxRosterSize: number;
  registrationFee: number;
  registrationOpenDate: string;
  // Each round carries its own scoring rules (e.g. pool play to 21, the
  // elimination round after it best of 3) instead of one blob per division.
  rounds: { format: string; scoring: Record<string, unknown> }[];
  rules: string;
  regFields: unknown[];
  allowMulti: boolean;
  genderEligibility: string;
  prizePool: string;
  netHeight: string;
  minTeams: number;
  waitlistCap: number;
  confirmationMessage: string;
  confirmationImage: string;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
const roundLabel = (i: number) => (ORDINALS[i] ? `${ORDINALS[i]} Round` : `Round ${i + 1}`);

function toSettings(body: DivisionBody) {
  return {
    maxRosterSize: body.maxRosterSize,
    registrationOpenDate: body.registrationOpenDate,
    rules: body.rules,
    allowMulti: body.allowMulti,
    genderEligibility: body.genderEligibility,
    prizePool: body.prizePool,
    netHeight: body.netHeight,
    minTeams: body.minTeams,
    waitlistCap: body.waitlistCap,
    confirmationMessage: body.confirmationMessage,
    confirmationImage: body.confirmationImage,
  };
}

async function assertOwnership(slug: string, divisionId: string) {
  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select('id, tournaments!inner(slug)')
    .eq('id', divisionId)
    .eq('tournaments.slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  const body = (await request.json()) as DivisionBody;

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Division name is required' }, { status: 400 });
  }

  try {
    if (!(await assertOwnership(slug, divisionId))) {
      return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }

  const { data: division, error: dError } = await supabaseAdmin
    .from('divisions')
    .update({
      name: body.name,
      format_type_on_sand: body.formatTypeOnSand,
      registration_fee: body.registrationFee,
      division_team_cap: body.divisionTeamCap,
      reg_fields: body.regFields,
      settings: toSettings(body),
    })
    .eq('id', divisionId)
    .select('id, name, format_type_on_sand, registration_fee, division_team_cap, reg_fields, settings')
    .single();
  if (dError) return NextResponse.json({ error: dError.message }, { status: 500 });

  // Rounds have no independent identity worth preserving here — replace wholesale.
  const { error: delError } = await supabaseAdmin.from('rounds').delete().eq('division_id', divisionId);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  const roundRows = (body.rounds ?? []).map((r, i) => ({
    division_id: divisionId,
    sequence: i + 1,
    format: r.format,
    name: roundLabel(i),
    scoring_rules: r.scoring,
  }));
  const { data: rounds, error: rError } = roundRows.length
    ? await supabaseAdmin.from('rounds').insert(roundRows).select('id, sequence, format, name, scoring_rules')
    : { data: [], error: null };
  if (rError) return NextResponse.json({ error: rError.message }, { status: 500 });

  return NextResponse.json({ ...division, rounds });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;

  try {
    if (!(await assertOwnership(slug, divisionId))) {
      return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('divisions').delete().eq('id', divisionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
