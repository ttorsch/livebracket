import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planAdvancement, type AdvanceDivision, type AdvanceMatch, type SideChange } from './advancement.ts';

function match(id: string, over: Partial<AdvanceMatch> = {}): AdvanceMatch {
  return { id, teamAId: null, teamBId: null, winnerTeamId: null, status: 'upcoming', scoreA: null, scoreB: null, ...over };
}

function played(id: string, a: string, b: string, winner: 'a' | 'b'): AdvanceMatch {
  return match(id, {
    teamAId: a, teamBId: b, status: 'done',
    winnerTeamId: winner === 'a' ? a : b,
    scoreA: winner === 'a' ? [21, 21] : [15, 15],
    scoreB: winner === 'a' ? [15, 15] : [21, 21],
  });
}

const teams = ['t1', 't2', 't3', 't4'].map((id, i) => ({ id, name: id, seed: i + 1, status: 'confirmed' }));

/* Four teams in two pools — serpentine by seed, so A = t1,t4 and B = t2,t3 —
   then semifinals drawn A1–B2 and B1–A2, a final and a play-off for 3rd. */
function pooled(over: { pool?: AdvanceMatch[]; semis?: AdvanceMatch[]; final?: AdvanceMatch; third?: AdvanceMatch } = {}): AdvanceDivision {
  return {
    drawConfig: {
      pools: 2,
      crossSlots: {
        s1: { a: { pool: 'A', rank: 1 }, b: { pool: 'B', rank: 2 } },
        s2: { a: { pool: 'B', rank: 1 }, b: { pool: 'A', rank: 2 } },
      },
      loserFeeders: { p3: ['s1', 's2'] },
    },
    teams,
    rounds: [
      { sequence: 1, format: 'round-robin', matches: over.pool ?? [played('pa', 't1', 't4', 'b'), played('pb', 't2', 't3', 'a')] },
      { sequence: 2, format: 'single', matches: over.semis ?? [match('s1'), match('s2')] },
      { sequence: 3, format: 'single', matches: [over.final ?? match('f')] },
      { sequence: 4, format: 'single', matches: [over.third ?? match('p3')] },
    ],
  };
}

function apply(div: AdvanceDivision, changes: SideChange[]): AdvanceDivision {
  const byId = new Map(changes.map(c => [`${c.matchId}:${c.side}`, c.to]));
  return {
    ...div,
    rounds: div.rounds.map(r => ({
      ...r,
      matches: r.matches.map(m => ({
        ...m,
        teamAId: byId.has(`${m.id}:a`) ? byId.get(`${m.id}:a`)! : m.teamAId,
        teamBId: byId.has(`${m.id}:b`) ? byId.get(`${m.id}:b`)! : m.teamBId,
      })),
    })),
  };
}

describe('planAdvancement — pool positions into the crossing', () => {
  it('fills every cross slot once both pools are finished', () => {
    const changes = planAdvancement(pooled());
    assert.deepEqual(changes, [
      { matchId: 's1', side: 'a', from: null, to: 't4' },
      { matchId: 's1', side: 'b', from: null, to: 't3' },
      { matchId: 's2', side: 'a', from: null, to: 't2' },
      { matchId: 's2', side: 'b', from: null, to: 't1' },
    ]);
  });

  it('fills a finished pool’s slots while the other pool is still playing', () => {
    const changes = planAdvancement(pooled({
      pool: [played('pa', 't1', 't4', 'b'), match('pb', { teamAId: 't2', teamBId: 't3' })],
    }));
    assert.deepEqual(changes, [
      { matchId: 's1', side: 'a', from: null, to: 't4' },
      { matchId: 's2', side: 'b', from: null, to: 't1' },
    ]);
  });

  it('takes positions back off when a pool result is cleared', () => {
    const div = pooled({
      pool: [match('pa', { teamAId: 't1', teamBId: 't4' }), played('pb', 't2', 't3', 'a')],
      semis: [match('s1', { teamAId: 't4', teamBId: 't3' }), match('s2', { teamAId: 't2', teamBId: 't1' })],
    });
    assert.deepEqual(planAdvancement(div), [
      { matchId: 's1', side: 'a', from: 't4', to: null },
      { matchId: 's2', side: 'b', from: 't1', to: null },
    ]);
  });
});

