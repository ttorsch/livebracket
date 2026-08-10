// Unit tests for folding live scores into a tournament detail.
//
// Run with:  npm test
//
// This merge is the only thing standing between "the referee is tapping"
// and "the dashboard and the public bracket show a score", and it can't be
// exercised through the UI without a reachable Redis — so the invariants
// are asserted directly here.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { applyLiveScores, type LiveScoreMap } from './liveScores.ts';
import type { TournamentDetail, DetailMatch } from './data.ts';

const match = (id: string, over: Partial<DetailMatch> = {}): DetailMatch => ({
  id,
  court: 'Court 1',
  time: '09:00',
  scheduledDate: '2026-08-17',
  teamA: [],
  teamB: [],
  teamAId: 'a',
  teamBId: 'b',
  teamAName: 'A',
  teamBName: 'B',
  status: 'upcoming',
  ...over,
});

const detailWith = (matches: DetailMatch[]): TournamentDetail => ({
  slug: 't',
  title: 'T',
  location: 'L',
  date: 'Today',
  startDate: '2026-08-17',
  endDate: '2026-08-17',
  dayCount: 1,
  phase: 3,
  description: '',
  scheduleConfig: undefined,
  divisions: [{
    id: 'd1',
    label: 'Men',
    teams: 16,
    filled: 16,
    teamsList: [],
    bracket: [{ round: 'Round Robin', format: 'round-robin', matches }],
  }],
  vouchers: [],
} as unknown as TournamentDetail);

const firstMatch = (d: TournamentDetail) => d.divisions[0].bracket[0].matches[0];

describe('applyLiveScores', () => {
  it('returns the same object when nothing is live', () => {
    const detail = detailWith([match('m1')]);
    assert.equal(applyLiveScores(detail, {}), detail, 'should not clone when there is no work');
  });

  it('appends the in-progress set after the completed ones', () => {
    const detail = detailWith([match('m1')]);
    const live: LiveScoreMap = { m1: { sets: [{ a: 21, b: 15 }], a: 18, b: 12 } };

    const m = firstMatch(applyLiveScores(detail, live));
    assert.deepEqual(m.scoreA, [21, 18]);
    assert.deepEqual(m.scoreB, [15, 12]);
    assert.equal(m.status, 'live');
  });

  it('shows a freshly started set as 0-0 rather than as no score', () => {
    const detail = detailWith([match('m1')]);
    const m = firstMatch(applyLiveScores(detail, { m1: { sets: [], a: 0, b: 0 } }));
    assert.deepEqual(m.scoreA, [0]);
    assert.deepEqual(m.scoreB, [0]);
  });

  it('never lets a stale live key overwrite a finalized result', () => {
    const detail = detailWith([
      match('m1', { status: 'done', scoreA: [21, 21], scoreB: [15, 19], winner: 'A' }),
    ]);
    const m = firstMatch(applyLiveScores(detail, { m1: { sets: [], a: 3, b: 1 } }));
    assert.deepEqual(m.scoreA, [21, 21], 'the durable score must win');
    assert.equal(m.status, 'done');
    assert.equal(m.winner, 'A');
  });

  it('leaves matches with no live entry untouched', () => {
    const detail = detailWith([match('m1'), match('m2')]);
    const merged = applyLiveScores(detail, { m1: { sets: [], a: 5, b: 4 } });
    const [a, b] = merged.divisions[0].bracket[0].matches;
    assert.deepEqual(a.scoreA, [5]);
    assert.equal(b.scoreA, undefined);
    assert.equal(b.status, 'upcoming');
  });

  it('does not mutate the detail it was given', () => {
    const detail = detailWith([match('m1')]);
    applyLiveScores(detail, { m1: { sets: [{ a: 21, b: 9 }], a: 2, b: 0 } });
    assert.equal(firstMatch(detail).scoreA, undefined, 'input must be left alone');
    assert.equal(firstMatch(detail).status, 'upcoming');
  });
});
