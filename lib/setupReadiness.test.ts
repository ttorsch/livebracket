// Unit tests for the setup readiness checklist.
//
// Run with:  npm test
//
// The checklist is the organizer's answer to "is this thing ready to run?",
// so a wrong tick is worse than no checklist at all — it says the schedule
// is laid out when no match has a court, or that the money is in when
// nobody has registered. The generous-looking edges are pinned here.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  computeReadiness,
  type ReadinessInput,
  type ReadinessDivision,
  type ReadinessKey,
} from './setupReadiness.ts';

const div = (over: Partial<ReadinessDivision> = {}): ReadinessDivision => ({
  name: 'Women',
  cap: 8,
  confirmed: 8,
  unpaid: 0,
  drawLocked: true,
  ...over,
});

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  title: 'Khao Lak Open 2026',
  location: 'Memories Beach, Khao Lak',
  startDate: '2026-08-18',
  dateLabel: 'Aug 18–19, 2026',
  divisions: [div()],
  courtCount: 3,
  totalMatches: 12,
  placedMatches: 12,
  firstMatchLabel: 'Aug 18, 09:00',
  ...over,
});

const item = (i: ReadinessInput, key: ReadinessKey) => {
  const found = computeReadiness(i, 'khao-lak-open-2026').items.find(x => x.key === key);
  assert.ok(found, `no ${key} item`);
  return found;
};

describe('a fully ready tournament', () => {
  it('ticks all six', () => {
    const r = computeReadiness(input(), 'slug');
    assert.equal(r.doneCount, 6);
    assert.equal(r.total, 6);
    assert.equal(r.pct, 100);
    assert.equal(r.progressLabel, '6 of 6 complete');
    assert.equal(r.nextStep, null);
  });
});

describe('tournament details', () => {
  it('needs a title, a location and a date', () => {
    assert.equal(item(input(), 'details').done, true);
    assert.equal(item(input({ title: '   ' }), 'details').done, false);
    assert.equal(item(input({ location: '' }), 'details').done, false);
    assert.equal(item(input({ startDate: '' }), 'details').done, false);
  });
});

describe('divisions', () => {
  it('is outstanding when there are none', () => {
    const it0 = item(input({ divisions: [] }), 'divisions');
    assert.equal(it0.done, false);
    assert.equal(it0.note, 'No divisions yet');
  });

  it('lists them by name once they exist', () => {
    const i = input({ divisions: [div({ name: 'Women' }), div({ name: 'Men' })] });
    assert.equal(item(i, 'divisions').note, 'Women, Men');
  });
});

describe('teams registered', () => {
  it('needs every division at its cap, not just one', () => {
    const i = input({ divisions: [div({ confirmed: 8 }), div({ name: 'Men', confirmed: 5 })] });
    const t = item(i, 'teams');
    assert.equal(t.done, false);
    assert.equal(t.note, '13 of 16 seats filled');
  });

  it('counts an over-full division as full', () => {
    assert.equal(item(input({ divisions: [div({ confirmed: 9, cap: 8 })] }), 'teams').done, true);
  });

  it('is not done when there are no divisions at all', () => {
    // No seats to fill is not the same as every seat filled.
    assert.equal(item(input({ divisions: [] }), 'teams').done, false);
  });
});

describe('payments collected', () => {
  it('is outstanding while any seated team has not paid', () => {
    const p = item(input({ divisions: [div({ unpaid: 2 })] }), 'payments');
    assert.equal(p.done, false);
    assert.equal(p.note, '2 teams unpaid');
  });

  it('says one team in the singular', () => {
    assert.equal(item(input({ divisions: [div({ unpaid: 1 })] }), 'payments').note, '1 team unpaid');
  });

  it('is NOT done when nobody has registered', () => {
    // Zero unpaid out of zero teams is not "payments collected".
    const p = item(input({ divisions: [div({ confirmed: 0, unpaid: 0 })] }), 'payments');
    assert.equal(p.done, false);
    assert.equal(p.note, 'No teams registered yet');
  });
});

describe('courts & schedule', () => {
  it('needs courts and every match placed', () => {
    assert.equal(item(input(), 'schedule').done, true);
    assert.equal(item(input({ courtCount: 0 }), 'schedule').done, false);
    assert.equal(item(input({ placedMatches: 11 }), 'schedule').done, false);
  });

  it('is not done when no match has been drawn', () => {
    const s = item(input({ totalMatches: 0, placedMatches: 0 }), 'schedule');
    assert.equal(s.done, false);
    assert.equal(s.note, 'No matches drawn yet');
  });

  it('reports how far along the placement is', () => {
    assert.equal(item(input({ placedMatches: 4 }), 'schedule').note, '4 of 12 matches placed');
  });

  it('names the courts and first slot once done', () => {
    assert.equal(item(input(), 'schedule').note, '3 courts · Aug 18, 09:00');
  });

  it('offers a link to the schedule page while outstanding', () => {
    const s = computeReadiness(input({ placedMatches: 0 }), 'my-event')
      .items.find(x => x.key === 'schedule');
    assert.equal(s?.actionLabel, 'Set courts');
    assert.equal(s?.actionHref, '/dashboard/tournament/my-event/schedule');
  });

  it('drops the action once done', () => {
    assert.equal(item(input(), 'schedule').actionLabel, undefined);
  });
});

describe('bracket published', () => {
  it('needs a locked draw in every division', () => {
    const i = input({ divisions: [div({ drawLocked: true }), div({ name: 'Men', drawLocked: false })] });
    const p = item(i, 'published');
    assert.equal(p.done, false);
    assert.equal(p.note, '1 of 2 draws locked');
  });

  it('is done when they are all locked', () => {
    assert.equal(item(input(), 'published').note, 'Draw locked in every division');
  });
});

describe('progress', () => {
  it('names the first outstanding step', () => {
    const r = computeReadiness(input({ divisions: [div({ unpaid: 3 })] }), 'slug');
    assert.equal(r.nextStep, 'Payments collected');
  });

  it('rounds the percentage to a whole number', () => {
    // A tournament with nothing but its details filled in: no divisions, so
    // no matches to draw or place either.
    const r = computeReadiness(
      input({ divisions: [], totalMatches: 0, placedMatches: 0, firstMatchLabel: null }),
      'slug',
    );
    assert.equal(r.doneCount, 1);
    assert.equal(r.pct, 17);
  });
});
