// Generating again must not move a match the organizer has pinned.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { generateSchedule } from './generate.ts';
import { normaliseConfig, type SchedulableDivision, type SchedulableMatch } from './types.ts';

function division(id: string, teams: number): SchedulableDivision {
  const matches: SchedulableMatch[] = [];
  const names = Array.from({ length: teams }, (_, t) => `${id}-t${t + 1}`);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      matches.push({
        id: `${id}-${i}${j}`,
        teamA: names[i],
        teamB: names[j],
        isPool: true,
        pool: 'A',
        durationMinutes: 30,
        roundIndex: 0,
      } as SchedulableMatch);
    }
  }
  return { id, label: id, matches, pools: 1, netHeight: null } as SchedulableDivision;
}

const CONFIG = normaliseConfig({ courtCount: 3, startTime: '09:00', endTime: '18:00', blockMinutes: 30 });
const H = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

describe('a pinned match survives a regenerate', () => {
  const divisions = [division('m', 5), division('w', 5)];

  it('keeps the pinned match on its own court at its own time', () => {
    const first = generateSchedule(divisions, CONFIG, 1);
    const victim = first.placements[3];

    // Pin it somewhere the solver did not choose, so agreement cannot be luck.
    const pin = {
      matchId: victim.matchId,
      courtName: 'Court 3',
      day: 0,
      startMin: H('15:30'),
    };
    const again = generateSchedule(divisions, CONFIG, 1, [pin]);
    const landed = again.placements.find(p => p.matchId === pin.matchId);

    assert.ok(landed, 'the pinned match was dropped from the schedule');
    assert.equal(landed.courtName, 'Court 3');
    assert.equal(landed.day, 0);
    assert.equal(landed.startAbs, H('15:30'));
  });

  it('schedules other matches around it rather than stopping at it', () => {
    const pin = {
      matchId: generateSchedule(divisions, CONFIG, 1).placements[3].matchId,
      courtName: 'Court 3',
      day: 0,
      startMin: H('15:30'),
    };
    const again = generateSchedule(divisions, CONFIG, 1, [pin]);

    const onCourt3 = again.placements
      .filter(p => p.courtName === 'Court 3')
      .sort((a, b) => a.startAbs - b.startAbs);

    // A pin at 15:30 must not sterilise the morning behind it.
    assert.ok(
      onCourt3.some(p => p.startAbs < H('15:30')),
      'nothing was placed before the pin, so it acted as a wall rather than an obstacle',
    );
  });

  it('never lets anything overlap the pin on its court', () => {
    const pin = {
      matchId: generateSchedule(divisions, CONFIG, 1).placements[3].matchId,
      courtName: 'Court 3',
      day: 0,
      startMin: H('15:30'),
    };
    const again = generateSchedule(divisions, CONFIG, 1, [pin]);
    const pinned = again.placements.find(p => p.matchId === pin.matchId)!;

    for (const p of again.placements) {
      if (p.matchId === pin.matchId) continue;
      if (p.courtName !== 'Court 3' || p.day !== 0) continue;
      assert.ok(
        p.endAbs <= pinned.startAbs || p.startAbs >= pinned.endAbs,
        `${p.matchId} overlaps the pinned match`,
      );
    }
  });

  it('does not double-book a team the pinned match uses', () => {
    const first = generateSchedule(divisions, CONFIG, 1);
    const victim = first.placements[3];
    const pin = { matchId: victim.matchId, courtName: 'Court 3', day: 0, startMin: H('15:30') };
    const again = generateSchedule(divisions, CONFIG, 1, [pin]);
    const pinned = again.placements.find(p => p.matchId === pin.matchId)!;

    const node = again.graph.nodes.get(pin.matchId)!;
    const teams = [node.teamA, node.teamB].filter(Boolean) as string[];

    for (const p of again.placements) {
      if (p.matchId === pin.matchId) continue;
      const other = again.graph.nodes.get(p.matchId)!;
      const shares = teams.some(t => t === other.teamA || t === other.teamB);
      if (!shares) continue;
      assert.ok(
        p.endAbs <= pinned.startAbs || p.startAbs >= pinned.endAbs,
        `${p.matchId} shares a team with the pin and overlaps it`,
      );
    }
  });

  it('with no pins, generating is unchanged', () => {
    const a = generateSchedule(divisions, CONFIG, 1);
    const b = generateSchedule(divisions, CONFIG, 1, []);
    assert.deepEqual(
      a.placements.map(p => `${p.matchId}@${p.courtName}:${p.startAbs}`),
      b.placements.map(p => `${p.matchId}@${p.courtName}:${p.startAbs}`),
    );
  });
});
