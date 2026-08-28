import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { requireTournamentOwner } from '../../../../../lib/auth';
import { authErrorResponse } from '../../../../../lib/authResponse';

const roundLabel = (i: number) => `Round ${i + 1}`;

// Per-round match length (minutes), clamped to a sane range; defaults to 45.
const clampMinutes = (v: number | undefined) =>
  typeof v === 'number' && v > 0 ? Math.max(5, Math.min(240, Math.trunc(v))) : 45;

interface DivisionBody {
  name: string;
  divisionTeamCap: number;
  formatTypeOnSand: string;
  maxRosterSize: number;
  registrationFee: number;
  currency: string;
  registrationOpenDate: string;
  registrationCloseDate: string;
  // Each round carries its own scoring rules (e.g. pool play to 21, the
  // elimination round after it best of 3) instead of one blob per division.
  // durationMinutes (per-round match length) is folded into scoring_rules on save.
  rounds: { format: string; scoring: Record<string, unknown>; durationMinutes?: number }[];
  rules: string;
  regFields: unknown[];
  allowMulti: boolean;
  genderEligibility: string;
  ageLimit: string;
  prizePool: string;
  netHeight: string;
  minTeams: number;
  waitlistCap: number;
  advancePerPool: number;
  crossing: string;
  confirmationMessage: string;
  confirmationImage: string;
}

const CURRENCIES = ['THB', 'USD', 'EUR', 'GBP', 'AUD', 'SGD'];

function toSettings(body: DivisionBody) {
  return {
    maxRosterSize: body.maxRosterSize,
    // Display currency for registrationFee. Whitelisted so a hand-made
    // request cannot store an arbitrary code the form can't render back.
    currency: CURRENCIES.includes(body.currency) ? body.currency : 'THB',
    registrationOpenDate: body.registrationOpenDate,
    // See the PATCH route: settings is written wholesale, so a key left out
    // here is a key that never persists.
    registrationCloseDate: body.registrationCloseDate,
    rules: body.rules,
    allowMulti: body.allowMulti,
    genderEligibility: body.genderEligibility,
    ageLimit: body.ageLimit,
    prizePool: body.prizePool,
    netHeight: body.netHeight,
    minTeams: body.minTeams,
    waitlistCap: body.waitlistCap,
    // How many teams leave each pool for the next round. Set at division
    // setup; the draw screen starts from it. Clamped to the same 1–4 the
    // form allows, so a hand-made request can't produce a bracket the draw
    // cannot build.
    advancePerPool: Math.max(1, Math.min(4, Math.trunc(body.advancePerPool ?? 2) || 2)),
    // How pool finishers seed into the knockout round. Only the two the draw
    // can actually build are accepted; anything else falls back to FIVB.
    crossing: ['fivb', 'static'].includes(body.crossing) ? body.crossing : 'fivb',
    confirmationMessage: body.confirmationMessage,
    confirmationImage: body.confirmationImage,
    // The rounds the organizer configured, recorded separately from the
    // `rounds` table because a draw later replaces that table's contents with
    // the bracket those rounds expand into. See the PATCH route.
    formatRounds: (body.rounds ?? []).map(r => ({
      format: r.format,
      scoring: r.scoring,
      durationMinutes: clampMinutes(r.durationMinutes),
    })),
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
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
    scoring_rules: { ...r.scoring, durationMinutes: clampMinutes(r.durationMinutes) },
  }));
  const { data: rounds, error: rError } = roundRows.length
    ? await supabaseAdmin.from('rounds').insert(roundRows).select('id, sequence, format, name, scoring_rules')
    : { data: [], error: null };
  if (rError) return NextResponse.json({ error: rError.message }, { status: 500 });

  return NextResponse.json({ ...division, rounds }, { status: 201 });
}
