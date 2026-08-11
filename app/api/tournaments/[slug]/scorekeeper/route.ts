import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { formatTeamName } from '../../../../../lib/teamName';

/* Organizer-side listing of scorekeeper links, one per match, so the
 * dashboard can render a real QR for each court.
 *
 * SECURITY NOTE: the tokens this returns are the scorekeeper credentials —
 * anyone holding one can score that match. The endpoint is only as protected
 * as the organizer dashboard itself, which today is not protected at all
 * (the whole app runs as a single hardcoded DEMO_ORGANIZER_ID with no
 * login). Once real auth lands, this route must be gated to the tournament's
 * owning organizer. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const scope = request.nextUrl.searchParams.get('scope') ?? 'pending';

  const { data: tournament, error: tError } = await supabaseAdmin
    .from('tournaments')
    .select('id, slug, title')
    .eq('slug', slug)
    .maybeSingle();
  if (tError) return NextResponse.json({ error: tError.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

  let query = supabaseAdmin
    .from('matches')
    .select(`
      id, court, scheduled_time, planned_time, status, scorekeeper_token,
      team_a:teams!matches_team_a_id_fkey(id,name),
      team_b:teams!matches_team_b_id_fkey(id,name),
      rounds!inner (
        name,
        divisions!inner ( name, tournament_id )
      )
    `)
    .eq('rounds.divisions.tournament_id', tournament.id);

  // Finished matches don't need a QR taped to a post; default to what's
  // still to be played.
  if (scope !== 'all') query = query.neq('status', 'done');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  interface MatchRow {
    id: string;
    court: string | null;
    scheduled_time: string | null;
    planned_time: string | null;
    status: 'upcoming' | 'live' | 'done';
    scorekeeper_token: string;
    team_a: { id: string; name: string } | null;
    team_b: { id: string; name: string } | null;
    rounds: { name: string; divisions: { name: string } | null } | null;
  }

  const matches = ((data ?? []) as unknown as MatchRow[]).map(m => ({
    matchId: m.id,
    token: m.scorekeeper_token,
    court: m.court,
    time: m.scheduled_time ?? m.planned_time,
    status: m.status,
    division: m.rounds?.divisions?.name ?? '',
    round: m.rounds?.name ?? '',
    teamA: formatTeamName(m.team_a?.name) || 'TBD',
    teamB: formatTeamName(m.team_b?.name) || 'TBD',
  }));

  // Live first (someone needs that link right now), then by kickoff, then by
  // court so the list reads the way the courts are laid out.
  matches.sort((a, b) => {
    if ((a.status === 'live') !== (b.status === 'live')) return a.status === 'live' ? -1 : 1;
    if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return (a.court ?? '').localeCompare(b.court ?? '');
  });

  return NextResponse.json({ tournament: { slug: tournament.slug, title: tournament.title }, matches });
}
