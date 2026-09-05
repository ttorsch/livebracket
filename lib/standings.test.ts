import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePoolStandings, safeRatio, compareSeeds } from './standings.ts';

describe('safeRatio & compareSeeds', () => {
  it('handles division by zero in safeRatio', () => {
    assert.equal(safeRatio(2, 0), Infinity);
    assert.equal(safeRatio(0, 0), 0);
    assert.equal(safeRatio(4, 2), 2);
  });

  it('compares seeds correctly (lower seed number is higher seed)', () => {
    // Seed 1 beats Seed 2
    assert.ok(compareSeeds(1, 2, 0, 1) < 0);
    // Seeded team beats unseeded team (seed 0)
    assert.ok(compareSeeds(2, 0, 1, 0) < 0);
    assert.ok(compareSeeds(0, 2, 0, 1) > 0);
    // Both unseeded fall back to entry order
    assert.ok(compareSeeds(0, 0, 0, 1) < 0);
    assert.ok(compareSeeds(0, 0, 1, 0) > 0);
  });
});

describe('calculatePoolStandings - Point System & Forfeit', () => {
  it('awards 2 points for win, 1 point for completed loss, 0 points for forfeit', () => {
    const teams = [
      { id: 't1', name: 'Team 1', seed: 1 },
      { id: 't2', name: 'Team 2', seed: 2 },
      { id: 't3', name: 'Team 3', seed: 3 },
    ];
    const matches = [
      // Normal completed match: t1 beats t2 (21-18, 21-19)
      {
        teamAId: 't1',
        teamBId: 't2',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [18, 19],
      },
      // Forfeit match: t1 beats t3 by forfeit (21-0, 21-0)
      {
        teamAId: 't1',
        teamBId: 't3',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [0, 0],
      },
    ];

    const standings = calculatePoolStandings(teams, matches);
    const r1 = standings.find(s => s.teamId === 't1')!;
    const r2 = standings.find(s => s.teamId === 't2')!;
    const r3 = standings.find(s => s.teamId === 't3')!;

    // t1 has 2 wins = 4 pts
    assert.equal(r1.wins, 2);
    assert.equal(r1.points, 4);

    // t2 has 1 completed loss = 1 pt
    assert.equal(r2.losses, 1);
    assert.equal(r2.byes, 0);
    assert.equal(r2.points, 1);

    // t3 has 1 forfeit loss = 0 pts
    assert.equal(r3.losses, 0);
    assert.equal(r3.byes, 1);
    assert.equal(r3.points, 0);

    assert.deepEqual(standings.map(s => s.teamId), ['t1', 't2', 't3']);
  });
});

describe('calculatePoolStandings - Two-Team Tie (Head-to-Head)', () => {
  it('breaks a two-team tie using head-to-head winner, even if point differential is lower', () => {
    const teams = [
      { id: 'tA', name: 'Team A', seed: 1 },
      { id: 'tB', name: 'Team B', seed: 2 },
      { id: 'tC', name: 'Team C', seed: 3 },
    ];
    const matches = [
      // Team A beats Team C heavily
      {
        teamAId: 'tA',
        teamBId: 'tC',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [5, 5],
      },
      // Team B beats Team C closely
      {
        teamAId: 'tB',
        teamBId: 'tC',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [19, 19],
      },
      // Direct match: Team B beats Team A
      {
        teamAId: 'tA',
        teamBId: 'tB',
        status: 'done',
        winner: 'B' as const,
        scoreA: [19, 19],
        scoreB: [21, 21],
      },
    ];

    // Both tA and tB have: 1 win, 1 loss (against each other and tC)
    // tA has better point diff (+28) than tB (+6), BUT tB won direct match!
    const standings = calculatePoolStandings(teams, matches);
    const topTwo = standings.slice(0, 2).map(s => s.teamId);
    assert.deepEqual(topTwo, ['tB', 'tA']);
  });
});

