// Unit tests for the derived pre-draw schedule.
//
// Run with:  npm test
//
// The property that matters most is determinism. Nothing is stored: the
// organizer's screen and the public page each derive this from the same rows,
// so if the derivation were not a pure function of them the two would show
// different times for the same match and only one of them could be right.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { TournamentDetail, DetailDivision, ConfiguredRound } from './data.ts';
import { DEFAULT_SCHEDULE_CONFIG } from './schedule/types.ts';
import { provisionalSchedule, provisionalAssumptionText } from './provisionalSchedule.ts';

const scoring = { setsBestOf: 3, pointsPerSet: 21, winBy2: true, hardCap: 0, decidingSetPoints: 15 };
const round = (format: string, durationMinutes = 30): ConfiguredRound => ({ format, scoring, durationMinutes });

function division(id: string, label: string, patch: Partial<DetailDivision> = {}): DetailDivision {
  return {
    id, label,
    teams: 16, filled: 0, teamsList: [],
    // Configured rounds with no matches — an undrawn division, as loaded.
    bracket: [
      { round: 'Round 1', format: 'round-robin', matches: [] },
      { round: 'Round 2', format: 'single', matches: [] },
    ],
    drawConfig: null,
    netHeight: '2.24m', gender: 'Anyone', ageLimit: '',
    registrationOpens: '', registrationCloses: '',
    configuredRounds: [round('round-robin'), round('single', 45)],
    advancePerPool: 2, crossing: 'fivb', plannedPools: 4, plannedThirdPlace: true,
    registrationFee: 0, currency: 'THB', formatTypeOnSand: '2v2', rosterSize: 2,
    regFields: [], waitlistCap: 0, rules: '',
    prizes: { placings: [], note: '' }, confirmationMessage: '',
    ...patch,
  };
}

function tournament(divisions: DetailDivision[]): TournamentDetail {
  return {
    slug: 't', title: 'T', location: 'L',
    date: 'Sep 19, 2026', startDate: '2026-09-19', endDate: '2026-09-20', dayCount: 2,
    phase: 3, imageUrl: null, archived: false, cancelled: false, description: null,
    scheduleConfig: { ...DEFAULT_SCHEDULE_CONFIG, courtCount: 4 },
    divisions, vouchers: [],
  };
}

const allMatches = (d: TournamentDetail) =>
  d.divisions.flatMap(v => v.bracket.flatMap(r => r.matches));

describe('provisionalSchedule', () => {
  it('places matches on courts and dates inside the event', () => {
    const plan = provisionalSchedule(tournament([division('d1', "Men's Open")]));
    assert.ok(plan);
    const placed = allMatches(plan.detail).filter(m => m.court && m.time);
    assert.ok(placed.length > 0);
    for (const m of placed) {
      assert.ok(['2026-09-19', '2026-09-20'].includes(m.scheduledDate ?? ''), m.scheduledDate ?? 'none');
      assert.match(m.time, /^\d{2}:\d{2}$/);
    }
  });

  it('is deterministic — the same rows give the same schedule', () => {
    // The organizer's screen and the public page each derive this separately.
    // Two answers to "when is M12" is the one failure mode with no recovery.
    const input = () => tournament([division('d1', "Men's Open"), division('d2', "Women's Open", { teams: 12, plannedPools: 3 })]);
    const a = provisionalSchedule(input());
    const b = provisionalSchedule(input());
    const key = (d: TournamentDetail) =>
      allMatches(d).map(m => `${m.id}@${m.scheduledDate} ${m.time} ${m.court}`).join('|');
    assert.equal(key(a!.detail), key(b!.detail));
  });

  it('reports what it assumed', () => {
    const plan = provisionalSchedule(tournament([
      division('d1', "Men's Open"),
      division('d2', "Women's Open", { teams: 12, plannedPools: 3 }),
    ]));
    assert.deepEqual(plan!.assumptions, [
      { label: "Men's Open", cap: 16, pools: 4 },
      { label: "Women's Open", cap: 12, pools: 3 },
    ]);
  });

  it('stands down the moment anything is really drawn', () => {
    // A real bracket is the truth; a projection laid over it is worse
    // information than the thing it covered.
    const drawn = division('d2', 'Drawn', {
      bracket: [{ round: 'Round 1', format: 'round-robin', matches: [{ id: 'real' } as never] }],
    });
    assert.equal(provisionalSchedule(tournament([division('d1', 'Undrawn'), drawn])), null);
  });

  it('has nothing to derive for a tournament with no divisions', () => {
    assert.equal(provisionalSchedule(tournament([])), null);
    assert.equal(provisionalSchedule(null), null);
  });

  it('has nothing to derive when no division has a usable cap', () => {
    assert.equal(provisionalSchedule(tournament([division('d1', 'Tiny', { teams: 0 })])), null);
  });

  it('leaves the tournament itself untouched', () => {
    const t = tournament([division('d1', "Men's Open")]);
    const plan = provisionalSchedule(t);
    assert.equal(plan!.detail.slug, t.slug);
    assert.equal(plan!.detail.startDate, t.startDate);
    // The input is not mutated — it is still the undrawn tournament it was.
    assert.equal(allMatches(t).length, 0);
  });
});

