import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { aggregateRecord, EMPTY_RECORD, wonMatch, type PlayerRecord, type RecordMatch } from './playerRecord';

/* ── The card behind a player's name ──────────────────────────────
 *
 * Clicking a name anywhere in the app opens the same card, and this
 * builds it: who the person is, and what their results say.
 *
 * The disclosure rule is the whole reason this is one module rather than
 * a query at each call site. lib/profiles.ts draws a deliberate line —
 * the 8-digit player ID is the key a teammate needs to invite you, and it
 * is meant to be given out by its owner rather than read off a page. So:
 *
 *   · Name, photo and record are public. They are already on the
 *     tournament pages this card opens from — the record is arithmetic
 *     over published results, not a new disclosure.
 *   · Club, hometown and the player ID go only to a signed-in viewer.
 *     An anonymous scrape of a published draw therefore still cannot
 *     collect the IDs of everyone playing in it.
 *
 * `includePrivate` is decided by the caller from the *request's* session,
 * never by anything the client sends.
 */

export interface PlayerCardResult {
  matchId: string;
  date: string | null;
  tournamentTitle: string;
  tournamentSlug: string | null;
  divisionName: string;
  roundName: string;
  opponent: string;
  score: string;
  won: boolean;
}

export interface PlayerThumbs {
  /** People who have thumbed this player up. */
  count: number;
  /** Whether the viewer is one of them. False for a signed-out viewer,
   *  who has no identity to have thumbed with. */
  mine: boolean;
}

export interface PlayerCard {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  record: PlayerRecord;
  thumbs: PlayerThumbs;
  /** Signed-in viewers only; undefined means "not disclosed to you". */
  playerId?: string | null;
  club?: string | null;
  hometown?: string | null;
  /** Most recent results first. Empty unless asked for. */
  recent: PlayerCardResult[];
}

/* Every team this account has played on.
 *
 * Two routes in: the account registered the team, or it is linked to one
 * of the team's player rows. A third — matching on email — is available
 * only when the caller passes one, because that is a match this module
 * must never make on someone else's behalf: an email shared by a couple
 * or a whole team would quietly merge their records.
 */
export async function teamIdsForUser(userId: string, email?: string | null): Promise<string[]> {
  const ids = new Set<string>();

  const { data: registered } = await supabaseAdmin
    .from('teams')
    .select('id')
    .eq('registered_by', userId);
  registered?.forEach(t => ids.add(t.id as string));

  let playerQuery = supabaseAdmin.from('players').select('team_id');
  playerQuery = email
    ? playerQuery.or(`user_id.eq.${userId},email.eq.${email.toLowerCase()}`)
    : playerQuery.eq('user_id', userId);

  const { data: rows } = await playerQuery;
  rows?.forEach(r => { if (r.team_id) ids.add(r.team_id as string); });

  return Array.from(ids);
}

/* Shape of the nested select below; PostgREST returns each embed as an
 * object, which the generated types don't narrow for us here. */
interface MatchRow {
  id: string;
  scheduled_time: string | null;
  status: string;
  score_a: number[] | null;
  score_b: number[] | null;
  winner_team_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a: { id: string; name: string | null } | null;
  team_b: { id: string; name: string | null } | null;
  rounds: {
    name: string | null;
    divisions: {
      name: string | null;
      tournaments: { slug: string | null; title: string | null } | null;
    } | null;
  } | null;
}

const MATCH_COLUMNS = `
  id, scheduled_time, status, score_a, score_b, winner_team_id,
  team_a_id, team_b_id,
  team_a:teams!matches_team_a_id_fkey(id, name),
  team_b:teams!matches_team_b_id_fkey(id, name),
  rounds!inner (
    name,
    divisions!inner (
      name,
      tournaments!inner ( slug, title )
    )
  )
`;

const scoreLine = (own: number[] | null, opp: number[] | null): string => {
  if (!own || !opp || own.length === 0) return '—';
  const len = Math.min(own.length, opp.length);
  return Array.from({ length: len }, (_, i) => `${own[i]}–${opp[i]}`).join(', ');
};

