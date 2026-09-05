// Unit tests for the player record.
//
// Run with:  npm test

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { aggregateRecord, EMPTY_RECORD, type RecordMatch } from './playerRecord.ts';

const match = (patch: Partial<RecordMatch> = {}): RecordMatch => ({
  teamAId: 'mine',
  teamBId: 'theirs',
  scoreA: [21, 21],
  scoreB: [15, 12],
  winnerTeamId: null,
  status: 'done',
  roundName: 'Round Robin',
  tournamentTitle: 'Khao Lak Open',
  ...patch,
});

describe('aggregateRecord', () => {
  it('is empty when the player has no teams', () => {
    assert.deepEqual(aggregateRecord([match()], []), EMPTY_RECORD);
  });

  it('counts a win from the side the player was on', () => {
    const r = aggregateRecord([match()], ['mine']);
    assert.equal(r.matchesCount, 1);
    assert.equal(r.wins, 1);
    assert.equal(r.losses, 0);
    assert.equal(r.winRate, 100);
    assert.equal(r.setsWon, 2);
    assert.equal(r.setsLost, 0);
  });

  it('reads the same match as a loss from the other side', () => {
    const r = aggregateRecord([match()], ['theirs']);
    assert.equal(r.wins, 0);
    assert.equal(r.losses, 1);
    assert.equal(r.setsWon, 0);
    assert.equal(r.setsLost, 2);
  });

  it('ignores matches that have not been played', () => {
    const r = aggregateRecord(
      [match({ status: 'upcoming', scoreA: null, scoreB: null })],
      ['mine'],
    );
    assert.deepEqual(r, EMPTY_RECORD);
  });

  it('ignores matches the player was not in', () => {
    const r = aggregateRecord([match({ teamAId: 'x', teamBId: 'y' })], ['mine']);
    assert.deepEqual(r, EMPTY_RECORD);
  });

  it('trusts a recorded winner over the score', () => {
    const r = aggregateRecord(
      [match({ winnerTeamId: 'theirs' })],
      ['mine'],
    );
    assert.equal(r.wins, 0);
    assert.equal(r.losses, 1);
  });

  it('counts the longest streak, not the current one', () => {
    const r = aggregateRecord(
      [
        match(),                                       // W
        match(),                                       // W
        match({ winnerTeamId: 'theirs' }),             // L
        match(),                                       // W
      ],
      ['mine'],
    );
    assert.equal(r.wins, 3);
    assert.equal(r.losses, 1);
    assert.equal(r.longestStreak, 2);
    assert.equal(r.winRate, 75);
  });

  it('keeps the furthest finish, whatever order the rounds arrive in', () => {
    const r = aggregateRecord(
      [
        match({ roundName: 'Final', winnerTeamId: 'theirs' }),
        match({ roundName: 'Semifinal' }),
      ],
      ['mine'],
    );
    assert.equal(r.bestFinish, 'Finalist · Khao Lak Open');
  });

  it('calls the winner of a final the winner', () => {
    const r = aggregateRecord([match({ roundName: 'Final' })], ['mine']);
    assert.equal(r.bestFinish, 'Winner · Khao Lak Open');
  });

  it('does not mistake a semifinal or quarterfinal for the final', () => {
    assert.equal(
      aggregateRecord([match({ roundName: 'Quarterfinal' })], ['mine']).bestFinish,
      'Quarterfinalist · Khao Lak Open',
    );
    assert.equal(
      aggregateRecord([match({ roundName: 'Semi Final' })], ['mine']).bestFinish,
      'Semifinalist · Khao Lak Open',
    );
  });

  it('decides on total points when nothing else separates the sides', () => {
    const r = aggregateRecord(
      [match({ scoreA: [21, 16], scoreB: [15, 21], winnerTeamId: null })],
      ['mine'],
    );
    assert.equal(r.wins, 1);
  });

  it('adds up matches played across more than one of the player’s teams', () => {
    const r = aggregateRecord(
      [
        match({ teamAId: 'teamA' }),
        match({ teamAId: 'other', teamBId: 'teamB', scoreA: [21], scoreB: [10] }),
      ],
      ['teamA', 'teamB'],
    );
    assert.equal(r.matchesCount, 2);
    assert.equal(r.wins, 1);
    assert.equal(r.losses, 1);
  });
});
