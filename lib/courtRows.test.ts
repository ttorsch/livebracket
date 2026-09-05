import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourtRows, formatUpNext } from './courtRows.ts';
import type { TournamentDetail, DetailMatch } from './data.ts';
import { normaliseConfig } from './schedule/types.ts';

function mockMatch(partial: Partial<DetailMatch> & { id: string }): DetailMatch {
  return {
    court: 'Court 1',
    time: '09:00',
    scheduledDate: '2026-09-03',
    teamA: [{ name: 'Team Alpha', flag: '' }],
    teamB: [{ name: 'Team Beta', flag: '' }],
    teamAId: 'team-a',
    teamBId: 'team-b',
    teamAName: 'Team Alpha',
    teamBName: 'Team Beta',
    status: 'upcoming',
    ...partial,
  };
}

function mockTournament(
  bracket: { round: string; matches: DetailMatch[] }[],
  divisionLabel = 'Open Men',
): TournamentDetail {
  return {
    slug: 'mock-tournament',
    title: 'Mock Tournament',
    location: 'Beach',
    date: 'Today',
    startDate: '2026-09-03',
    endDate: '2026-09-04',
    dayCount: 2,
    phase: 2,
    imageUrl: null,
    archived: false,
    cancelled: false,
    description: '',
    vouchers: [],
    scheduleConfig: normaliseConfig({}),
    divisions: [
      {
        id: 'div-1',
        label: divisionLabel,
        teams: 8,
        filled: 8,
        teamsList: [],
        bracket: bracket.map(b => ({
          round: b.round,
          format: 'single_elimination',
          durationMinutes: 45,
          matches: b.matches,
        })),
        drawConfig: null,
        netHeight: null,
        gender: 'Anyone',
        ageLimit: '',
        registrationOpens: '',
        registrationCloses: '',
        configuredRounds: [],
        advancePerPool: 2,
        crossing: 'fivb',
        registrationFee: 0,
        formatTypeOnSand: '2x2',
        rosterSize: 2,
        regFields: [],
        waitlistCap: 0,
        rules: '',
        prizePool: '',
        confirmationMessage: '',
      },
    ],
  };
}

describe('formatUpNext', () => {
  it('formats known teams cleanly', () => {
    const result = formatUpNext({
      teamA: [{ name: 'Ananda Suwan', flag: '' }, { name: 'Mali Sunthorn', flag: '' }],
      teamB: [{ name: 'Lukas Meyer', flag: '' }, { name: 'Felix Schmidt', flag: '' }],
      roundName: 'Round 1',
      division: 'Men Open',
    });
    assert.deepEqual(result, { round: 'Round 1', tag: null, teamA: 'Ananda / Mali', teamB: 'Lukas / Felix' });
  });

  it('formats TBD vs TBD with round and division', () => {
    const result = formatUpNext({
      teamA: [{ name: 'TBD', flag: '' }],
      teamB: [{ name: 'TBD', flag: '' }],
      roundName: 'Quarterfinals',
      division: 'Women Open',
    });
    assert.deepEqual(result, { round: 'Quarterfinals', tag: 'Women Open', teamA: 'TBD', teamB: 'TBD' });
  });

  it('formats partial TBD without extra round prefix', () => {
    const result = formatUpNext({
      teamA: [{ name: 'Ananda Suwan', flag: '' }, { name: 'Mali Sunthorn', flag: '' }],
      teamB: [{ name: 'TBD', flag: '' }],
      roundName: 'Quarterfinals',
      division: 'Women Open',
    });
    assert.deepEqual(result, { round: 'Quarterfinals', tag: null, teamA: 'Ananda / Mali', teamB: 'TBD' });
  });
});

