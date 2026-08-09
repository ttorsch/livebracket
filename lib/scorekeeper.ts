import { supabaseAdmin } from './supabaseAdmin';
import { redis } from './redis';

/* ── Live score state ─────────────────────────────────────────────
 *
 * Points land in Redis, not Postgres. A referee taps a score button
 * every few seconds for an hour; that is exactly the write pattern
 * Postgres is the wrong store for, and the schema comments in 0001
 * already call it out. Postgres gets one durable write, at finalize.
 *
 * The key is the match id (not the token) so a rotated token doesn't
 * orphan an in-progress match.
 */
export const liveKey = (matchId: string) => `live:match:${matchId}`;
export const liveTournamentKey = (slug: string) => `live:tournament:${slug}`;

// Live state survives a referee closing the tab mid-match, so it carries
// everything needed to redraw the screen exactly as they left it.
export interface LiveScore {
  matchId: string;
  sets: { a: number; b: number }[]; // completed sets
  a: number;                        // current set, team A
  b: number;                        // current set, team B
  updatedAt: number;                // epoch ms
}

export interface ScoringRules {
  setsBestOf: number;
  pointsPerSet: number;
  winBy2: boolean;
  hardCap: number;
  decidingSetPoints: number;
}

const DEFAULT_RULES: ScoringRules = {
  setsBestOf: 3,
  pointsPerSet: 21,
  winBy2: true,
  hardCap: 0,
  decidingSetPoints: 15,
};

export interface ScorekeeperMatch {
  matchId: string;
  status: 'upcoming' | 'live' | 'done';
  court: string | null;
  scheduledTime: string | null;
  tournamentSlug: string;
  tournamentTitle: string;
  divisionName: string;
  roundName: string;
  teamA: { id: string | null; name: string };
  teamB: { id: string | null; name: string };
  rules: ScoringRules;
  live: LiveScore | null;
  finalScoreA: number[] | null;
  finalScoreB: number[] | null;
}

/* Shape of the nested select below. PostgREST returns each !inner embed as an
 * object, which the generated Supabase types don't narrow for us here. */
interface MatchTokenRow {
  id: string;
  court: string | null;
  scheduled_time: string | null;
  status: 'upcoming' | 'live' | 'done';
  score_a: number[] | null;
  score_b: number[] | null;
  team_a: { id: string; name: string } | null;
  team_b: { id: string; name: string } | null;
  rounds: {
    name: string;
    scoring_rules: Partial<ScoringRules> | null;
    divisions: {
      name: string;
      tournaments: { slug: string; title: string } | null;
    } | null;
  } | null;
}

/* Resolve a scorekeeper token to everything the screen needs.
 *
 * Returns null for an unknown token — the caller turns that into a 404, and
 * deliberately says nothing about whether the token merely expired or never
 * existed, since the token is the only credential. */
export async function resolveScorekeeperToken(token: string): Promise<ScorekeeperMatch | null> {
  if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) return null;

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select(`
      id, court, scheduled_time, status, score_a, score_b,
      team_a:teams!matches_team_a_id_fkey(id,name),
      team_b:teams!matches_team_b_id_fkey(id,name),
      rounds!inner (
        name, scoring_rules,
        divisions!inner (
          name,
          tournaments!inner ( slug, title )
        )
      )
    `)
    .eq('scorekeeper_token', token)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as MatchTokenRow;
  const round = row.rounds;
  const division = round?.divisions;
  const tournament = division?.tournaments;

  const stored = (round?.scoring_rules ?? {}) as Partial<ScoringRules>;
  const rules: ScoringRules = {
    setsBestOf: stored.setsBestOf ?? DEFAULT_RULES.setsBestOf,
    pointsPerSet: stored.pointsPerSet ?? DEFAULT_RULES.pointsPerSet,
    winBy2: stored.winBy2 ?? DEFAULT_RULES.winBy2,
    hardCap: stored.hardCap ?? DEFAULT_RULES.hardCap,
    decidingSetPoints: stored.decidingSetPoints ?? DEFAULT_RULES.decidingSetPoints,
  };

  let live: LiveScore | null = null;
  try {
    live = (await redis.get<LiveScore>(liveKey(row.id))) ?? null;
  } catch {
    // Redis being unreachable must not lock a referee out of the screen —
    // they can still score from zero and finalize to Postgres.
    live = null;
  }

  return {
    matchId: row.id,
    status: row.status,
    court: row.court,
    scheduledTime: row.scheduled_time,
    tournamentSlug: tournament?.slug ?? '',
    tournamentTitle: tournament?.title ?? '',
    divisionName: division?.name ?? '',
    roundName: round?.name ?? '',
    teamA: { id: row.team_a?.id ?? null, name: row.team_a?.name ?? 'TBD' },
    teamB: { id: row.team_b?.id ?? null, name: row.team_b?.name ?? 'TBD' },
    rules,
    live,
    finalScoreA: row.score_a,
    finalScoreB: row.score_b,
  };
}

/* How many sets each side has won, by the only rule that matters for a
 * completed set: more points than the other side. */
export function setWins(sets: { a: number; b: number }[]) {
  return {
    a: sets.filter(s => s.a > s.b).length,
    b: sets.filter(s => s.b > s.a).length,
  };
}

// Best-of-N is decided once someone takes more than half the sets.
export function isMatchDecided(sets: { a: number; b: number }[], rules: ScoringRules): boolean {
  const needed = Math.floor(rules.setsBestOf / 2) + 1;
  const { a, b } = setWins(sets);
  return a >= needed || b >= needed;
}
