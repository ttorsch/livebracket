import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { requireTournamentOwner } from '../../../../../lib/auth';
import { authErrorResponse } from '../../../../../lib/authResponse';
import { isSpecialFormat } from '../../../../../lib/roundFormat';

/* Adds a special match — an exhibition the organizer puts on by hand.
 *
 * It counts for nothing (see migration 0025): it is stored in a round of its
 * own with the format 'special', which every standings, bracket, advancement
 * and record path passes by. It arrives with no court and no time, so it
 * lands in the schedule's Unscheduled tray for the organizer to place.
 *
 * Each side is either a registered team of this tournament — any division —
 * or a name typed for this match alone, which creates no team. */

interface SideInput {
  teamId?: unknown;
  label?: unknown;
}

interface Body {
  teamA?: SideInput;
  teamB?: SideInput;
  durationMinutes?: unknown;
}

interface DivisionRow {
  id: string;
  created_at: string;
  teams: { id: string; status: string }[];
  rounds: { sequence: number; format: string; scoring_rules: Record<string, unknown> | null }[];
}

const LABEL_MAX = 80;
// The same bounds a configured round's match length is held to.
const clampMinutes = (v: unknown) =>
  typeof v === 'number' && v > 0 ? Math.max(5, Math.min(240, Math.trunc(v))) : 30;

/* Special rounds number from here, clear of the 1, 2, 3… a draw uses. */
const SPECIAL_SEQUENCE_FLOOR = 1000;

type Side = { teamId: string; label: null } | { teamId: null; label: string };

function readSide(input: SideInput | undefined, teamIds: Set<string>): Side | string {
  if (typeof input?.teamId === 'string' && input.teamId) {
    return teamIds.has(input.teamId)
      ? { teamId: input.teamId, label: null }
      : 'That team is not in this tournament.';
  }
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  if (!label) return 'Pick a team for both sides, or type a name for a new one.';
  if (label.length > LABEL_MAX) return `A team name can be at most ${LABEL_MAX} characters.`;
  return { teamId: null, label };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let tournamentId: string;
  try {
    ({ tournamentId } = await requireTournamentOwner(slug));
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = (await request.json().catch(() => ({}))) as Body;

  const { data, error } = await supabaseAdmin
    .from('divisions')
    .select('id, created_at, teams ( id, status ), rounds ( sequence, format, scoring_rules )')
    .eq('tournament_id', tournamentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const divisions = ((data ?? []) as unknown as DivisionRow[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (divisions.length === 0) {
    return NextResponse.json({ error: 'Add a division before adding a match.' }, { status: 400 });
  }

  // Waitlisted teams hold no seat, so they are not in the tournament to play.
  const teamDivision = new Map<string, DivisionRow>();
  for (const d of divisions) {
    for (const t of d.teams) if (t.status !== 'waitlist') teamDivision.set(t.id, d);
  }
  const teamIds = new Set(teamDivision.keys());

  const a = readSide(body.teamA, teamIds);
  if (typeof a === 'string') return NextResponse.json({ error: a }, { status: 400 });
  const b = readSide(body.teamB, teamIds);
  if (typeof b === 'string') return NextResponse.json({ error: b }, { status: 400 });
  if (a.teamId && a.teamId === b.teamId) {
    return NextResponse.json({ error: 'A team cannot play itself — pick two different teams.' }, { status: 400 });
  }

  /* The round has to hang off some division for the schedule, the
     scorekeeper link and the public page to reach it. Which one is storage
     only — the match is shown as the tournament's — so it is the first
     side's team's, else the second's, else the oldest division. */
  const home =
    (a.teamId ? teamDivision.get(a.teamId) : undefined) ??
    (b.teamId ? teamDivision.get(b.teamId) : undefined) ??
    divisions[0];

  /* Scored like that division's own matches unless told otherwise — the
     length is the modal's, the points per set and best-of are the first
     configured round's. */
  const played = [...home.rounds]
    .filter(r => !isSpecialFormat(r.format))
    .sort((x, y) => x.sequence - y.sequence)[0];
  const scoringRules = {
    ...(played?.scoring_rules ?? {}),
    durationMinutes: clampMinutes(body.durationMinutes),
  };
  const sequence = Math.max(
    SPECIAL_SEQUENCE_FLOOR,
    ...home.rounds.map(r => r.sequence + 1),
  );

  const { data: round, error: roundError } = await supabaseAdmin
    .from('rounds')
    .insert({ division_id: home.id, sequence, format: 'special', name: 'Special', scoring_rules: scoringRules })
    .select('id')
    .single();
  if (roundError) return NextResponse.json({ error: `Failed to add the match: ${roundError.message}` }, { status: 500 });

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .insert({
      round_id: round.id,
      division_id: home.id,
      team_a_id: a.teamId,
      team_b_id: b.teamId,
      team_a_label: a.label,
      team_b_label: b.label,
      status: 'upcoming',
    })
    .select('id')
    .single();
  if (matchError) {
    // A round with no match in it is nothing; take it back out.
    await supabaseAdmin.from('rounds').delete().eq('id', round.id);
    return NextResponse.json({ error: `Failed to add the match: ${matchError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, matchId: match.id }, { status: 201 });
}
