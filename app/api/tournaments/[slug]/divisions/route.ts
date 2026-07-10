import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
const roundLabel = (i: number) => (ORDINALS[i] ? `${ORDINALS[i]} Round` : `Round ${i + 1}`);

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json()) as DivisionBody;

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Division name is required' }, { status: 400 });
  }

  const { data: tournament, error: tError } = await supabaseAdmin
    .from('tournaments')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (tError) return NextResponse.json({ error: tError.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

  const { data: division, error: dError } = await supabaseAdmin
    .from('divisions')
    .insert({
      tournament_id: tournament.id,
      name: body.name,
      format_type_on_sand: body.formatTypeOnSand,
      registration_fee: body.registrationFee,
      division_team_cap: body.divisionTeamCap,
      reg_fields: body.regFields,
      settings: toSettings(body),
    })
    .select('id, name, format_type_on_sand, registration_fee, division_team_cap, reg_fields, settings')
    .single();
  if (dError) return NextResponse.json({ error: dError.message }, { status: 500 });

  const roundRows = (body.rounds ?? []).map((r, i) => ({
    division_id: division.id,
    sequence: i + 1,
    format: r.format,
    name: roundLabel(i),
    scoring_rules: r.scoring,
  }));
  const { data: rounds, error: rError } = roundRows.length
    ? await supabaseAdmin.from('rounds').insert(roundRows).select('id, sequence, format, name, scoring_rules')
    : { data: [], error: null };
  if (rError) return NextResponse.json({ error: rError.message }, { status: 500 });

  return NextResponse.json({ ...division, rounds }, { status: 201 });
}
