import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { formatTeamName } from '../../../../../../lib/teamName';
import { requireTournamentOwner } from '../../../../../../lib/auth';
import { authErrorResponse } from '../../../../../../lib/authResponse';

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
  rounds: { id?: string; format: string; scoring: Record<string, unknown>; durationMinutes?: number }[];
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

const roundLabel = (i: number) => `Round ${i + 1}`;

// Per-round match length (minutes), clamped to a sane range; defaults to 45.
const clampMinutes = (v: number | undefined) =>
  typeof v === 'number' && v > 0 ? Math.max(5, Math.min(240, Math.trunc(v))) : 45;

const CURRENCIES = ['THB', 'USD', 'EUR', 'GBP', 'AUD', 'SGD'];

function toSettings(body: DivisionBody) {
  return {
    maxRosterSize: body.maxRosterSize,
    // Display currency for registrationFee. Whitelisted so a hand-made
    // request cannot store an arbitrary code the form can't render back.
    currency: CURRENCIES.includes(body.currency) ? body.currency : 'THB',
    registrationOpenDate: body.registrationOpenDate,
    // Registration is derived from these two dates (lib/tournamentLifecycle),
    // and settings is replaced wholesale below — leaving the close date out
    // of here silently reset it on every save.
    registrationCloseDate: body.registrationCloseDate,
    rules: body.rules,
    allowMulti: body.allowMulti,
    genderEligibility: body.genderEligibility,
    ageLimit: body.ageLimit,
    prizePool: body.prizePool,
    netHeight: body.netHeight,
    minTeams: body.minTeams,
    waitlistCap: body.waitlistCap,
    // Settings is written wholesale — omitting this on edit would silently
    // reset the organizer's advance count on every save.
    advancePerPool: Math.max(1, Math.min(4, Math.trunc(body.advancePerPool ?? 2) || 2)),
    // How pool finishers seed into the knockout round. Only the two the draw
    // can actually build are accepted; anything else falls back to FIVB.
    crossing: ['fivb', 'static'].includes(body.crossing) ? body.crossing : 'fivb',
    confirmationMessage: body.confirmationMessage,
    confirmationImage: body.confirmationImage,
  };
}

