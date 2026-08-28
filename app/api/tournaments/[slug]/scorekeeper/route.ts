import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { formatTeamName } from '../../../../../lib/teamName';
import { requireTournamentOwner } from '../../../../../lib/auth';
import { authErrorResponse } from '../../../../../lib/authResponse';

/* Organizer-side listing of scorekeeper links, one per match, so the
 * dashboard can render a real QR for each court.
 *
 * SECURITY NOTE: the tokens this returns are the scorekeeper credentials —
 * anyone holding one can score that match. That is why the guard below is
 * ownership, not merely authentication: any signed-in organizer must not be
 * able to pull the scoring tokens for someone else's event. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    // Owning this tournament is the permission; being signed in is not.
    await requireTournamentOwner(slug);
  } catch (err) {
    return authErrorResponse(err);
  }
  const scope = request.nextUrl.searchParams.get('scope') ?? 'pending';

  const { data: tournament, error: tError } = await supabaseAdmin
    .from('tournaments')
    .select('id, slug, title')
    .eq('slug', slug)
    .maybeSingle();
  if (tError) return NextResponse.json({ error: tError.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });

  /* Every match is fetched regardless of scope, because the day numbering
   * below has to be stable: if day 1 finishes and drops out of the pending
   * set, day 2 must not renumber itself to "Day 1" on the organizer's
   * board. The scope filter is applied after the map is built. */
  const { data, error } = await supabaseAdmin
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

  /* Which day of the event a match falls on. An organizer reads "Day 2"
   * faster than a calendar date, and it's how the schedule is laid out.
   *
   * Numbered from the distinct dates the schedule actually uses, not from
   * tournaments.start_date: the two can disagree (a draw regenerated onto
   * later dates leaves start_date stale), and when they do, counting from
   * start_date yields nonsense like "Day 8" for a two-day event. The
   * schedule is the thing the organizer is looking at, so it wins.
   *
   * Dates are read in UTC: scheduled_time is a UTC instant whose wall clock
   * is the intended local time (see the schedule save route), so its UTC
   * date is the day the organizer placed it on. */
  const rows = (data ?? []) as unknown as MatchRow[];
  const dateOf = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  const dayByDate = new Map(
    [...new Set(rows.map(m => dateOf(m.scheduled_time ?? m.planned_time)).filter(Boolean))]
      .sort()
      .map((date, i) => [date as string, i + 1] as const)
  );

  const matches = rows
    .filter(m => scope === 'all' || m.status !== 'done')
    .map(m => {
      const time = m.scheduled_time ?? m.planned_time;
      const date = dateOf(time);
      return {
        matchId: m.id,
        token: m.scorekeeper_token,
        court: m.court,
        time,
        day: date ? dayByDate.get(date) ?? null : null,
        status: m.status,
        division: m.rounds?.divisions?.name ?? '',
        round: m.rounds?.name ?? '',
        teamA: formatTeamName(m.team_a?.name) || 'TBD',
        teamB: formatTeamName(m.team_b?.name) || 'TBD',
      };
    });

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
