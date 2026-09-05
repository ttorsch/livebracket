/* ── What a player's results add up to ────────────────────────────
 *
 * One reader for "how has this person done": the profile page's own
 * numbers, and the same numbers on the card that opens when you click a
 * name in a team list. Before this existed the arithmetic lived inline in
 * /api/me/stats, where only the signed-in user could reach it.
 *
 * Pure and dependency-free like ./setCompletion and ./matchScore, so both
 * callers and `npm test` can read the same rules.
 *
 * Nothing here decides what may be *shown* — see lib/playerCard.ts for
 * that. A record is built from matches that are already public on the
 * tournament pages, which is why it needs no viewer.
 */

export interface RecordMatch {
  teamAId: string | null;
  teamBId: string | null;
  scoreA: number[] | null;
  scoreB: number[] | null;
  winnerTeamId: string | null;
  status: string;
  roundName: string;
  tournamentTitle: string;
}

export interface PlayerRecord {
  matchesCount: number;
  wins: number;
  losses: number;
  winRate: number;          // whole percent
  setsWon: number;
  setsLost: number;
  bestFinish: string | null;
  longestStreak: number;
}

export const EMPTY_RECORD: PlayerRecord = {
  matchesCount: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  setsWon: 0,
  setsLost: 0,
  bestFinish: null,
  longestStreak: 0,
};

/* A match counts once it has a result to read — the status says so, a
 * winner is recorded, or there are points on the board. Kept broad
 * because a result can arrive by any of those three routes: the
 * scorekeeper finalizing, an organizer typing it in, or an older row
 * written before `status` was reliable. */
function isPlayed(m: RecordMatch, scoreOwn: number[] | null): boolean {
  return (
    m.status === 'done' ||
    m.status === 'finished' ||
    m.winnerTeamId !== null ||
    (!!scoreOwn && scoreOwn.length > 0)
  );
}

/* How far the player got, as a rank we can compare across tournaments.
 * Higher is better; 0 means the round says nothing. */
function finishRank(roundName: string, won: boolean): { rank: number; label: string } | null {
  const isFinal = /final/i.test(roundName) && !/semi/i.test(roundName) && !/quarter/i.test(roundName);
  if (isFinal) return won ? { rank: 5, label: 'Winner' } : { rank: 4, label: 'Finalist' };
  if (/semi/i.test(roundName)) return { rank: 3, label: 'Semifinalist' };
  if (/quarter/i.test(roundName)) return { rank: 2, label: 'Quarterfinalist' };
  return null;
}

/** Who won a played match, by the strongest evidence available. */
export function wonMatch(
  m: RecordMatch,
  ownTeamId: string,
  setsFor: number,
  setsAgainst: number,
  scoreOwn: number[] | null,
  scoreOpp: number[] | null,
): boolean {
  if (m.winnerTeamId) return m.winnerTeamId === ownTeamId;
  if (setsFor !== setsAgainst) return setsFor > setsAgainst;
  // Nothing else to go on: more points across the match.
  if (scoreOwn && scoreOpp) {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return sum(scoreOwn) > sum(scoreOpp);
  }
  return false;
}

/* The record, from every match one of the player's teams appears in.
 *
 * `matches` must arrive in the order they were played — the streak is
 * counted straight through them, so a shuffled list produces a streak
 * that is arithmetically right and historically meaningless. */
export function aggregateRecord(matches: RecordMatch[], teamIds: Iterable<string>): PlayerRecord {
  const own = teamIds instanceof Set ? teamIds : new Set(teamIds);
  if (own.size === 0) return { ...EMPTY_RECORD };

  let matchesCount = 0;
  let wins = 0;
  let losses = 0;
  let setsWon = 0;
  let setsLost = 0;
  let streak = 0;
  let longestStreak = 0;
  let bestRank = 0;
  let bestFinish: string | null = null;

  for (const m of matches) {
    const isA = !!m.teamAId && own.has(m.teamAId);
    const isB = !!m.teamBId && own.has(m.teamBId);
    if (!isA && !isB) continue;

    const ownTeamId = (isA ? m.teamAId : m.teamBId) as string;
    const scoreOwn = isA ? m.scoreA : m.scoreB;
    const scoreOpp = isA ? m.scoreB : m.scoreA;
    if (!isPlayed(m, scoreOwn)) continue;

    let setsFor = 0;
    let setsAgainst = 0;
    if (scoreOwn && scoreOpp) {
      const len = Math.min(scoreOwn.length, scoreOpp.length);
      for (let i = 0; i < len; i++) {
        if (scoreOwn[i] > scoreOpp[i]) setsFor++;
        else if (scoreOpp[i] > scoreOwn[i]) setsAgainst++;
      }
    }
    setsWon += setsFor;
    setsLost += setsAgainst;

    const won = wonMatch(m, ownTeamId, setsFor, setsAgainst, scoreOwn, scoreOpp);
    matchesCount++;
    if (won) {
      wins++;
      streak++;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      losses++;
      streak = 0;
    }

    const finish = finishRank(m.roundName, won);
    if (finish && finish.rank > bestRank) {
      bestRank = finish.rank;
      bestFinish = m.tournamentTitle
        ? `${finish.label} · ${m.tournamentTitle}`
        : finish.label;
    }
  }

  return {
    matchesCount,
    wins,
    losses,
    winRate: matchesCount > 0 ? Math.round((wins / matchesCount) * 100) : 0,
    setsWon,
    setsLost,
    bestFinish,
    longestStreak,
  };
}
