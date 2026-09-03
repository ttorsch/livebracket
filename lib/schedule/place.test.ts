// Unit tests for the court-queue placement walk.
//
// Run with:  npm test
//
// Three of these are invariants rather than examples — no team in two places,
// no court double-booked, the same input twice gives the same schedule — and
// they are checked over every case the file builds, because they are the
// promises a published schedule makes. The rest are the design's own claims:
// half a division rests, divisions take the venue two at a time, and a
// non-gendered division never overlaps a gendered one.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { buildGraph } from './graph.ts';
import { buildGrid } from './grid.ts';
import { placeMatches, type Placement } from './place.ts';
import { normaliseConfig, type ScheduleConfig, type SchedulableDivision, type SchedulableMatch } from './types.ts';

/** A division drawn into `pools` pools of `size` teams, round robin only. */
function division(
  id: string,
  pools: number,
  size: number,
  patch: Partial<SchedulableDivision> = {},
): SchedulableDivision {
  const matches: SchedulableMatch[] = [];
  for (let p = 0; p < pools; p++) {
    const pool = String.fromCharCode(65 + p);
    const teams = Array.from({ length: size }, (_, t) => `${id}-${pool}${t + 1}`);
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matches.push({
          id: `${id}-${pool}-${i}${j}`,
          teamA: teams[i],
          teamB: teams[j],
          isPool: true,
          pool,
          durationMinutes: 20,
          roundIndex: 0,
        });
      }
    }
  }
  return { id, label: id, pools, netHeight: null, gender: null, matches, ...patch };
}

function run(divisions: SchedulableDivision[], courtCount: number, patch: Partial<ScheduleConfig> = {}) {
  const config = normaliseConfig({
    startTime: '09:00',
    endTime: '22:00',
    courtCount,
    blockMinutes: 20,
    lunchStart: '12:00',
    lunchEnd: '13:00',
    netBufferMinutes: 15,
    ...patch,
  });
  const grid = buildGrid(config, patch.courts ? 1 : 1, divisions.flatMap(d => d.matches.map(m => m.durationMinutes ?? 20)));
  const graph = buildGraph(divisions, grid.blockMinutes);
  return { result: placeMatches(graph, grid, config), graph };
}

/** No court hosts two matches at once. */
function assertNoCourtClash(placements: Placement[]) {
  const byCourt = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = `${p.day}:${p.courtIndex}`;
    (byCourt.get(key) ?? byCourt.set(key, []).get(key)!).push(p);
  }
  for (const [key, list] of byCourt) {
    list.sort((a, b) => a.startAbs - b.startAbs);
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i].startAbs >= list[i - 1].endAbs,
        `${key}: ${list[i].matchId} starts before ${list[i - 1].matchId} ends`,
      );
    }
  }
}

/** No team is in two places at once. */
function assertNoTeamClash(placements: Placement[], graph: ReturnType<typeof buildGraph>) {
  const byTeam = new Map<string, { s: number; e: number; id: string }[]>();
  for (const p of placements) {
    const node = graph.nodes.get(p.matchId)!;
    for (const team of [node.teamA, node.teamB]) {
      if (!team) continue;
      const list = byTeam.get(team) ?? [];
      list.push({ s: p.startAbs, e: p.endAbs, id: p.matchId });
      byTeam.set(team, list);
    }
  }
  for (const [team, list] of byTeam) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].s >= list[i - 1].e, `${team}: ${list[i].id} overlaps ${list[i - 1].id}`);
    }
  }
}

/** Matches a team played with no gap at all. */
function backToBack(placements: Placement[], graph: ReturnType<typeof buildGraph>): number {
  const last = new Map<string, number>();
  let count = 0;
  for (const p of [...placements].sort((a, b) => a.startAbs - b.startAbs)) {
    const node = graph.nodes.get(p.matchId)!;
    for (const team of [node.teamA, node.teamB]) {
      if (!team) continue;
      if (last.get(team) === p.startAbs) count++;
      last.set(team, p.endAbs);
    }
  }
  return count;
}