describe('buildCourtRows', () => {
  it('prioritizes Day 1 upcoming matches over Day 2 morning matches on the same court', () => {
    // Day 1 match at 09:30 (with teams) vs Day 2 match at 09:00 (TBD vs TBD)
    const day1Match = mockMatch({
      id: 'm-day1',
      court: 'Court 1',
      scheduledDate: '2026-09-03',
      time: '09:30',
      teamA: [{ name: 'Ananda Suwan', flag: '' }, { name: 'Mali Sunthorn', flag: '' }],
      teamB: [{ name: 'Lukas Meyer', flag: '' }, { name: 'Felix Schmidt', flag: '' }],
    });
    const day2Match = mockMatch({
      id: 'm-day2',
      court: 'Court 1',
      scheduledDate: '2026-09-04',
      time: '09:00',
      teamA: [{ name: 'TBD', flag: '' }],
      teamB: [{ name: 'TBD', flag: '' }],
    });

    const tournament = mockTournament([
      { round: 'Pool Round', matches: [day1Match] },
      { round: 'Quarterfinals', matches: [day2Match] },
    ]);

    const rows = buildCourtRows(tournament);
    assert.equal(rows.length, 1);
    const court1 = rows[0];
    assert.equal(court1.court, 'Court 1');
    assert.equal(court1.hasLive, false);
    assert.equal(court1.upNextTime, '09:30');
    assert.deepEqual(court1.upNext, { round: 'Pool Round', tag: null, teamA: 'Ananda / Mali', teamB: 'Lukas / Felix' });
  });

  it('formats upNext with round and division when next match is genuinely TBD', () => {
    const day2Match = mockMatch({
      id: 'm-day2',
      court: 'Court 2',
      scheduledDate: '2026-09-04',
      time: '09:00',
      teamA: [{ name: 'TBD', flag: '' }],
      teamB: [{ name: 'TBD', flag: '' }],
    });

    const tournament = mockTournament(
      [{ round: 'Quarterfinals', matches: [day2Match] }],
      'Mixed Open'
    );

    const rows = buildCourtRows(tournament);
    assert.equal(rows.length, 1);
    const court2 = rows[0];
    assert.equal(court2.court, 'Court 2');
    assert.equal(court2.upNextTime, '09:00');
    assert.deepEqual(court2.upNext, { round: 'Quarterfinals', tag: 'Mixed Open', teamA: 'TBD', teamB: 'TBD' });
  });

  it('keeps live match on court while correctly picking the next chronological upcoming match', () => {
    const liveMatch = mockMatch({
      id: 'm-live',
      court: 'Court 4',
      status: 'live',
      scheduledDate: '2026-09-03',
      time: '09:00',
      teamA: [{ name: 'Somchai Boonmee', flag: '' }, { name: 'Kanya Rattana', flag: '' }],
      teamB: [{ name: 'Aroon Niran', flag: '' }, { name: 'Chai Wira', flag: '' }],
      scoreA: [12],
      scoreB: [9],
    });
    const day1NextMatch = mockMatch({
      id: 'm-day1-next',
      court: 'Court 4',
      status: 'upcoming',
      scheduledDate: '2026-09-03',
      time: '09:30',
      teamA: [{ name: 'Nok Ploy', flag: '' }, { name: 'Tem Boon', flag: '' }],
      teamB: [{ name: 'Emma Sara', flag: '' }, { name: 'Ana Julia', flag: '' }],
    });
    const day2Match = mockMatch({
      id: 'm-day2',
      court: 'Court 4',
      status: 'upcoming',
      scheduledDate: '2026-09-04',
      time: '09:00',
      teamA: [{ name: 'TBD', flag: '' }],
      teamB: [{ name: 'TBD', flag: '' }],
    });

    const tournament = mockTournament([
      { round: 'Pools', matches: [liveMatch, day1NextMatch] },
      { round: 'Quarterfinals', matches: [day2Match] },
    ]);

    const rows = buildCourtRows(tournament);
    assert.equal(rows.length, 1);
    const court4 = rows[0];
    assert.equal(court4.court, 'Court 4');
    assert.equal(court4.hasLive, true);
    assert.equal(court4.teamA, 'Somchai / Kanya');
    assert.equal(court4.teamB, 'Aroon / Chai');
    assert.equal(court4.upNextTime, '09:30');
    assert.deepEqual(court4.upNext, { round: 'Pools', tag: null, teamA: 'Nok / Tem', teamB: 'Emma / Ana' });
    // The round of the match actually on court, for the scoreboard header.
    assert.equal(court4.round, 'Pools');
  });
});