describe('calculatePoolStandings - Three-Team Tie', () => {
  it('breaks three-team circular tie by Set Ratio among the tied teams', () => {
    const teams = [
      { id: 'tA', name: 'Team A', seed: 1 },
      { id: 'tB', name: 'Team B', seed: 2 },
      { id: 'tC', name: 'Team C', seed: 3 },
    ];
    const matches = [
      // A beats B 2–0
      {
        teamAId: 'tA',
        teamBId: 'tB',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [18, 18],
      },
      // B beats C 2–0
      {
        teamAId: 'tB',
        teamBId: 'tC',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [18, 18],
      },
      // C beats A 2–1 (C dropped a set)
      {
        teamAId: 'tC',
        teamBId: 'tA',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 19, 15],
        scoreB: [18, 21, 13],
      },
    ];

    // Tied teams sets:
    // A: 2 (vs B) + 1 (vs C) = 3 won; 0 (vs B) + 2 (vs C) = 2 lost. Ratio = 3/2 = 1.5
    // B: 2 (vs C) = 2 won; 2 (vs A) = 2 lost. Ratio = 2/2 = 1.0
    // C: 2 (vs A) = 2 won; 1 (vs A) + 2 (vs B) = 3 lost. Ratio = 2/3 = 0.667
    const standings = calculatePoolStandings(teams, matches);
    assert.deepEqual(standings.map(s => s.teamId), ['tA', 'tB', 'tC']);
  });

  it('breaks three-team circular tie with identical set ratios using Point Ratio', () => {
    const teams = [
      { id: 'tA', name: 'Team A', seed: 1 },
      { id: 'tB', name: 'Team B', seed: 2 },
      { id: 'tC', name: 'Team C', seed: 3 },
    ];
    const matches = [
      // All 2-0 so set ratio is 2/2 = 1.0 for all 3
      // A beats B 21-10, 21-10 (A scores 42, B scores 20)
      {
        teamAId: 'tA',
        teamBId: 'tB',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [10, 10],
      },
      // B beats C 21-18, 21-18 (B scores 42, C scores 36)
      {
        teamAId: 'tB',
        teamBId: 'tC',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [18, 18],
      },
      // C beats A 21-15, 21-15 (C scores 42, A scores 30)
      {
        teamAId: 'tC',
        teamBId: 'tA',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [15, 15],
      },
    ];

    // Points won/lost among tied teams:
    // A: won = 42 + 30 = 72; lost = 20 + 42 = 62. Ratio = 72/62 = 1.161
    // B: won = 20 + 42 = 62; lost = 42 + 36 = 78. Ratio = 62/78 = 0.795
    // C: won = 36 + 42 = 78; lost = 42 + 30 = 72. Ratio = 78/72 = 1.083
    // Order should be A (1.161) > C (1.083) > B (0.795)
    const standings = calculatePoolStandings(teams, matches);
    assert.deepEqual(standings.map(s => s.teamId), ['tA', 'tC', 'tB']);
  });

  it('breaks three-team tie with identical set and point ratios using pre-tournament seeding', () => {
    const teams = [
      { id: 'tA', name: 'Team A', seed: 3 },
      { id: 'tB', name: 'Team B', seed: 1 },
      { id: 'tC', name: 'Team C', seed: 2 },
    ];
    const matches = [
      // Symmetric 21-15, 21-15 scores in circular triangle:
      {
        teamAId: 'tA',
        teamBId: 'tB',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [15, 15],
      },
      {
        teamAId: 'tB',
        teamBId: 'tC',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [15, 15],
      },
      {
        teamAId: 'tC',
        teamBId: 'tA',
        status: 'done',
        winner: 'A' as const,
        scoreA: [21, 21],
        scoreB: [15, 15],
      },
    ];

    // All set ratios = 1.0, all point ratios = 72/72 = 1.0
    // Resolves by Seeding: Seed 1 (tB) > Seed 2 (tC) > Seed 3 (tA)
    const standings = calculatePoolStandings(teams, matches);
    assert.deepEqual(standings.map(s => s.teamId), ['tB', 'tC', 'tA']);
  });
});

describe('calculatePoolStandings - Pool-Wide Fallback & 4-Team Ties', () => {
  it('uses pool-wide ratios when three-team mini ratios are identical but matches against 4th team differ', () => {
    const teams = [
      { id: 'tA', name: 'Team A', seed: 1 },
      { id: 'tB', name: 'Team B', seed: 2 },
      { id: 'tC', name: 'Team C', seed: 3 },
      { id: 'tD', name: 'Team D', seed: 4 },
    ];
    // Between A, B, C: symmetric circular 2-0 with 21-15, 21-15
    // Against D:
    // A beats D 21-5, 21-5 (A drops 10 pts)
    // B beats D 21-19, 21-19 (B drops 38 pts)
    // C beats D 21-10, 21-10 (C drops 20 pts)
    const matches = [
      { teamAId: 'tA', teamBId: 'tB', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [15, 15] },
      { teamAId: 'tB', teamBId: 'tC', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [15, 15] },
      { teamAId: 'tC', teamBId: 'tA', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [15, 15] },
      { teamAId: 'tA', teamBId: 'tD', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [5, 5] },
      { teamAId: 'tB', teamBId: 'tD', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [19, 19] },
      { teamAId: 'tC', teamBId: 'tD', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [10, 10] },
    ];

    // Teams A, B, C all have 2 wins, 1 loss (5 pts each)
    // Mini-ratios among A, B, C are identical.
    // Pool-wide set ratios are all 4/2 = 2.0.
    // Pool-wide point ratios:
    // A: (42+30+42) / (30+42+10) = 114 / 82 = 1.390
    // C: (30+42+42) / (42+30+20) = 114 / 92 = 1.239
    // B: (42+30+42) / (30+42+38) = 114 / 110 = 1.036
    const standings = calculatePoolStandings(teams, matches);
    const topThree = standings.slice(0, 3).map(s => s.teamId);
    assert.deepEqual(topThree, ['tA', 'tC', 'tB']);
  });

  it('handles 4-team tie directly with pool-wide ratios and seeding', () => {
    const teams = [
      { id: 't1', name: 'Team 1', seed: 4 },
      { id: 't2', name: 'Team 2', seed: 3 },
      { id: 't3', name: 'Team 3', seed: 2 },
      { id: 't4', name: 'Team 4', seed: 1 },
    ];
    // Circular 4-way tie where each beats one team
    const matches = [
      { teamAId: 't1', teamBId: 't2', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [10, 10] },
      { teamAId: 't2', teamBId: 't3', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [15, 15] },
      { teamAId: 't3', teamBId: 't4', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [15, 15] },
      { teamAId: 't4', teamBId: 't1', status: 'done', winner: 'A' as const, scoreA: [21, 21], scoreB: [15, 15] },
    ];

    const standings = calculatePoolStandings(teams, matches);
    // All 4 teams have 1 win, 1 loss.
    // t1 has best point ratio due to 21-10, 21-10 win
    assert.equal(standings[0].teamId, 't1');
  });
});
