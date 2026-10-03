// Who plays in the knockout, decided by what has already been played.
//
// The draw builds the knockout before a ball is hit, so its matches start out
// as *sources* rather than teams: "#1 Pool A" (a cross slot), "Winner of M14"
// (the halving tree) or "Loser of M21" (the 3rd-place play-off). This module
// is the one place those sources are turned into teams. It is pure — it reads
// a division's current state and answers which match sides should change —
// so the routes that write a result only have to apply its answer.
//
// It works from the whole division every time rather than from the one
// result that just landed. A corrected score, a cleared score and a fresh
// score are then the same question asked again, and asking it twice changes
// nothing.

import { assignPools } from './divisionMatches.ts';
import { isGroupFormat, isKnockoutFormat } from './roundFormat.ts';
import { buildPoolStandings, type PoolMatchInput } from './standings.ts';

export interface AdvanceCrossSlot {
  pool: string;
  rank: number;
}

export interface AdvanceMatch {
  id: string;
  teamAId: string | null;
  teamBId: string | null;
  winnerTeamId: string | null;
  status: string;
  scoreA: number[] | null;
  scoreB: number[] | null;
}

export interface AdvanceRound {
  sequence: number;
  format: string;
  /** In bracket order — `settings.draw.slots` — since the tree is positional. */
  matches: AdvanceMatch[];
}

export interface AdvanceDivision {
  drawConfig: {
    pools?: number;
    crossSlots?: Record<string, { a: AdvanceCrossSlot | null; b: AdvanceCrossSlot | null }>;
    loserFeeders?: Record<string, [string, string]>;
  } | null;
  /** Seed order, as everywhere pools are derived. */
  teams: { id: string; name: string; seed: number; status: string }[];
  rounds: AdvanceRound[];
}

export interface SideChange {
  matchId: string;
  side: 'a' | 'b';
  from: string | null;
  to: string | null;
  /** The match is a bye: the team named on it is also the one it advances. */
  bye?: true;
}

/* A side only moves while its match is still to be played. Once a match is
   live or has a result, the teams on it are the teams that played it —
   rewriting them would put a result under names that never earned it. */
function isOpen(m: AdvanceMatch): boolean {
  return m.status === 'upcoming' && !m.scoreA?.length && !m.scoreB?.length;
}

/* A bye drawn off pool play: one pool position against an empty seat, marked
   done from the start. It is never played, so naming the team that walks
   through it rewrites nothing — it is the same "#1 Pool A" becoming a name
   that every other knockout slot gets. */
function isCrossBye(m: AdvanceMatch, cross: { a: AdvanceCrossSlot | null; b: AdvanceCrossSlot | null } | undefined): boolean {
  return !!cross && (cross.a === null) !== (cross.b === null) &&
    m.status === 'done' && !m.scoreA?.length && !m.scoreB?.length;
}

/* A finished match's winner. A bye is finished before it starts and carries
   its one team through, whether or not the draw recorded it as the winner. */
function winnerOf(m: AdvanceMatch | undefined): string | null {
  if (!m || m.status !== 'done') return null;
  if (m.winnerTeamId) return m.winnerTeamId;
  if ((m.teamAId === null) !== (m.teamBId === null)) return m.teamAId ?? m.teamBId;
  return null;
}

function loserOf(m: AdvanceMatch | undefined): string | null {
  if (!m || m.status !== 'done' || !m.winnerTeamId || !m.teamAId || !m.teamBId) return null;
  return m.winnerTeamId === m.teamAId ? m.teamBId : m.teamAId;
}

/* Finishing positions per pool, for the pools whose every match is done. A
   pool with a match still to play has no positions yet — a #2 that could
   still become a #1 is not a #2. */
function decidedPoolPositions(div: AdvanceDivision): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const groupRounds = div.rounds.filter(r => isGroupFormat(r.format));
  if (groupRounds.length === 0) return out;

  const groupMatches = groupRounds.flatMap(r => r.matches);
  const toInput = (m: AdvanceMatch): PoolMatchInput => ({
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    status: m.status,
    winner: m.winnerTeamId && m.winnerTeamId === m.teamAId ? 'A'
      : m.winnerTeamId && m.winnerTeamId === m.teamBId ? 'B'
      : null,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
  });

  /* The same grouping and ranking the public standings table uses, so the
     team that lands in "#1 Pool A" is the one shown at the top of Pool A. */
  const standings = buildPoolStandings(
    {
      drawConfig: div.drawConfig,
      teamsList: div.teams,
      bracket: groupRounds.map(r => ({ format: r.format, matches: r.matches.map(toInput) })),
    },
    { assignPools, isGroupFormat },
  );

  for (const pool of standings) {
    const ids = new Set(pool.rows.map(r => r.teamId));
    const played = groupMatches.filter(m => m.teamAId && m.teamBId && ids.has(m.teamAId) && ids.has(m.teamBId));
    if (played.length === 0 || played.some(m => m.status !== 'done')) continue;
    out.set(pool.name, pool.rows.map(r => r.teamId));
  }
  return out;
}

/** Every knockout side whose team should differ from the one it holds now. */
export function planAdvancement(div: AdvanceDivision): SideChange[] {
  const crossSlots = div.drawConfig?.crossSlots ?? {};
  const loserFeeders = div.drawConfig?.loserFeeders ?? {};
  const positions = decidedPoolPositions(div);
  const byId = new Map(div.rounds.flatMap(r => r.matches).map(m => [m.id, m]));
  const rounds = [...div.rounds].sort((a, b) => a.sequence - b.sequence);

  const changes: SideChange[] = [];

  rounds.forEach((round, ri) => {
    if (!isKnockoutFormat(round.format)) return;
    const prev = ri > 0 ? rounds[ri - 1] : undefined;
    // Fed by the round before only when that round is itself knockout; the
    // pool round decides positions, which arrive through the cross slots.
    const feeder = prev && isKnockoutFormat(prev.format) ? prev : undefined;

    round.matches.forEach((m, mi) => {
      const bye = isCrossBye(m, crossSlots[m.id]);
      if (!isOpen(m) && !bye) return;

      (['a', 'b'] as const).forEach((side, si) => {
        // Each side has at most one source, tried in the order the draw
        // gives them precedence. No source at all — the opening round of a
        // plain knockout, whose teams the draw placed — is left alone.
        let source: (() => string | null) | null = null;

        const slot = crossSlots[m.id]?.[side];
        const losers = loserFeeders[m.id];
        if (slot) {
          source = () => positions.get(slot.pool)?.[slot.rank - 1] ?? null;
        } else if (losers) {
          source = () => loserOf(byId.get(losers[si]));
        } else if (feeder) {
          source = () => winnerOf(feeder.matches[2 * mi + si]);
        }
        if (!source) return;

        const to = source();
        const from = side === 'a' ? m.teamAId : m.teamBId;
        if (to !== from) changes.push(bye ? { matchId: m.id, side, from, to, bye } : { matchId: m.id, side, from, to });
      });
    });
  });

  return changes;
}