describe('planAdvancement — knockout results', () => {
  const semisPlayed = [played('s1', 't4', 't3', 'a'), played('s2', 't2', 't1', 'b')];

  it('sends winners on by bracket position and losers to the play-off for 3rd', () => {
    const changes = planAdvancement(pooled({ semis: semisPlayed }));
    assert.deepEqual(changes, [
      { matchId: 'f', side: 'a', from: null, to: 't4' },
      { matchId: 'f', side: 'b', from: null, to: 't1' },
      { matchId: 'p3', side: 'a', from: null, to: 't3' },
      { matchId: 'p3', side: 'b', from: null, to: 't2' },
    ]);
  });

  it('is settled once applied — planning again moves nothing', () => {
    const div = pooled({ semis: semisPlayed });
    const once = apply(div, planAdvancement(div));
    assert.deepEqual(planAdvancement(once), []);
  });

  it('follows a corrected result into a match that has not been played', () => {
    const div = pooled({
      semis: [played('s1', 't4', 't3', 'b'), played('s2', 't2', 't1', 'b')],
      final: match('f', { teamAId: 't4', teamBId: 't1' }),
      third: match('p3', { teamAId: 't3', teamBId: 't2' }),
    });
    assert.deepEqual(planAdvancement(div), [
      { matchId: 'f', side: 'a', from: 't4', to: 't3' },
      { matchId: 'p3', side: 'a', from: 't3', to: 't4' },
    ]);
  });

  it('never rewrites a match that is live or already played', () => {
    const div = pooled({
      semis: [played('s1', 't4', 't3', 'b'), played('s2', 't2', 't1', 'b')],
      final: match('f', { teamAId: 't4', teamBId: 't1', status: 'live' }),
      third: played('p3', 't3', 't2', 'a'),
    });
    assert.deepEqual(planAdvancement(div), []);
  });
});

describe('planAdvancement — byes', () => {
  it('reads a crossing bye’s walk-through off its cross slot, and the other side off the match that feeds it', () => {
    // Six teams, two pools of three, top three through: the two pool winners
    // sit out the quarterfinals and wait in the semifinals.
    const six = ['a1', 'b1', 'b2', 'a2', 'a3', 'b3'].map((id, i) => ({ id, name: id, seed: i + 1, status: 'confirmed' }));
    const div: AdvanceDivision = {
      drawConfig: {
        pools: 2,
        crossSlots: {
          q1: { a: { pool: 'A', rank: 1 }, b: null },
          q2: { a: { pool: 'B', rank: 2 }, b: { pool: 'A', rank: 3 } },
          s1: { a: { pool: 'A', rank: 1 }, b: null },
        },
      },
      teams: six,
      rounds: [
        {
          sequence: 1, format: 'round-robin', matches: [
            played('pa1', 'a1', 'a2', 'a'), played('pa2', 'a1', 'a3', 'a'), played('pa3', 'a2', 'a3', 'a'),
            played('pb1', 'b1', 'b2', 'a'), played('pb2', 'b1', 'b3', 'a'), played('pb3', 'b2', 'b3', 'a'),
          ],
        },
        { sequence: 2, format: 'single', matches: [match('q1', { status: 'done' }), played('q2', 'b2', 'a3', 'b')] },
        { sequence: 3, format: 'single', matches: [match('s1')] },
      ],
    };
    assert.deepEqual(planAdvancement(div), [
      { matchId: 'q1', side: 'a', from: null, to: 'a1', bye: true },
      { matchId: 's1', side: 'a', from: null, to: 'a1' },
      { matchId: 's1', side: 'b', from: null, to: 'a3' },
    ]);
  });

  it('leaves a plain knockout’s drawn opening round alone and carries a bye through', () => {
    const div: AdvanceDivision = {
      drawConfig: { pools: 1 },
      teams,
      rounds: [
        {
          sequence: 1, format: 'single', matches: [
            match('r1', { teamAId: 't1', status: 'done', winnerTeamId: 't1' }),
            match('r2', { teamAId: 't2', teamBId: 't3' }),
          ],
        },
        { sequence: 2, format: 'single', matches: [match('f', { teamAId: 't1' })] },
      ],
    };
    assert.deepEqual(planAdvancement(div), []);
  });
});
