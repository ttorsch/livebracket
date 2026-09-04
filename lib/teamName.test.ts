import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  joinTeamName,
  formatTeamName,
  formatTeamFirstName,
  formatPlayerNames,
  extractFirstName,
  joinPlayerFirstNames,
} from './teamName.ts';

describe('extractFirstName', () => {
  it('extracts first name from full name', () => {
    assert.equal(extractFirstName('Ananda Suwan'), 'Ananda');
    assert.equal(extractFirstName('Mali'), 'Mali');
    assert.equal(extractFirstName('  Somchai Boonmee  '), 'Somchai');
    assert.equal(extractFirstName(''), '');
    assert.equal(extractFirstName(null), '');
  });
});

describe('joinPlayerFirstNames', () => {
  it('joins first names with slash surrounded by spaces', () => {
    assert.equal(joinPlayerFirstNames(['Ananda Suwan', 'Mali Sunthorn']), 'Ananda / Mali');
    assert.equal(joinPlayerFirstNames(['Aroon', 'Niran', 'Chai']), 'Aroon / Niran / Chai');
  });
});

describe('joinTeamName', () => {
  it('joins two player names with a slash and no extra spaces', () => {
    assert.equal(joinTeamName(['Ananda Suwan', 'Mali Sunthorn']), 'Ananda Suwan/Mali Sunthorn');
  });

  it('filters empty or null names', () => {
    assert.equal(joinTeamName(['Ananda Suwan', null, '', '   ']), 'Ananda Suwan');
  });
});

describe('formatTeamName', () => {
  it('formats player full names to first names separated by slash', () => {
    assert.equal(formatTeamName('Ananda Suwan / Mali Sunthorn'), 'Ananda / Mali');
    assert.equal(formatTeamName('Ananda Suwan/Mali Sunthorn'), 'Ananda / Mali');
  });

  it('suppresses legacy custom team names and returns Player TBD or Seed', () => {
    assert.equal(formatTeamName('Sun Chasers'), 'Player TBD');
    assert.equal(formatTeamName('Sun Chasers', 3), 'Seed 3');
  });

  it('leaves slot markers and placeholders untouched', () => {
    assert.equal(formatTeamName('BYE'), 'BYE');
    assert.equal(formatTeamName('TBD'), 'TBD');
    assert.equal(formatTeamName('Winner of M1'), 'Winner of M1');
    assert.equal(formatTeamName('Loser of M2'), 'Loser of M2');
    assert.equal(formatTeamName('#1 Pool A'), '#1 Pool A');
  });
});

describe('formatTeamFirstName', () => {
  it('suppresses custom team names and returns Player TBD or Seed', () => {
    assert.equal(formatTeamFirstName('Sun Chasers'), 'Player TBD');
    assert.equal(formatTeamFirstName('Sun Chasers', 2), 'Seed 2');
    assert.equal(formatTeamFirstName('Mixed Nuts'), 'Player TBD');
    assert.equal(formatTeamFirstName('Salt & Pepper'), 'Player TBD');
  });

  it('shows player first name / player first name when name is a slash-separated pair of players', () => {
    assert.equal(formatTeamFirstName('Ananda Suwan/Mali Sunthorn'), 'Ananda / Mali');
    assert.equal(formatTeamFirstName('Ananda Suwan / Mali Sunthorn'), 'Ananda / Mali');
    assert.equal(formatTeamFirstName('Somchai Boonmee/Kanya Rattana'), 'Somchai / Kanya');
  });

  it('handles single word player names', () => {
    assert.equal(formatTeamFirstName('Ananda/Mali'), 'Ananda / Mali');
    assert.equal(formatTeamFirstName('Ananda / Mali'), 'Ananda / Mali');
  });

  it('handles empty or null inputs', () => {
    assert.equal(formatTeamFirstName(''), '');
    assert.equal(formatTeamFirstName(null), '');
    assert.equal(formatTeamFirstName(undefined), '');
  });
});

describe('formatPlayerNames', () => {
  it('formats from player objects directly', () => {
    const players = [{ name: 'Ananda Suwan' }, { name: 'Mali Sunthorn' }];
    assert.equal(formatPlayerNames(players), 'Ananda / Mali');
  });

  it('handles single player from player objects', () => {
    const players = [{ name: 'Ananda Suwan' }];
    assert.equal(formatPlayerNames(players), 'Ananda');
  });

  it('falls back to rawName when player array is empty', () => {
    assert.equal(formatPlayerNames([], 'Ananda Suwan / Mali Sunthorn'), 'Ananda / Mali');
    assert.equal(formatPlayerNames([], 'Sun Chasers', 1), 'Seed 1');
    assert.equal(formatPlayerNames([], 'Sun Chasers'), 'Player TBD');
  });
});
