// Unit tests for the provisional draw.
//
// Run with:  npm test
//
// The thing under test is that the shape is *derived*, never invented. A
// provisional schedule is shown to players before anyone has registered, so
// a match count that does not match what the real draw later builds is a
// promise the tournament cannot keep.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { DetailDivision, ConfiguredRound } from './data.ts';
import {
  recommendedPools, plannedPools, plannedThirdPlace, roundRobinRounds, roundRobinPairs,
  bracketSeedOrder,
  provisionalDivision, isUndrawn,
} from './provisionalDraw.ts';
import { labelDivisionMatches } from './divisionMatches.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

const scoring = { setsBestOf: 3, pointsPerSet: 21, winBy2: true, hardCap: 0, decidingSetPoints: 15 };
const round = (format: string, durationMinutes = 30): ConfiguredRound => ({ format, scoring, durationMinutes });

function division(patch: Partial<DetailDivision> = {}): DetailDivision {
  return {
    id: 'd1',
    label: "Women's Open",
    teams: 16,
    filled: 0,
    teamsList: [],
    bracket: [],
    drawConfig: null,
    netHeight: '2.24m',
    gender: 'Women',
    ageLimit: '',
    registrationOpens: '',
    registrationCloses: '',
    configuredRounds: [round('round-robin'), round('single', 45)],
    advancePerPool: 2,
    crossing: 'fivb',
    plannedPools: 4,
    plannedThirdPlace: true,
    registrationFee: 1500,
    currency: 'THB',
    formatTypeOnSand: '2v2',
    rosterSize: 2,
    regFields: [],
    waitlistCap: 0,
    rules: '',
    prizes: { placings: [], note: '' },
    confirmationMessage: '',
    ...patch,
  };
}

const countMatches = (d: DetailDivision) =>
  d.bracket.reduce((n, r) => n + r.matches.length, 0);

// ── Pool count ────────────────────────────────────────────────────────────

describe('recommendedPools', () => {
  it('aims for four teams a pool', () => {
    assert.equal(recommendedPools(16), 4);
    assert.equal(recommendedPools(24), 6);
    assert.equal(recommendedPools(12), 3);
  });

  it('stays inside the range the draw screen offers', () => {
    // A recommendation the organizer cannot pick is not a recommendation.
    assert.equal(recommendedPools(2), 2);
    assert.equal(recommendedPools(0), 2);
    assert.equal(recommendedPools(64), 8);
  });
});

describe('plannedPools', () => {
  it('prefers what the organizer declared', () => {
    assert.equal(plannedPools({ pools: 6 }, 16), 6);
  });

  it('falls back to the recommendation for a division saved before the field existed', () => {
    assert.equal(plannedPools({}, 16), 4);
    assert.equal(plannedPools({ pools: 'lots' }, 16), 4);
  });

  it('clamps a hand-made value into range', () => {
    assert.equal(plannedPools({ pools: 99 }, 16), 8);
    assert.equal(plannedPools({ pools: 0 }, 16), 2);
  });
});

describe('plannedThirdPlace', () => {
  it('prefers what the organizer planned', () => {
    assert.equal(plannedThirdPlace({ thirdPlace: false }), false);
    assert.equal(plannedThirdPlace({ thirdPlace: true }), true);
  });

  it('falls back to what a draw actually ran with', () => {
    // A division drawn before the generator asked the question keeps the
    // answer the draw screen already recorded for it.
    assert.equal(plannedThirdPlace({ draw: { thirdPlace: false } }), false);
  });

  it('lets the plan override an older draw setting', () => {
    assert.equal(plannedThirdPlace({ thirdPlace: true, draw: { thirdPlace: false } }), true);
  });

  it('defaults to playing one, as the draw route does', () => {
    assert.equal(plannedThirdPlace({}), true);
    assert.equal(plannedThirdPlace({ draw: null }), true);
  });
});

