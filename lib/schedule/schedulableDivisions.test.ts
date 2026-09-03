// Unit tests for the handover from a drawn bracket to the solver's input.
//
// Run with:  npm test
//
// What is under test is that every fact the solver is handed is derived from
// the bracket rather than guessed, because no later phase can tell that a fact
// it was given was wrong. The pool flag above all: get it wrong and the pool
// rotation, the court appetite, the staging waves and the rest rule all go
// quietly wrong together, and the schedule that comes out looks plausible.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { DetailDivision, DetailMatch, DetailRound, DetailTeam, DrawConfig } from '../data.ts';
import { labelDivisions, toSchedulableDivisions } from './schedulableDivisions.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

function team(id: string, seed: number): DetailTeam {
  return { id, name: `Team ${id}`, seed, status: 'confirmed' };
}

function match(id: string, a: string | null, b: string | null, patch: Partial<DetailMatch> = {}): DetailMatch {
  return {
    id,
    court: '',
    time: '',
    scheduledDate: null,
    teamA: [],
    teamB: [],
    teamAId: a,
    teamBId: b,
    teamAName: a,
    teamBName: b,
    status: 'upcoming',
    ...patch,
  };
}

function round(format: string, matches: DetailMatch[], durationMinutes?: number): DetailRound {
  return { round: format, format, matches, durationMinutes };
}

/** A division with `teams` teams and whatever rounds it is given. Only the
 *  fields this handover reads are meaningful; the rest are filler the type
 *  demands. */
function division(patch: {
  id?: string;
  teams?: number;
  bracket?: DetailRound[];
  drawConfig?: Partial<DrawConfig> | null;
  dedicatedCourts?: number | null;
  netHeight?: string | null;
} = {}): DetailDivision {
  const teamCount = patch.teams ?? 8;
  const teamsList = Array.from({ length: teamCount }, (_, i) => team(`t${i + 1}`, i + 1));
  return {
    id: patch.id ?? 'd1',
    label: 'Men Open',
    teams: teamCount,
    filled: teamCount,
    teamsList,
    bracket: patch.bracket ?? [],
    drawConfig:
      patch.drawConfig === null
        ? null
        : { pools: 2, advance: 2, crossing: 'fivb', attempts: 1, topSeedIds: [], ...patch.drawConfig },
    dedicatedCourts: patch.dedicatedCourts ?? null,
    netHeight: patch.netHeight ?? '2.43m',
    gender: 'Men',
    ageLimit: '',
    registrationOpens: '',
    registrationCloses: '',
    configuredRounds: [],
    advancePerPool: 2,
    crossing: 'fivb',
    registrationFee: 0,
    formatTypeOnSand: '2v2',
    rosterSize: 2,
    regFields: [],
    waitlistCap: 0,
    rules: '',
    prizePool: '',
    confirmationMessage: '',
  };
}

