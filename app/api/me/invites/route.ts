import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getCurrentUser } from '../../../../lib/auth';

/* Team invitations addressed to the signed-in account.
 *
 * Scoped by user_id against the session, never by an id in the query
 * string — the where clause is the whole of the authorization here.
 *
 * Returns pending invites and the recently answered ones together, so
 * /profile can show "you accepted this" rather than having the row
 * vanish the moment it is answered. */

export interface TeamInvite {
  /* The players row, which is the invitation — there is no separate
   * invites table, because an invitation is exactly "this roster slot
   * claims to be you". */
  id: string;
  status: 'pending' | 'accepted' | 'declined';
  invitedAt: string | null;
  teamId: string;
  teamName: string;
  divisionName: string;
  slug: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string | null;
}

interface InviteRow {
  id: string;
  invite_status: string;
  invited_at: string | null;
  teams: {
    id: string;
    name: string;
    divisions: {
      name: string;
      tournaments: {
        slug: string;
        title: string;
        location: string;
        start_date: string;
        end_date: string | null;
        cancelled_at: string | null;
        deleted_at: string | null;
      } | null;
    } | null;
  } | null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('players')
    .select(
      'id, invite_status, invited_at, ' +
        'teams!inner(id, name, divisions!inner(name, ' +
        'tournaments!inner(slug, title, location, start_date, end_date, cancelled_at, deleted_at)))'
    )
    .eq('user_id', user.id)
    .in('invite_status', ['pending', 'accepted', 'declined'])
    .order('invited_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const invites: TeamInvite[] = (data as unknown as InviteRow[])
    .filter(row => {
      const tournament = row.teams?.divisions?.tournaments;
      return tournament && !tournament.deleted_at && !tournament.cancelled_at;
    })
    .map(row => {
      const team = row.teams!;
      const division = team.divisions!;
      const tournament = division.tournaments!;
      return {
        id: row.id,
        status: row.invite_status as TeamInvite['status'],
        invitedAt: row.invited_at,
        teamId: team.id,
        teamName: team.name,
        divisionName: division.name,
        slug: tournament.slug,
        title: tournament.title,
        location: tournament.location,
        startDate: tournament.start_date,
        endDate: tournament.end_date,
      };
    });

  return NextResponse.json({
    invites,
    pendingCount: invites.filter(i => i.status === 'pending').length,
  });
}
