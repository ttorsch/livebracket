import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { redis } from '@/lib/redis';
import { liveKey, type LiveScore } from '@/lib/scorekeeper';
import { formatPlayerNames } from '@/lib/teamName';
import type { HeroLiveMatch, HeroPlayer, HeroTeam } from '@/lib/heroLive';

/* ── "What is being played anywhere, right now" ───────────────────
 *
 * The per-tournament sibling of this route (/api/tournaments/[slug]/live)
 * answers the score question once you already know which event you care
 * about. The homepage hero doesn't: it has to find the running event
 * first. So this one starts from the tournaments that are underway today
 * and works down to the courts.
 *
 * Points live in Redis and everything else in Postgres, same split as the
 * scorekeeper — so this is one Postgres pass for the shape of the match
 * and one Redis mget for the numbers on it.
 *
 * Public data only: no tokens, no organizer fields.
 */

export const dynamic = 'force-dynamic';

/* Matches lib/data.todayLocal — the homepage decides "live" from the
 * viewer's calendar day, and this must agree with it or the card and the
 * tournament list below it disagree about what is running. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Same output as the detail page's date line, which is what the card is
 * echoing. Duplicated rather than exported from lib/data because that
 * module pulls in the browser Supabase client. */
function formatDateRange(startDate: string, endDate: string | null, isOneDay: boolean): string {
  const start = new Date(`${startDate}T00:00:00`);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (isOneDay || !endDate || endDate === startDate) return startLabel;

  const end = new Date(`${endDate}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    const monthLabel = start.toLocaleDateString('en-US', { month: 'short' });
    return `${monthLabel} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}

// UTC, for the same reason lib/data formats match times in UTC: a slot is
// stored as the wall clock of the venue, not of whoever is reading it.
function formatMatchTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

interface TournamentRow {
  id: string;
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string | null;
  is_one_day: boolean;
  phase: number;
}

interface MatchRow {
  id: string;
  court: string | null;
  scheduled_time: string | null;
  status: 'live' | 'upcoming' | 'done';
  team_a_id: string | null;
  team_b_id: string | null;
  rounds: { name: string; divisions: { name: string; tournament_id: string } };
}

const EMPTY: HeroTeam = { name: 'TBD', players: [] };

export async function GET() {
  try {
    const today = todayLocal();

    /* Phase 2 is the first public phase — anything below it is a draft the
     * organizer hasn't announced. Cancelled and archived events are not
     * being played whatever their dates say. */
    const { data: tRows, error: tError } = await supabaseAdmin
      .from('tournaments')
      .select('id, slug, title, location, start_date, end_date, is_one_day, phase')
      .is('archived_at', null)
      .is('deleted_at', null)
      .is('cancelled_at', null)
      .gte('phase', 2)
      .lte('start_date', today);
    if (tError) return NextResponse.json({ error: tError.message }, { status: 500 });

    /* end_date is nullable, so the "hasn't finished yet" half of the window
     * can't be a query filter without dropping single-day events. */
    const running = (tRows ?? []).filter(
      (t) => (t.end_date ?? t.start_date) >= today
    ) as TournamentRow[];
    if (running.length === 0) return NextResponse.json({ matches: [] });

    const byId = new Map(running.map((t) => [t.id, t]));

    const { data: mRows, error: mError } = await supabaseAdmin
      .from('matches')
      .select(
        'id, court, scheduled_time, status, team_a_id, team_b_id, ' +
          'rounds!inner ( name, divisions!inner ( name, tournament_id ) )'
      )
      .in('rounds.divisions.tournament_id', Array.from(byId.keys()))
      .neq('status', 'done');
    if (mError) return NextResponse.json({ error: mError.message }, { status: 500 });

    const matches = (mRows ?? []) as unknown as MatchRow[];

    /* The card shows two courts side by side, so this hands back whole
     * pairs rather than a flat list of everything unplayed.
     *
     * Per tournament: every court in play, then only as many
     * not-yet-started courts as it takes to reach two — one alongside a
     * lone live court, two when nothing is being scored at all, none once
     * two courts are already going. Grouping by
     * tournament matters because the photo above the pair carries one
     * event's title and location; a pair drawn from two events would put a
     * lie on it. */
    const byTournament = new Map<string, MatchRow[]>();
    for (const m of matches) {
      const tid = m.rounds.divisions.tournament_id;
      const held = byTournament.get(tid);
      if (held) held.push(m);
      else byTournament.set(tid, [m]);
    }

    /* Walk the tournaments in a fixed order rather than in whatever order
     * Postgres handed back the matches, so a poll returning the same courts
     * doesn't reshuffle the rotation under the reader. */
    const orderedIds = running
      .filter((t) => byTournament.has(t.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((t) => t.id);

    const selected: MatchRow[] = [];
    for (const group of orderedIds.map((id) => byTournament.get(id)!)) {
      const live = group
        .filter((m) => m.status === 'live')
        .sort((a, b) => (a.court ?? '').localeCompare(b.court ?? '', undefined, { numeric: true }));
      const upcoming = group
        .filter((m) => m.status !== 'live' && m.scheduled_time)
        .sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''));

      const fill = Math.max(0, 2 - live.length);
      selected.push(...live, ...upcoming.slice(0, fill));
    }
    if (selected.length === 0) return NextResponse.json({ matches: [] });

    /* ── Who is playing ─────────────────────────────────────────── */
    const teamIds = Array.from(
      new Set(selected.flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean) as string[])
    );
    const { data: teamRows } = teamIds.length
      ? await supabaseAdmin
          .from('teams')
          .select('id, name, seed, players ( id, name, user_id )')
          .in('id', teamIds)
      : { data: [] as unknown[] };

    type TeamRow = { id: string; name: string | null; seed?: number | null; players: { id: string; name: string; user_id: string | null }[] };
    const teams = new Map<string, TeamRow>(
      ((teamRows ?? []) as unknown as TeamRow[]).map((t) => [t.id, t])
    );

    /* ── Their faces ────────────────────────────────────────────── */
    const userIds = Array.from(
      new Set(
        Array.from(teams.values())
          .flatMap((t) => t.players ?? [])
          .map((p) => p.user_id)
          .filter(Boolean) as string[]
      )
    );
    const avatars = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, avatar_url')
        .in('id', userIds)
        .not('avatar_url', 'is', null);
      for (const p of (profiles ?? []) as { id: string; avatar_url: string | null }[]) {
        if (p.avatar_url) avatars.set(p.id, p.avatar_url);
      }
    }

    /* ── The numbers ────────────────────────────────────────────── */
    const liveIds = selected.filter((m) => m.status === 'live').map((m) => m.id);
    const scores = new Map<string, LiveScore>();
    if (liveIds.length > 0) {
      /* A dead Redis costs the card its scores, not its existence — same
       * degradation the per-tournament route chose. */
      try {
        const values = await redis.mget<LiveScore[]>(...liveIds.map(liveKey));
        liveIds.forEach((id, i) => {
          const v = values[i];
          if (v) scores.set(id, v);
        });
      } catch {
        /* fall through with an empty map */
      }
    }

    const toTeam = (id: string | null): HeroTeam => {
      if (!id) return EMPTY;
      const t = teams.get(id);
      if (!t) return EMPTY;
      const display = formatPlayerNames(t.players, t.name, t.seed) || 'TBD';
      const players: HeroPlayer[] = (t.players ?? []).map((p) => ({
        name: p.name,
        avatarUrl: (p.user_id && avatars.get(p.user_id)) || null,
      }));
      /* A team registered before its roster was filled in still needs two
       * circles, so fall back to splitting the stored name. */
      if (players.length === 0 && t.name) {
        for (const part of t.name.split('/').map((s) => s.trim()).filter(Boolean)) {
          players.push({ name: part, avatarUrl: null });
        }
      }
      return { name: display, players };
    };

    const payload: HeroLiveMatch[] = selected.map((m) => {
      const t = byId.get(m.rounds.divisions.tournament_id)!;
      const s = scores.get(m.id);
      return {
        matchId: m.id,
        tournamentSlug: t.slug,
        tournamentTitle: t.title,
        location: t.location,
        dateLabel: formatDateRange(t.start_date, t.end_date, t.is_one_day),
        court: m.court || 'Court TBD',
        division: m.rounds.divisions.name,
        round: m.rounds.name,
        status: m.status === 'live' ? 'live' : 'upcoming',
        startTime: formatMatchTime(m.scheduled_time),
        teamA: toTeam(m.team_a_id),
        teamB: toTeam(m.team_b_id),
        sets: s?.sets ?? [],
        pointsA: s?.a ?? 0,
        pointsB: s?.b ?? 0,
        lastScorer: s?.lastScorer ?? null,
        /* The referee stamps this on every point, so it is the card's
         * measure of which court is liveliest. Null for a court that
         * hasn't started — nothing has been written for it yet. */
        updatedAt: s?.updatedAt ?? null,
      };
    });

    /* Deliberately not re-sorted: the selection above already lays the
     * matches out tournament by tournament, courts in play first, which is
     * the order the card pairs them off in. */

    return NextResponse.json({ matches: payload });
  } catch (err) {
    return NextResponse.json(
      { matches: [], error: err instanceof Error ? err.message : 'Failed to load live matches' },
      { status: 500 }
    );
  }
}