describe('placeMatches', () => {
  it('places every match of a division sized to its appetite', () => {
    const men = division('men', 4, 4);
    const { result, graph } = run([men], 4);
    assert.equal(result.unplaced.length, 0);
    assert.equal(result.placements.length, men.matches.length);
    assertNoCourtClash(result.placements);
    assertNoTeamClash(result.placements, graph);
  });

  it('rests half the division when the venue matches its appetite', () => {
    const { result, graph } = run([division('men', 4, 4)], 4);
    assert.equal(backToBack(result.placements, graph), 0);
  });

  it('puts whole pools on court together and alternates the groups', () => {
    // Dealing one match per pool across the courts looks fairer and is not:
    // once a pool of four has played AB and CD every match it has left pairs
    // one of A,B with one of C,D, so the next row has to reuse whoever just
    // played. Four pools of four on four courts: one-per-pool gives 8
    // back-to-back matches, this gives 0, and both take six rows.
    const { result, graph } = run([division('men', 4, 4)], 4);
    const rows = new Map<number, Set<string>>();
    for (const p of result.placements) {
      const pool = graph.nodes.get(p.matchId)!.pool!;
      (rows.get(p.startAbs) ?? rows.set(p.startAbs, new Set()).get(p.startAbs)!).add(pool);
    }
    for (const [start, pools] of rows) {
      assert.equal(pools.size, 2, `row at ${start} should hold two whole pools, held ${[...pools]}`);
    }
    assert.equal(backToBack(result.placements, graph), 0);
  });

  it('runs two divisions in parallel on their own blocks', () => {
    const men = division('men', 4, 4, { netHeight: '2.43m', gender: 'Men' });
    const women = division('women', 3, 4, { netHeight: '2.24m', gender: 'Women' });
    const { result, graph } = run([men, women], 7);

    assert.equal(result.unplaced.length, 0);
    assertNoCourtClash(result.placements);
    assertNoTeamClash(result.placements, graph);

    // Men's four pools pair evenly onto four courts and never play back to
    // back. Women's three pools cannot: an odd pool count leaves one pool
    // sharing a court group with half of another.
    const menB2B = backToBack(
      result.placements.filter(p => graph.nodes.get(p.matchId)!.divisionId === 'men'),
      graph,
    );
    assert.equal(menB2B, 0);

    // Each division's pool play sits on a contiguous block of its own.
    const courtsOf = (id: string) =>
      [...new Set(result.placements
        .filter(p => graph.nodes.get(p.matchId)!.divisionId === id)
        .map(p => p.courtIndex))].sort((a, b) => a - b);
    assert.deepEqual(courtsOf('men'), [0, 1, 2, 3]);
    assert.deepEqual(courtsOf('women'), [4, 5, 6]);
  });

  it('keeps a non-gendered round robin off court until the gendered ones finish', () => {
    // Roster overlap: a Mixed team's players come from the gendered draws, and
    // the solver cannot see that they are the same people, so the round robins
    // never run together.
    //
    // It is *round robins* the queue separates, not whole divisions. Holding a
    // queue slot until a division was entirely finished deadlocked the event —
    // the play-off for 3rd waits on every division's semifinals, and the last
    // division could never reach its semifinals — so a division leaves the
    // queue when its pools are done and its knockout competes for free courts
    // like anything else. A knockout has four of eight teams playing where a
    // round robin has all of them, so the exposure is much smaller.
    const men = division('men', 2, 4, { gender: 'Men' });
    const women = division('women', 2, 4, { gender: 'Women' });
    const mixed = division('mixed', 2, 4, { gender: 'Mixed' });
    const { result, graph } = run([men, women, mixed], 8);

    assert.equal(result.unplaced.length, 0);
    const poolsOf = (test: (id: string) => boolean) =>
      result.placements.filter(p => {
        const node = graph.nodes.get(p.matchId)!;
        return node.isPool && test(node.divisionId);
      });

    const genderedEnd = Math.max(...poolsOf(id => id !== 'mixed').map(p => p.endAbs));
    const mixedStart = Math.min(...poolsOf(id => id === 'mixed').map(p => p.startAbs));
    assert.ok(
      mixedStart >= genderedEnd,
      `mixed pools started at ${mixedStart}, gendered pools ran to ${genderedEnd}`,
    );
  });

  it('finishes every round robin before any medal round', () => {
    // The round is read across the whole event, not within a division, so no
    // division races a stage ahead of the field. The opening round of a
    // bracket is the exception, and deliberately so: it is what fills the
    // courts a round robin cannot use, since a division's appetite is only
    // half its field.
    const men = division('men', 2, 4, { gender: 'Men' });
    const women = division('women', 2, 4, { gender: 'Women' });
    const mixed = division('mixed', 2, 4, { gender: 'Mixed' });
    const knockout = (id: string) =>
      Array.from({ length: 2 }, (_, i) => ({
        id: `${id}-k${i}`,
        teamA: null,
        teamB: null,
        isPool: false,
        roundIndex: 1,
        durationMinutes: 20,
      }));
    const withBracket = [men, women, mixed].map(d => ({ ...d, matches: [...d.matches, ...knockout(d.id)] }));

    const { result, graph } = run(withBracket, 8);
    assert.equal(result.unplaced.length, 0);

    const lastPool = Math.max(
      ...result.placements.filter(p => graph.nodes.get(p.matchId)!.isPool).map(p => p.endAbs),
    );
    const firstBracket = Math.min(
      ...result.placements.filter(p => !graph.nodes.get(p.matchId)!.isPool).map(p => p.startAbs),
    );
    assert.ok(
      firstBracket >= lastPool,
      `a bracket opened at ${firstBracket} while a round robin ran to ${lastPool}`,
    );
  });

  it('gives the same answer twice', () => {
    const build = () => run([division('men', 4, 4), division('women', 3, 4)], 7).result.placements;
    assert.deepEqual(build(), build());
  });

  it('never double-books a court or a team, at any venue size', () => {
    // From two courts up the venue genuinely holds this event; one court does
    // not, and overflow there is the honest answer rather than a failure.
    for (const courts of [2, 3, 4, 5, 6, 7, 8, 12]) {
      const { result, graph } = run([division('men', 4, 4), division('women', 3, 4)], courts);
      assertNoCourtClash(result.placements);
      assertNoTeamClash(result.placements, graph);
      assert.equal(result.unplaced.length, 0, `${courts} courts: ${result.unplaced.length} unplaced`);
    }
  });

  it('reports overflow rather than inventing court time', () => {
    // 42 matches of 20 minutes is 840 court-minutes; one court offers 720.
    const { result } = run([division('men', 4, 4), division('women', 3, 4)], 1);
    assert.equal(result.unplaced.length, 6);
    assert.equal(result.placements.length, 36);
  });

  it('never starts a match inside lunch', () => {
    const { result } = run([division('men', 4, 4)], 4, { endTime: '18:00' });
    for (const p of result.placements) {
      const start = p.startAbs - p.day * 1440;
      assert.ok(!(start >= 12 * 60 && start < 13 * 60), `${p.matchId} starts inside lunch`);
    }
  });

  it('does not run a match more than a fifth of its length past the day', () => {
    const { result } = run([division('men', 4, 4)], 2, { endTime: '13:30' });
    for (const p of result.placements) {
      const end = p.endAbs - p.day * 1440;
      assert.ok(end <= 13 * 60 + 30 + 4, `${p.matchId} ends at ${end}, past 13:30 + tolerance`);
    }
  });
});
