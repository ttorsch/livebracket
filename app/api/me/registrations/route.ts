import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getCurrentUser } from '../../../../lib/auth';
import { formatTeamName } from '../../../../lib/teamName';

/* Every team this account has registered, newest event first.
 *
 * Scoped by `registered_by` against the session — never by an id in the
 * query string, which would make one player's registrations readable by
 * anyone who could guess a uuid. Service-role access is what lets it read
 * across tournaments the caller does not own; the where clause is the
 * whole of the authorization, so it is the one thing that must be right.
 *
 * Cancelled and deleted tournaments are dropped: the point of the list is
 * "what am I playing", and a deleted event is not an answer to that. */

export interface MyRegistration {
  teamId: string;
  teamName: string;
  slug: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string | null;
  divisionName: string;
  /* The team's standing in the division, not the payment: 'waitlist' means
   * they are queued for a slot rather than holding one. */
  status: 'confirmed' | 'unpaid' | 'waitlist';
  paid: boolean;
  fee: number;
  registeredAt: string;
}

interface TeamRow {
  id: string;
  name: string;
  status: string;
  payment_cleared: boolean;
  created_at: string;
  divisions: {
    name: string;
    registration_fee: number | string | null;
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
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .select(
      'id, name, status, payment_cleared, created_at, ' +
        'divisions!inner(name, registration_fee, ' +
        'tournaments!inner(slug, title, location, start_date, end_date, cancelled_at, deleted_at))'
    )
    .eq('registered_by', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const registrations: MyRegistration[] = (data as unknown as TeamRow[])
    .filter((t) => t.divisions?.tournaments && !t.divisions.tournaments.deleted_at)
    .filter((t) => !t.divisions!.tournaments!.cancelled_at)
    .map((t) => {
      const division = t.divisions!;
      const tournament = division.tournaments!;
      return {
        teamId: t.id,
        teamName: formatTeamName(t.name),
        slug: tournament.slug,
        title: tournament.title,
        location: tournament.location,
        startDate: tournament.start_date,
        endDate: tournament.end_date,
        divisionName: division.name,
        status: (t.status as MyRegistration['status']) ?? 'unpaid',
        paid: Boolean(t.payment_cleared),
        fee: Number(division.registration_fee ?? 0) || 0,
        registeredAt: t.created_at,
      };
    })
    /* Ordered by when the event is, not when the form was filled in — the
     * question a player opens this list to answer is "what is next". */
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  return NextResponse.json({ registrations });
}