async function findDivision(slug: string, divisionId: string) {
  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select('id, settings, tournaments!inner(slug)')
    .eq('id', divisionId)
    .eq('tournaments.slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
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

  let existing;
  try {
    existing = await findDivision(slug, divisionId);
    if (!existing) {
      return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }

  // Preserve the bracket page's draw config — this route owns every other
  // settings key, but `draw` is written by the draw endpoint.
  const prevDraw = (existing.settings as Record<string, unknown> | null)?.draw;

  const { data: division, error: dError } = await supabaseAdmin
    .from('divisions')
    .update({
      name: body.name,
      format_type_on_sand: body.formatTypeOnSand,
      registration_fee: body.registrationFee,
      division_team_cap: body.divisionTeamCap,
      reg_fields: body.regFields,
      settings: prevDraw === undefined ? toSettings(body) : { ...toSettings(body), draw: prevDraw },
    })
    .eq('id', divisionId)
    .select('id, name, format_type_on_sand, registration_fee, division_team_cap, reg_fields, settings')
    .single();
  if (dError) return NextResponse.json({ error: dError.message }, { status: 500 });

  // ── Rounds ───────────────────────────────────────────────────────────────
  //
  // `body.rounds` is the organizer's *configuration* — "a round robin, then a
  // single elimination" — which is not the same list as the `rounds` table.
  // Once a draw runs, that table holds the bracket the configuration was
  // expanded into: one row per knockout stage, with every match hanging off it
  // by `round_id ... on delete cascade`. Replacing the table wholesale, which
  // is what this used to do, therefore deleted the whole bracket and its
  // schedule every time someone opened this dialog and pressed save.
  //
  // So the configuration is now recorded in its own right, and the table is
  // only rebuilt when the configuration's *shape* changed. Otherwise the new
  // scoring and match length are pushed onto the stages that were generated
  // from each configured round — matched by format, exactly the way the draw
  // assigns them in the first place — and no row is deleted.
  const incoming = body.rounds ?? [];
  const settings = (division.settings ?? {}) as Record<string, unknown>;

  const { data: existingRounds, error: exError } = await supabaseAdmin
    .from('rounds')
    .select('id, sequence, format, name, scoring_rules')
    .eq('division_id', divisionId)
    .order('sequence', { ascending: true });
  if (exError) return NextResponse.json({ error: exError.message }, { status: 500 });

  const current = existingRounds ?? [];
  const hasDraw = !!settings.draw;

  // The configuration as it stood before this save, by the same three-step
  // reckoning the setup page loads it with.
  const storedConfig = settings.formatRounds as { format: string }[] | undefined;
  const previousConfig =
    Array.isArray(storedConfig) && storedConfig.length > 0
      ? storedConfig
      : hasDraw
        ? current.filter((r, i) => i === 0 || current[i - 1].format !== r.format)
        : current;

  const sameShape =
    previousConfig.length === incoming.length &&
    incoming.every((r, i) => r.format === previousConfig[i].format);

  const formatRounds = incoming.map(r => ({
    format: r.format,
    scoring: r.scoring,
    durationMinutes: clampMinutes(r.durationMinutes),
  }));
  const rulesFor = (format: string) =>
    formatRounds.find(r => r.format === format) ?? formatRounds[0];

  if (sameShape && current.length > 0) {
    // Push scoring and match length down onto every stage of the matching
    // format. A configured elimination round governs all of Round of 16 …
    // Final, which is the same rule the draw applies when it builds them.
    const updated = [];
    for (const row of current) {
      const rules = rulesFor(row.format);
      const { data, error } = await supabaseAdmin
        .from('rounds')
        .update({ scoring_rules: { ...rules.scoring, durationMinutes: rules.durationMinutes } })
        .eq('id', row.id)
        .select('id, sequence, format, name, scoring_rules')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      updated.push(data);
    }
    await supabaseAdmin
      .from('divisions')
      .update({ settings: { ...settings, formatRounds } })
      .eq('id', divisionId);
    return NextResponse.json({ ...division, rounds: updated, bracketCleared: false });
  }

  const { error: delError } = await supabaseAdmin.from('rounds').delete().eq('division_id', divisionId);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  const roundRows = incoming.map((r, i) => ({
    division_id: divisionId,
    sequence: i + 1,
    format: r.format,
    name: roundLabel(i),
    scoring_rules: { ...r.scoring, durationMinutes: clampMinutes(r.durationMinutes) },
  }));
  const { data: rounds, error: rError } = roundRows.length
    ? await supabaseAdmin.from('rounds').insert(roundRows).select('id, sequence, format, name, scoring_rules')
    : { data: [], error: null };
  if (rError) return NextResponse.json({ error: rError.message }, { status: 500 });

  // The bracket went with the old rounds, so the draw that described it is now
  // a description of nothing. Clearing it keeps the division honestly "not yet
  // drawn" instead of leaving slot/crossing data pointing at deleted matches.
  const { draw: _dropped, ...withoutDraw } = settings;
  await supabaseAdmin
    .from('divisions')
    .update({ settings: { ...withoutDraw, formatRounds } })
    .eq('id', divisionId);

  return NextResponse.json({ ...division, rounds, bracketCleared: hasDraw });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ slug: string; divisionId: string }> }) {
  const { slug, divisionId } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    if (!(await findDivision(slug, divisionId))) {
      return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('divisions').delete().eq('id', divisionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; divisionId: string }> }
) {
  const { slug, divisionId } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('id, name, seed, payment_cleared, status, players(id, name, phone, email, shirt_size)')
    .eq('division_id', divisionId)
    .order('seed', { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const teams = (data ?? []).map((t) => ({
    id: t.id,
    name: formatTeamName(t.name),
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

  return NextResponse.json(teams);
}