/** The record for a set of teams, and optionally the last few results. */
export async function recordForTeams(
  teamIds: string[],
  recentLimit = 0,
): Promise<{ record: PlayerRecord; recent: PlayerCardResult[] }> {
  if (teamIds.length === 0) return { record: { ...EMPTY_RECORD }, recent: [] };

  const list = teamIds.join(',');
  const { data } = await supabaseAdmin
    .from('matches')
    .select(MATCH_COLUMNS)
    // Played order, which is what makes the streak mean anything.
    .or(`team_a_id.in.(${list}),team_b_id.in.(${list})`)
    .order('scheduled_time', { ascending: true });

  const rows = (data ?? []) as unknown as MatchRow[];
  const own = new Set(teamIds);

  const toRecordMatch = (m: MatchRow): RecordMatch => ({
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    scoreA: m.score_a,
    scoreB: m.score_b,
    winnerTeamId: m.winner_team_id,
    status: m.status,
    roundName: m.rounds?.name ?? '',
    tournamentTitle: m.rounds?.divisions?.tournaments?.title ?? '',
  });

  const record = aggregateRecord(rows.map(toRecordMatch), own);
  if (recentLimit <= 0) return { record, recent: [] };

  const recent: PlayerCardResult[] = [];
  // Newest first, and only as many as asked for.
  for (let i = rows.length - 1; i >= 0 && recent.length < recentLimit; i--) {
    const m = rows[i];
    const isA = !!m.team_a_id && own.has(m.team_a_id);
    const isB = !!m.team_b_id && own.has(m.team_b_id);
    if (!isA && !isB) continue;

    const scoreOwn = isA ? m.score_a : m.score_b;
    const scoreOpp = isA ? m.score_b : m.score_a;
    const played =
      m.status === 'done' || m.status === 'finished' || m.winner_team_id !== null ||
      (!!scoreOwn && scoreOwn.length > 0);
    if (!played) continue;

    let setsFor = 0;
    let setsAgainst = 0;
    if (scoreOwn && scoreOpp) {
      const len = Math.min(scoreOwn.length, scoreOpp.length);
      for (let j = 0; j < len; j++) {
        if (scoreOwn[j] > scoreOpp[j]) setsFor++;
        else if (scoreOpp[j] > scoreOwn[j]) setsAgainst++;
      }
    }

    recent.push({
      matchId: m.id,
      date: m.scheduled_time,
      tournamentTitle: m.rounds?.divisions?.tournaments?.title ?? 'Tournament',
      tournamentSlug: m.rounds?.divisions?.tournaments?.slug ?? null,
      divisionName: m.rounds?.divisions?.name ?? '',
      roundName: m.rounds?.name ?? '',
      opponent: (isA ? m.team_b?.name : m.team_a?.name) ?? 'TBD',
      score: scoreLine(scoreOwn, scoreOpp),
      won: wonMatch(
        toRecordMatch(m),
        (isA ? m.team_a_id : m.team_b_id) as string,
        setsFor,
        setsAgainst,
        scoreOwn,
        scoreOpp,
      ),
    });
  }

  return { record, recent };
}

/* Identity, from the profile row that every account gets at first
 * sign-in, falling back to the sign-up metadata for anything the profile
 * has not been filled in with. */
async function identity(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, player_id, name, avatar_url, club, hometown')
    .eq('id', userId)
    .maybeSingle();

  let name = (profile?.name as string | null) ?? null;
  let avatarUrl = (profile?.avatar_url as string | null) ?? null;

  if (!name || !avatarUrl) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const meta = data?.user?.user_metadata ?? {};
      name = name || (meta.full_name as string) || (meta.name as string) || null;
      avatarUrl = avatarUrl || (meta.avatar_url as string) || (meta.picture as string) || null;
    } catch {
      /* The profile row is enough; a missing auth lookup is not fatal. */
    }
  }

  if (!profile && !name && !avatarUrl) return null;

  return {
    name,
    avatarUrl,
    playerId: (profile?.player_id as string | null) ?? null,
    club: (profile?.club as string | null) ?? null,
    hometown: (profile?.hometown as string | null) ?? null,
  };
}

/* How many people have thumbed this player up, and whether the viewer is
 * one of them. Two reads because the count is public and the second
 * question only exists for someone signed in. */
async function thumbsFor(userId: string, viewerId: string | null): Promise<PlayerThumbs> {
  const { count } = await supabaseAdmin
    .from('player_thumbs')
    .select('id', { count: 'exact', head: true })
    .eq('target_id', userId);

  let mine = false;
  if (viewerId) {
    const { data } = await supabaseAdmin
      .from('player_thumbs')
      .select('id')
      .eq('target_id', userId)
      .eq('actor_id', viewerId)
      .maybeSingle();
    mine = !!data;
  }

  return { count: count ?? 0, mine };
}

export async function getPlayerCard(
  userId: string,
  opts: { includePrivate: boolean; recentLimit?: number; viewerId?: string | null },
): Promise<PlayerCard | null> {
  const who = await identity(userId);
  if (!who) return null;

  const teamIds = await teamIdsForUser(userId);
  const [{ record, recent }, thumbs] = await Promise.all([
    recordForTeams(teamIds, opts.recentLimit ?? 0),
    thumbsFor(userId, opts.viewerId ?? null),
  ]);

  const card: PlayerCard = {
    userId,
    name: who.name,
    avatarUrl: who.avatarUrl,
    record,
    thumbs,
    recent,
  };

  /* Omitted rather than nulled for a viewer who may not see them: the
   * card can then tell "you are not signed in" apart from "this player
   * never filled it in", and say the right thing about each. */
  if (opts.includePrivate) {
    card.playerId = who.playerId;
    card.club = who.club;
    card.hometown = who.hometown;
  }

  return card;
}