/** The handover, run over one division the way the schedule screen runs it. */
function handover(div: DetailDivision, overrides: Record<string, number | null> = {}) {
  const [out] = toSchedulableDivisions([div], labelDivisions([div]), overrides);
  return out;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('which matches are pool play', () => {
  it('marks a round robin round as pool play', () => {
    const div = division({
      bracket: [round('round-robin', [match('m1', 't1', 't2'), match('m2', 't3', 't4')])],
    });
    assert.deepEqual(handover(div).matches.map(m => m.isPool), [true, true]);
  });

  it('does not mark a knockout round as pool play', () => {
    const div = division({
      bracket: [
        round('round-robin', [match('m1', 't1', 't2')]),
        round('single', [match('k1', 't1', 't3')]),
        round('double', [match('k2', 't1', 't4')]),
      ],
    });
    assert.deepEqual(handover(div).matches.map(m => m.isPool), [true, false, false]);
  });

  /* The bug this module was extracted for. 'pool' was a fourth round format
     the schema allowed and the label map called "Pool Play"; the schedule
     screen compared the format to 'round-robin' by hand, so a round carrying
     it produced isPool: false for every match and was placed as a knockout.
     It is gone from the schema (migration 0010) and from RoundFormat, so it
     can only arrive as a corrupt value now — and an unknown format must not
     be guessed into pool play. */
  it('does not treat an unrecognised format as pool play', () => {
    const div = division({ bracket: [round('pool', [match('m1', 't1', 't2')])] });
    assert.deepEqual(handover(div).matches.map(m => m.isPool), [false]);
  });
});

describe('which pool a match belongs to', () => {
  it('names the pool for every pool match', () => {
    const div = division({
      teams: 4,
      drawConfig: { pools: 2 },
      bracket: [round('round-robin', [match('m1', 't1', 't4'), match('m2', 't2', 't3')])],
    });
    // Serpentine over 4 teams into 2 pools: A = t1, t4 · B = t2, t3.
    assert.deepEqual(handover(div).matches.map(m => m.pool), ['A', 'B']);
  });

  it('leaves a knockout match without a pool', () => {
    const div = division({
      teams: 4,
      drawConfig: { pools: 2 },
      bracket: [
        round('round-robin', [match('m1', 't1', 't4')]),
        round('single', [match('k1', 't1', 't2')]),
      ],
    });
    assert.equal(handover(div).matches.find(m => m.id === 'k1')!.pool, null);
  });
});

describe('what does not reach the solver', () => {
  /* A bye is settled before it starts, so it is never played. Handing one to
     the solver would reserve a court for a match nobody turns up to. */
  it('drops a bye', () => {
    const div = division({
      teams: 3,
      drawConfig: { pools: 1 },
      bracket: [
        round('round-robin', [match('m1', 't1', 't2')]),
        round('single', [
          match('k1', 't1', null, { status: 'done' }),
          match('k2', 't2', 't3'),
        ]),
      ],
    });
    assert.deepEqual(handover(div).matches.map(m => m.id), ['m1', 'k2']);
  });
});

describe('the dependencies the solver cannot infer', () => {
  /* The play-off for 3rd is drawn from two *losing* semifinals and played
     before the final, so its place in round order says nothing about what has
     to finish first. Its feeders are stated outright by the draw. */
  it('carries the third-place feeders through', () => {
    const div = division({
      teams: 4,
      drawConfig: { pools: 1, loserFeeders: { third: ['sf1', 'sf2'] } },
      bracket: [
        round('single', [match('sf1', 't1', 't4'), match('sf2', 't2', 't3')]),
        round('single', [match('final', null, null), match('third', null, null)]),
      ],
    });
    const third = handover(div).matches.find(m => m.id === 'third')!;
    assert.equal(third.isThirdPlace, true);
    assert.deepEqual(third.dependsOn, ['sf1', 'sf2']);

    const final = handover(div).matches.find(m => m.id === 'final')!;
    assert.equal(final.isThirdPlace, undefined);
    assert.equal(final.dependsOn, undefined);
  });

  it('numbers rounds in setup order, starting at zero', () => {
    const div = division({
      bracket: [
        round('round-robin', [match('m1', 't1', 't2')]),
        round('single', [match('k1', 't1', 't3')]),
        round('single', [match('f1', null, null)]),
      ],
    });
    assert.deepEqual(handover(div).matches.map(m => m.roundIndex), [0, 1, 2]);
  });

  it('gives each match its own round slot length', () => {
    const div = division({
      bracket: [
        round('round-robin', [match('m1', 't1', 't2')], 30),
        round('single', [match('k1', 't1', 't3')], 60),
      ],
    });
    assert.deepEqual(handover(div).matches.map(m => m.durationMinutes), [30, 60]);
  });
});

describe('what the division itself carries', () => {
  it('reads the pool count off the draw', () => {
    assert.equal(handover(division({ drawConfig: { pools: 4 } })).pools, 4);
  });

  /* No draw is not zero pools. An undrawn division is one undivided field of
     teams, and a zero here would divide the court appetite by nothing. */
  it('counts an undrawn division as one pool', () => {
    assert.equal(handover(division({ drawConfig: null })).pools, 1);
  });

  it('prefers an unsaved court override to the saved one', () => {
    const div = division({ id: 'd1', dedicatedCourts: 2 });
    assert.equal(handover(div, { d1: 4 }).dedicatedCourts, 4);
  });

  it('falls back to the saved court count when nothing is overridden', () => {
    const div = division({ id: 'd1', dedicatedCourts: 2 });
    assert.equal(handover(div, {}).dedicatedCourts, 2);
  });

  /* Null means "let the generator work the court count out", so an override
     cleared back to null must not read as an override of zero. */
  it('lets a cleared override fall through to the saved count', () => {
    const div = division({ id: 'd1', dedicatedCourts: 2 });
    assert.equal(handover(div, { d1: null }).dedicatedCourts, 2);
  });

  it('carries net height and gender through for grouping', () => {
    const out = handover(division({ netHeight: '2.24m' }));
    assert.equal(out.netHeight, '2.24m');
    assert.equal(out.gender, 'Men');
  });
});

describe('more than one division', () => {
  it('keeps each division to its own matches and its own override', () => {
    const men = division({ id: 'men', bracket: [round('round-robin', [match('m1', 't1', 't2')])] });
    const women = division({ id: 'women', bracket: [round('single', [match('w1', 't1', 't2')])] });
    const out = toSchedulableDivisions([men, women], labelDivisions([men, women]), { women: 3 });

    assert.deepEqual(out.map(d => d.id), ['men', 'women']);
    assert.deepEqual(out[0].matches.map(m => m.id), ['m1']);
    assert.deepEqual(out[1].matches.map(m => m.id), ['w1']);
    assert.equal(out[0].dedicatedCourts, null);
    assert.equal(out[1].dedicatedCourts, 3);
  });

  it('returns nothing for no divisions', () => {
    assert.deepEqual(toSchedulableDivisions([], labelDivisions([])), []);
  });
});