describe('provisionalSchedule hand placements', () => {
  /* A hand move is the one part of the plan no setup implies, so it is the
     one part that is stored. Replayed as a pin, so the rest of the plan is
     dealt around it rather than over it. */
  function planned(placements: Record<string, { court: string; day: number; time: string }>) {
    const t = tournament([division('d1', "Men's Open")]);
    return provisionalSchedule({
      ...t,
      scheduleConfig: { ...t.scheduleConfig, provisionalPlacements: placements },
    });
  }

  const firstMatchId = () => {
    const plan = provisionalSchedule(tournament([division('d1', "Men's Open")]));
    return allMatches(plan!.detail).find(m => m.court)!.id;
  };

  it('puts a moved match where it was put', () => {
    const id = firstMatchId();
    const plan = planned({ [id]: { court: 'Court 3', day: 1, time: '14:00' } });
    const moved = allMatches(plan!.detail).find(m => m.id === id);
    assert.equal(moved?.court, 'Court 3');
    assert.equal(moved?.time, '14:00');
    assert.equal(moved?.scheduledDate, '2026-09-20');
    assert.equal(plan!.pinnedCount, 1);
    assert.equal(plan!.droppedPlacements, 0);
  });

  it('deals the rest of the plan around it, not over it', () => {
    const id = firstMatchId();
    const plan = planned({ [id]: { court: 'Court 3', day: 1, time: '14:00' } });
    const clash = allMatches(plan!.detail).filter(
      m => m.id !== id && m.court === 'Court 3' && m.time === '14:00' && m.scheduledDate === '2026-09-20',
    );
    assert.deepEqual(clash, [], 'nothing else may be given the pinned slot');
  });

  it('drops a move whose match no longer exists, and says how many', () => {
    /* The ids encode the division's shape, so changing a pool count or a cap
       can leave a stored move pointing at nothing. Dropped, never silently
       applied to whichever match happens to hold that id now. */
    const plan = planned({ 'prov:d1:g99:9:9': { court: 'Court 1', day: 0, time: '09:00' } });
    assert.equal(plan!.pinnedCount, 0);
    assert.equal(plan!.droppedPlacements, 1);
  });

  it('ignores a move that is not a time or has no court', () => {
    const id = firstMatchId();
    const plan = planned({
      [id]: { court: '', day: 0, time: '09:00' },
      'prov:d1:k0:0': { court: 'Court 1', day: 0, time: 'lunchtime' },
    });
    assert.equal(plan!.pinnedCount, 0);
    assert.equal(plan!.droppedPlacements, 2);
  });

  it('is still deterministic with moves stored', () => {
    const id = firstMatchId();
    const key = (p: ReturnType<typeof planned>) =>
      allMatches(p!.detail).map(m => `${m.id}@${m.scheduledDate} ${m.time} ${m.court}`).join('|');
    const placements = { [id]: { court: 'Court 2', day: 0, time: '11:00' } };
    assert.equal(key(planned(placements)), key(planned(placements)));
  });
});

describe('provisionalAssumptionText', () => {
  it('names every division rather than summarising them', () => {
    const text = provisionalAssumptionText([
      { label: "Men's Open", cap: 16, pools: 4 },
      { label: 'Mixed 4v4', cap: 8, pools: 2 },
    ]);
    assert.equal(text, "Assumes Men's Open full at 16 teams in 4 pools and Mixed 4v4 full at 8 teams in 2 pools.");
  });

  it('drops the pool clause for a division with no group stage', () => {
    assert.equal(
      provisionalAssumptionText([{ label: 'Mixed 4v4', cap: 8, pools: 0 }]),
      'Assumes Mixed 4v4 full at 8 teams.',
    );
  });

  it('says nothing when there is nothing to assume', () => {
    assert.equal(provisionalAssumptionText([]), '');
  });
});
