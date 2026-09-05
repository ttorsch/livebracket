import { STANDING_POINTS, isForfeitMatch } from './roundFormat.ts';

export interface PoolTeamInput {
  id: string;
  name: string;
  seed?: number;
  entryOrder?: number;
}

export interface PoolMatchInput {
  teamAId?: string | null;
  teamBId?: string | null;
  status?: string | null;
  winner?: 'A' | 'B' | null;
  scoreA?: number[] | null;
  scoreB?: number[] | null;
}

export interface CalculatedStandingRow {
  teamId: string;
  team: string;
  seed: number;
  entryOrder: number;
  played: number;
  wins: number;
  losses: number;
  byes: number;
  points: number;
  setsFor: number;
  setsAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * Ratio of won to lost (sets or points).
 * If conceded is 0:
 * - returns Infinity if scored > 0
 * - returns 0 if scored is 0
 */
export function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return numerator > 0 ? Infinity : 0;
  }
  return numerator / denominator;
}

const EPSILON = 1e-9;

function compareRatios(ratioA: number, ratioB: number): number {
  if (Math.abs(ratioA - ratioB) > EPSILON) {
    return ratioB - ratioA; // Higher ratio ranks first
  }
  return 0;
}

/**
 * Pre-tournament seeding comparison.
 * Lower seed number represents a higher seed (e.g. Seed 1 beats Seed 2).
 * Seeds > 0 rank higher than unassigned / seed 0.
 * Ties fall back to original registration entry order.
 */
export function compareSeeds(
  seedA: number,
  seedB: number,
  entryOrderA: number,
  entryOrderB: number,
): number {
  const hasA = seedA > 0;
  const hasB = seedB > 0;
  if (hasA && hasB) {
    if (seedA !== seedB) return seedA - seedB;
  } else if (hasA) {
    return -1;
  } else if (hasB) {
    return 1;
  }
  return entryOrderA - entryOrderB;
}

/**
 * Calculates standings and resolves ties according to tournament rules:
 *
 * Point System:
 * - Match Won (2–0 or 2–1): 2 points
 * - Match Lost (1–2 or 0–2): 1 point (awarded for completing the match)
 * - Forfeit / Default: 0 points (opponent wins 2–0 with 21–0, 21–0)
 *
 * Tiebreaking Rules:
 * 1. Two-Team Tie:
 *    - Head-to-Head: Direct match winner takes higher seed.
 *    - Fallback (if unplayed / tied): Pool Set Ratio -> Pool Point Ratio -> Seeding -> Entry Order.
 *
 * 2. Three-Team Tie:
 *    Resolved strictly using matches played between the tied teams:
 *    1. Set Ratio among tied teams (sets won / sets lost)
 *    2. Point (Rally) Ratio among tied teams (rally points scored / rally points conceded)
 *    3. Pool-Wide Set Ratio
 *    4. Pool-Wide Point Ratio
 *    5. Pre-tournament Seeding (Seed 1 > Seed 2 > Seed 3)
 *    6. Entry Order
 *
 * 3. Four-or-More-Team Tie:
 *    Resolved using pool-wide ratios directly:
 *    1. Pool-Wide Set Ratio
 *    2. Pool-Wide Point Ratio
 *    3. Pre-tournament Seeding
 *    4. Entry Order
 */