// ── Round robin ───────────────────────────────────────────────────────────

describe('roundRobinRounds', () => {
  it('plays every pairing exactly once', () => {
    const pairs = roundRobinPairs(4);
    assert.equal(pairs.length, 6); // C(4,2)
    const seen = new Set(pairs.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
    assert.equal(seen.size, 6);
  });

  it('gives each team at most one match per matchday', () => {
    for (const n of [4, 5, 6, 7]) {
      for (const day of roundRobinRounds(n)) {
        const played = day.flat();
        assert.equal(new Set(played).size, played.length, `n=${n}`);
      }
    }
  });

  it('drops the bye in an odd pool rather than scheduling it', () => {
    const pairs = roundRobinPairs(5);
    assert.equal(pairs.length, 10); // C(5,2)
    assert.ok(pairs.every(([a, b]) => a >= 0 && b >= 0));
  });

  it('has nothing to play below two teams', () => {
    assert.deepEqual(roundRobinRounds(1), []);
    assert.deepEqual(roundRobinRounds(0), []);
  });
});

// ── The derived division ──────────────────────────────────────────────────

describe('provisionalDivision', () => {
  it('derives the match count from cap, pools and advance', () => {
    const d = provisionalDivision(division(), { pools: 4 });
    // 4 pools of 4 => 4 x C(4,2) = 24 pool matches.
    assert.equal(d.bracket[0].matches.length, 24);
    // 4 pools advancing 2 => 8 qualifiers => QF 4 + SF 2 + F 1, plus 3rd.
    assert.equal(countMatches(d) - 24, 8);
  });

  it('names knockout stages by the field still standing, as the draw does', () => {
    // A plan shown before the bracket exists has to read like the bracket it
    // predicts. It used to number them "Round 2", "Round 3" while the real
    // draw called the same stages Quarterfinals and Semifinals.
    const names = (cap: number, pools: number) =>
      provisionalDivision(division({ teams: cap }), { pools }).bracket.map(r => r.round);

    assert.deepEqual(names(8, 2), ['Round 1', 'Semifinals', 'Final', '3rd Place']);
    assert.deepEqual(names(16, 4), ['Round 1', 'Quarterfinals', 'Semifinals', 'Final', '3rd Place']);
    assert.deepEqual(
      names(32, 8),
      ['Round 1', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final', '3rd Place'],
    );
  });

  it('numbers placeholder teams within their pool, not globally', () => {
    // "Team 1" must mean the first team in *this* pool. A global seed number
    // is not something a player can find themselves in before the draw.
    const d = provisionalDivision(division(), { pools: 4 });
    const names = new Set(d.teamsList.map(t => t.name));
    assert.deepEqual([...names].sort(), ['Team 1', 'Team 2', 'Team 3', 'Team 4']);
  });

  it('labels the first knockout round by pool position', () => {
    const d = provisionalDivision(division(), { pools: 4 });
    const labels = labelDivisionMatches(d);
    const firstKo = d.bracket[1].matches[0];
    const label = labels.get(firstKo.id);
    assert.match(label?.teamA ?? '', /^#\d+ Pool [A-D]$/);
    assert.match(label?.teamB ?? '', /^#\d+ Pool [A-D]$/);
  });

  it('drops the 3rd-place play-off when the organizer does not want one', () => {
    const withIt = provisionalDivision(division(), { pools: 4 });
    const without = provisionalDivision(division(), { pools: 4, thirdPlace: false });
    assert.equal(countMatches(withIt) - countMatches(without), 1);
    assert.ok(!without.bracket.some(r => r.round === '3rd Place'));
  });

  it('never points a visible match at a match the schedule hides', () => {
    /* The invariant this file exists to hold. A bye is settled before it
       starts, so nothing schedules it and no one can look it up — a label
       that says "Winner of M13" when M13 is a bye is a reference into thin
       air. Checked across every field size, because whether there are byes
       at all depends on how the qualifier count sits against the bracket. */
    for (const [teams, pools, advance] of [
      [12, 4, 3], [16, 4, 2], [12, 4, 2], [24, 6, 3], [10, 2, 3], [8, 2, 2],
    ] as [number, number, number][]) {
      const d = provisionalDivision(division({ teams, advancePerPool: advance }), { pools });
      const labels = labelDivisionMatches(d);

      const hidden = new Set<string>();
      for (const label of labels.values()) if (label.bye) hidden.add(label.no);

      for (const label of labels.values()) {
        if (label.bye) continue;
        for (const side of [label.teamA, label.teamB]) {
          const ref = /^(?:Winner|Loser) of (.+)$/.exec(side)?.[1];
          assert.ok(
            !ref || !hidden.has(ref),
            `${teams}/${pools}/${advance}: a visible match points at hidden ${ref} (${side})`,
          );
        }
      }
    }
  });

  it('names the qualifier that walked through a bye', () => {
    /* 4 pools advancing 3 is 12 into a bracket of 16 — four byes, taken by
       the pool winners. The round above each bye must name the qualifier
       that walked through it, and meet it against a match anyone can find. */
    const d = provisionalDivision(division({ teams: 12, advancePerPool: 3 }), { pools: 4 });
    const labels = labelDivisionMatches(d);
    const quarterFinals = d.bracket[2].matches.map(m => labels.get(m.id));

    for (const qf of quarterFinals) {
      assert.match(qf?.teamA ?? '', /^#1 Pool [A-D]$/);
      assert.match(qf?.teamB ?? '', /^Winner of /);
    }
  });

  it('keeps the top qualifiers apart until they have to meet', () => {
    /* Seeds laid out in plain order pair correctly for the opening round but
       put seeds 1 and 2 in adjacent matches — which feed the same match next
       round, so the two pool winners met in the quarter-final. */
    const d = provisionalDivision(division({ teams: 16, advancePerPool: 2 }), { pools: 4 });
    const labels = labelDivisionMatches(d);
    const opening = d.bracket[1].matches.map(m => labels.get(m.id));

    // #1 Pool A and #1 Pool B are the top two qualifiers; they must not be in
    // adjacent matches, because adjacent matches feed the same one.
    const seatOf = (name: string) => opening.findIndex(l => l?.teamA === name || l?.teamB === name);
    const a = seatOf('#1 Pool A');
    const b = seatOf('#1 Pool B');
    assert.ok(a >= 0 && b >= 0, 'both top qualifiers appear in the opening round');
    assert.notEqual(Math.floor(a / 2), Math.floor(b / 2), 'top two must not feed the same match');
  });

  it('reads the 3rd-place play-off off its loser edge', () => {
    const d = provisionalDivision(division(), { pools: 4 });
    const third = d.bracket[d.bracket.length - 1];
    assert.equal(third.round, '3rd Place');
    const label = labelDivisionMatches(d).get(third.matches[0].id);
    assert.match(label?.teamA ?? '', /^Loser of /);
  });

  it('gives every placeholder its own id so rest rules still apply', () => {
    // The scheduler enforces rest by team id. Placeholders sharing an id (or
    // having none) would produce a plan that fits on paper and not on sand.
    const d = provisionalDivision(division(), { pools: 4 });
    assert.equal(new Set(d.teamsList.map(t => t.id)).size, 16);
    const pool = d.bracket[0].matches;
    assert.ok(pool.every(m => m.teamAId && m.teamBId && m.teamAId !== m.teamBId));
  });

  it('leaves a division that has already been drawn alone', () => {
    // Real matches are the truth; a projection over them is worse information.
    const drawn = division({
      bracket: [{ round: 'Round 1', format: 'round-robin', matches: [{ id: 'm1' } as never] }],
    });
    assert.equal(provisionalDivision(drawn, { pools: 4 }), drawn);
  });

  it('still derives for a division that has rounds but no matches', () => {
    /* A division carries its configured rounds from setup — they are what the
       public page's Round 1 / Round 2 tabs are built from — so an empty-match
       bracket is an undrawn division, not a drawn one. Reading rounds as proof
       of a draw is what made the provisional schedule never appear. */
    const configured = division({
      bracket: [
        { round: 'Round 1', format: 'round-robin', matches: [] as never[] },
        { round: 'Round 2', format: 'single', matches: [] as never[] },
      ],
    });
    const d = provisionalDivision(configured, { pools: 4 });
    assert.equal(d.bracket[0].matches.length, 24);
  });

  it('builds a straight bracket when there is no group stage', () => {
    const d = provisionalDivision(
      division({ teams: 8, configuredRounds: [round('single', 45)] }),
      { pools: 4 },
    );
    // 8 teams straight into a bracket: 4 + 2 + 1, plus the 3rd-place play-off.
    assert.equal(countMatches(d), 8);
    assert.equal(d.drawConfig?.pools, 0);
  });

  it('does not split a division into more pools than it can fill', () => {
    const d = provisionalDivision(division({ teams: 4 }), { pools: 8 });
    assert.equal(d.drawConfig?.pools, 2);
  });

  it('has nothing to derive without a cap or a format', () => {
    assert.equal(provisionalDivision(division({ teams: 0 }), { pools: 4 }).bracket.length, 0);
    assert.equal(provisionalDivision(division({ configuredRounds: [] }), { pools: 4 }).bracket.length, 0);
  });

  it('keeps the division settings the schedule reads', () => {
    const d = provisionalDivision(division(), { pools: 4 });
    assert.equal(d.netHeight, '2.24m');
    assert.equal(d.gender, 'Women');
    assert.equal(d.bracket[0].durationMinutes, 30);
    assert.equal(d.bracket[1].durationMinutes, 45);
  });
});

describe('bracketSeedOrder', () => {
  it('reflects each round rather than counting up', () => {
    // 4: 1v4 and 2v3, winners meet. 8: 1v8 / 4v5 in one half, 2v7 / 3v6 in
    // the other — so the top two can only meet in the final.
    assert.deepEqual(bracketSeedOrder(2), [0, 1]);
    assert.deepEqual(bracketSeedOrder(4), [0, 3, 1, 2]);
    assert.deepEqual(bracketSeedOrder(8), [0, 7, 3, 4, 1, 6, 2, 5]);
  });

  it('keeps the top two seeds in opposite halves', () => {
    for (const size of [4, 8, 16, 32]) {
      const order = bracketSeedOrder(size);
      const half = size / 2;
      assert.ok(order.indexOf(0) < half, `seed 1 in the first half of ${size}`);
      assert.ok(order.indexOf(1) >= half, `seed 2 in the second half of ${size}`);
    }
  });

  it('pairs every seat exactly once', () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const order = bracketSeedOrder(size);
      assert.equal(order.length, size);
      assert.equal(new Set(order).size, size);
      // Opening-round pairs always sum to size - 1: 1 v last, 2 v second-last.
      for (let i = 0; i < size; i += 2) {
        assert.equal(order[i] + order[i + 1], size - 1);
      }
    }
  });
});

describe('isUndrawn', () => {
  it('is true only while nothing has been drawn', () => {
    assert.equal(isUndrawn([division(), division()]), true);
    assert.equal(isUndrawn([]), false);
    const drawn = division({ bracket: [{ round: 'R1', format: 'single', matches: [{ id: 'm' } as never] }] });
    assert.equal(isUndrawn([division(), drawn]), false);
  });

  it('counts configured-but-empty rounds as undrawn', () => {
    const configured = division({ bracket: [{ round: 'R1', format: 'single', matches: [] as never[] }] });
    assert.equal(isUndrawn([configured]), true);
  });
});
