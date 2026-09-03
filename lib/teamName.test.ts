import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { joinTeamName, formatTeamName, formatTeamFirstName } from './teamName.ts';

describe('joinTeamName', () => {
  it('joins two player names with a slash and no extra spaces', () => {
    assert.equal(joinTeamName(['Ananda Suwan', 'Mali Sunthorn']), 'Ananda Suwan/Mali Sunthorn');
  });

  it('filters empty or null names', () => {
    assert.equal(joinTeamName(['Ananda Suwan', null, '', '   ']), 'Ananda Suwan');
  });
});

describe('formatTeamName', () => {
  it('normalizes spaced slash format', () => {
    assert.equal(formatTeamName('Ananda Suwan / Mali Sunthorn'), 'Ananda Suwan/Mali Sunthorn');
  });

  it('leaves custom team names untouched', () => {
    assert.equal(formatTeamName('Sun Chasers'), 'Sun Chasers');
    assert.equal(formatTeamName('BYE'), 'BYE');
  });
});

describe('formatTeamFirstName', () => {
  it('shows full team name when a team name exists without slashes', () => {
    assert.equal(formatTeamFirstName('Sun Chasers'), 'Sun Chasers');
    assert.equal(formatTeamFirstName('Mixed Nuts'), 'Mixed Nuts');
    assert.equal(formatTeamFirstName('Salt & Pepper'), 'Salt & Pepper');
    assert.equal(formatTeamFirstName('Sand Kings'), 'Sand Kings');
  });

  it('shows player first name / player first name when name is a slash-separated pair of players', () => {
    assert.equal(formatTeamFirstName('Ananda Suwan/Mali Sunthorn'), 'Ananda/Mali');
    assert.equal(formatTeamFirstName('Ananda Suwan / Mali Sunthorn'), 'Ananda/Mali');
    assert.equal(formatTeamFirstName('Somchai Boonmee/Kanya Rattana'), 'Somchai/Kanya');
  });

  it('handles single word player names', () => {
    assert.equal(formatTeamFirstName('Ananda/Mali'), 'Ananda/Mali');
    assert.equal(formatTeamFirstName('Ananda / Mali'), 'Ananda/Mali');
  });

  it('handles empty or null inputs', () => {
    assert.equal(formatTeamFirstName(''), '');
    assert.equal(formatTeamFirstName(null), '');
    assert.equal(formatTeamFirstName(undefined), '');
  });
});