export function calculatePoolStandings(
  teams: PoolTeamInput[],
  matches: PoolMatchInput[],
): CalculatedStandingRow[] {
  const statsMap = new Map<string, CalculatedStandingRow>();

  teams.forEach((t, idx) => {
    statsMap.set(t.id, {
      teamId: t.id,
      team: t.name,
      seed: t.seed ?? 0,
      entryOrder: t.entryOrder ?? idx,
      played: 0,
      wins: 0,
      losses: 0,
      byes: 0,
      points: 0,
      setsFor: 0,
      setsAgainst: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  });

  // Accumulate match statistics
  for (const m of matches) {
    if (m.status !== 'done' || !m.teamAId || !m.teamBId || !m.winner) continue;
    let a = statsMap.get(m.teamAId);
    let b = statsMap.get(m.teamBId);

    // If either team is not in initial pool, initialize
    if (!a) {
      a = {
        teamId: m.teamAId,
        team: 'Team A',
        seed: 0,
        entryOrder: 999,
        played: 0,
        wins: 0,
        losses: 0,
        byes: 0,
        points: 0,
        setsFor: 0,
        setsAgainst: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      statsMap.set(m.teamAId, a);
    }
    if (!b) {
      b = {
        teamId: m.teamBId,
        team: 'Team B',
        seed: 0,
        entryOrder: 999,
        played: 0,
        wins: 0,
        losses: 0,
        byes: 0,
        points: 0,
        setsFor: 0,
        setsAgainst: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      };
      statsMap.set(m.teamBId, b);
    }

    a.played += 1;
    b.played += 1;

    const setsA = m.scoreA ?? [];
    const setsB = m.scoreB ?? [];
    const setLimit = Math.max(setsA.length, setsB.length);

    for (let i = 0; i < setLimit; i++) {
      const sa = setsA[i] ?? 0;
      const sb = setsB[i] ?? 0;
      a.pointsFor += sa;
      a.pointsAgainst += sb;
      b.pointsFor += sb;
      b.pointsAgainst += sa;
      if (sa === sb) continue;
      if (sa > sb) {
        a.setsFor += 1;
        b.setsAgainst += 1;
      } else {
        b.setsFor += 1;
        a.setsAgainst += 1;
      }
    }

    const isWinnerA = m.winner === 'A';
    const winner = isWinnerA ? a : b;
    const loser = isWinnerA ? b : a;
    const scoreWinner = isWinnerA ? setsA : setsB;
    const scoreLoser = isWinnerA ? setsB : setsA;
    const isForfeit = isForfeitMatch(scoreWinner, scoreLoser);

    // Points system
    winner.wins += 1;
    winner.points += STANDING_POINTS.WIN;

    if (isForfeit) {
      loser.byes += 1;
      loser.points += STANDING_POINTS.FORFEIT;
    } else {
      loser.losses += 1;
      loser.points += STANDING_POINTS.LOSS;
    }
  }

  const allRows = Array.from(statsMap.values());

  // Group by points
  const pointsGroups = new Map<number, CalculatedStandingRow[]>();
  for (const row of allRows) {
    const list = pointsGroups.get(row.points) ?? [];
    list.push(row);
    pointsGroups.set(row.points, list);
  }

  const sortedPoints = Array.from(pointsGroups.keys()).sort((a, b) => b - a);
  const result: CalculatedStandingRow[] = [];

  for (const pts of sortedPoints) {
    const group = pointsGroups.get(pts)!;

    if (group.length === 1) {
      result.push(group[0]);
    } else if (group.length === 2) {
      // ── Two-Team Tie ──────────────────────────────────────────────
      const [teamX, teamY] = group;
      // Look for head-to-head match(es) between teamX and teamY
      let winsX = 0;
      let winsY = 0;

      for (const m of matches) {
        if (m.status !== 'done' || !m.winner) continue;
        const isXvsY = m.teamAId === teamX.teamId && m.teamBId === teamY.teamId;
        const isYvsX = m.teamAId === teamY.teamId && m.teamBId === teamX.teamId;
        if (isXvsY) {
          if (m.winner === 'A') winsX++;
          else if (m.winner === 'B') winsY++;
        } else if (isYvsX) {
          if (m.winner === 'A') winsY++;
          else if (m.winner === 'B') winsX++;
        }
      }

      if (winsX !== winsY) {
        // Direct match winner takes higher seed
        if (winsX > winsY) {
          result.push(teamX, teamY);
        } else {
          result.push(teamY, teamX);
        }
      } else {
        // Fallback if unplayed or head-to-head split
        const sortedTwo = [teamX, teamY].sort((a, b) => {
          const ratioSet = compareRatios(
            safeRatio(a.setsFor, a.setsAgainst),
            safeRatio(b.setsFor, b.setsAgainst),
          );
          if (ratioSet !== 0) return ratioSet;

          const ratioPts = compareRatios(
            safeRatio(a.pointsFor, a.pointsAgainst),
            safeRatio(b.pointsFor, b.pointsAgainst),
          );
          if (ratioPts !== 0) return ratioPts;

          return compareSeeds(a.seed, b.seed, a.entryOrder, b.entryOrder);
        });
        result.push(...sortedTwo);
      }
    } else if (group.length === 3) {
      // ── Three-Team Tie ────────────────────────────────────────────
      const tiedIds = new Set(group.map(t => t.teamId));

      // Calculate mini-stats strictly from matches between the 3 tied teams
      const miniStats = new Map<
        string,
        { setsFor: number; setsAgainst: number; pointsFor: number; pointsAgainst: number }
      >();
      group.forEach(t => {
        miniStats.set(t.teamId, { setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0 });
      });

      for (const m of matches) {
        if (
          m.status !== 'done' ||
          !m.teamAId ||
          !m.teamBId ||
          !tiedIds.has(m.teamAId) ||
          !tiedIds.has(m.teamBId)
        ) {
          continue;
        }

        const statsA = miniStats.get(m.teamAId)!;
        const statsB = miniStats.get(m.teamBId)!;
        const setsA = m.scoreA ?? [];
        const setsB = m.scoreB ?? [];
        const setLimit = Math.max(setsA.length, setsB.length);

        for (let i = 0; i < setLimit; i++) {
          const sa = setsA[i] ?? 0;
          const sb = setsB[i] ?? 0;
          statsA.pointsFor += sa;
          statsA.pointsAgainst += sb;
          statsB.pointsFor += sb;
          statsB.pointsAgainst += sa;
          if (sa === sb) continue;
          if (sa > sb) {
            statsA.setsFor += 1;
            statsB.setsAgainst += 1;
          } else {
            statsB.setsFor += 1;
            statsA.setsAgainst += 1;
          }
        }
      }

      const sortedThree = [...group].sort((a, b) => {
        const aMini = miniStats.get(a.teamId)!;
        const bMini = miniStats.get(b.teamId)!;

        // 1. Set Ratio among tied teams
        const setRatioDiff = compareRatios(
          safeRatio(aMini.setsFor, aMini.setsAgainst),
          safeRatio(bMini.setsFor, bMini.setsAgainst),
        );
        if (setRatioDiff !== 0) return setRatioDiff;

        // 2. Point Ratio among tied teams
        const ptRatioDiff = compareRatios(
          safeRatio(aMini.pointsFor, aMini.pointsAgainst),
          safeRatio(bMini.pointsFor, bMini.pointsAgainst),
        );
        if (ptRatioDiff !== 0) return ptRatioDiff;

        // 3. Pool-Wide Set Ratio
        const poolSetRatioDiff = compareRatios(
          safeRatio(a.setsFor, a.setsAgainst),
          safeRatio(b.setsFor, b.setsAgainst),
        );
        if (poolSetRatioDiff !== 0) return poolSetRatioDiff;

        // 4. Pool-Wide Point Ratio
        const poolPtRatioDiff = compareRatios(
          safeRatio(a.pointsFor, a.pointsAgainst),
          safeRatio(b.pointsFor, b.pointsAgainst),
        );
        if (poolPtRatioDiff !== 0) return poolPtRatioDiff;

        // 5. Pre-tournament Seeding -> Entry Order
        return compareSeeds(a.seed, b.seed, a.entryOrder, b.entryOrder);
      });

      result.push(...sortedThree);
    } else {
      // ── Four-or-More-Team Tie ─────────────────────────────────────
      // Skip mini-pool and go directly to pool-wide ratios, then seeding
      const sortedMulti = [...group].sort((a, b) => {
        const poolSetRatioDiff = compareRatios(
          safeRatio(a.setsFor, a.setsAgainst),
          safeRatio(b.setsFor, b.setsAgainst),
        );
        if (poolSetRatioDiff !== 0) return poolSetRatioDiff;

        const poolPtRatioDiff = compareRatios(
          safeRatio(a.pointsFor, a.pointsAgainst),
          safeRatio(b.pointsFor, b.pointsAgainst),
        );
        if (poolPtRatioDiff !== 0) return poolPtRatioDiff;

        return compareSeeds(a.seed, b.seed, a.entryOrder, b.entryOrder);
      });

      result.push(...sortedMulti);
    }
  }

  return result;
}
