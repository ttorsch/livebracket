// Unit tests for the tournament lifecycle.
//
// Run with:  npm test
//
// Registration is derived from each division's own dates rather than set by
// hand, which means these functions decide whether a player can enter an
// event. A wrong answer here reads as a perfectly normal page — an open
// tournament that refuses entries, or a closed one still taking money — so
// the boundaries are asserted directly.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  PHASE,
  selectablePhases,
  isPublic,
  divisionRegistrationState,
  registrationState,
  nextOpening,
  registrationCloseDefault,
  getDivisionLifecycleStage,
  getPlayerActionBadge,
  getOrganizerDivisionBadge,
  type DivisionWindow,
} from './tournamentLifecycle.ts';

const win = (opens = '', closes = ''): DivisionWindow => ({
  registrationOpens: opens,
  registrationCloses: closes,
});

const at = (iso: string) => new Date(iso);

describe('selectablePhases', () => {
  it('offers only draft and announced', () => {
    assert.deepEqual(selectablePhases(PHASE.draft), [1, 2]);
    assert.deepEqual(selectablePhases(PHASE.announced), [1, 2]);
  });

  it('keeps a legacy phase available so the row can be normalised', () => {
    // Rows created before registration became date-driven still carry 3/4;
    // the field must be able to show what it currently is.
    assert.deepEqual(selectablePhases(PHASE.open), [1, 2, 3]);
    assert.deepEqual(selectablePhases(PHASE.closed), [1, 2, 4]);
  });
});

describe('isPublic', () => {
  it('hides a draft and shows everything else', () => {
    assert.equal(isPublic(PHASE.draft), false);
    assert.equal(isPublic(PHASE.announced), true);
    assert.equal(isPublic(PHASE.open), true);
    assert.equal(isPublic(PHASE.closed), true);
  });
});

describe('divisionRegistrationState', () => {
  it('treats an empty open date as open now', () => {
    assert.equal(divisionRegistrationState(win(), at('2026-08-12T10:00:00Z')), 'open');
  });

  it('waits for an open date that has not arrived', () => {
    const d = win('2026-09-01T09:00');
    assert.equal(divisionRegistrationState(d, at('2026-08-12T10:00:00Z')), 'opens-soon');
    assert.equal(divisionRegistrationState(d, at('2026-09-01T09:30:00Z')), 'open');
  });

  it('stays open through the whole of the closing day', () => {
    // Closing on the 26th means the 26th is still a day you can enter.
    const d = win('', '2026-09-26');
    assert.equal(divisionRegistrationState(d, at('2026-09-26T23:59:00Z')), 'open');
    assert.equal(divisionRegistrationState(d, at('2026-09-27T00:00:00Z')), 'closed');
  });

  it('reads as closed when the dates are the wrong way round', () => {
    // Closes before it opens: shut, not open forever.
    const d = win('2026-10-01T09:00', '2026-09-01');
    assert.equal(divisionRegistrationState(d, at('2026-09-15T10:00:00Z')), 'closed');
  });

  it('never closes when no close date is set', () => {
    assert.equal(divisionRegistrationState(win('', ''), at('2030-01-01T00:00:00Z')), 'open');
  });
});

describe('registrationState', () => {
  const now = at('2026-09-15T10:00:00Z');

  it('is null when there is nothing to register for', () => {
    assert.equal(registrationState([], now), null);
  });

  it('is open if any single division is taking teams', () => {
    const divs = [win('', '2026-09-01'), win()];
    assert.equal(registrationState(divs, now), 'open');
  });

  it('is opening soon only when none are open yet', () => {
    assert.equal(registrationState([win('2026-10-01T09:00'), win('2026-11-01T09:00')], now), 'opens-soon');
  });

  it('is closed once every division has shut', () => {
    assert.equal(registrationState([win('', '2026-09-01'), win('', '2026-09-10')], now), 'closed');
  });
});

describe('nextOpening', () => {
  it('returns the earliest division still to open', () => {
    const now = at('2026-09-15T10:00:00Z');
    const d = nextOpening([win('2026-11-01T09:00'), win('2026-10-01T09:00')], now);
    assert.equal(d?.toISOString().slice(0, 10), '2026-10-01');
  });

  it('returns nothing when everything is already open or closed', () => {
    assert.equal(nextOpening([win()], at('2026-09-15T10:00:00Z')), null);
  });
});

describe('registrationCloseDefault', () => {
  it('lands a week before the tournament', () => {
    assert.equal(registrationCloseDefault('2026-10-03'), '2026-09-26');
  });

  it('crosses a month boundary correctly', () => {
    assert.equal(registrationCloseDefault('2026-03-04'), '2026-02-25');
  });

  it('gives nothing for an unusable start date', () => {
    assert.equal(registrationCloseDefault(''), '');
    assert.equal(registrationCloseDefault(null), '');
  });
});

describe('getDivisionLifecycleStage and Badges', () => {
  const now = at('2026-09-15T12:00:00Z');

  it('identifies upcoming division when open date is in future', () => {
    const d = { name: "Men's Open", cap: 8, filled: 0, registrationOpens: '2026-09-20T09:00:00Z' };
    assert.equal(getDivisionLifecycleStage(d, now), 'upcoming');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Opens Sep 20', variant: 'status' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: 'Registration Upcoming', variant: 'status' });
  });

  it('identifies open division taking entries', () => {
    const d = { name: "Men's Open", cap: 8, filled: 3, registrationOpens: '2026-09-01T09:00:00Z', registrationCloses: '2026-09-25' };
    assert.equal(getDivisionLifecycleStage(d, now), 'registration-open');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Register Now', variant: 'open' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: '3/8 Registered', variant: 'open' });
  });

  it('identifies full division with waitlist open', () => {
    const d = { name: "Men's Open", cap: 8, filled: 8, registrationOpens: '2026-09-01T09:00:00Z', registrationCloses: '2026-09-25' };
    assert.equal(getDivisionLifecycleStage(d, now), 'waitlist-open');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Join Waitlist', variant: 'highlight' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: 'Full (8/8) · Waitlist', variant: 'highlight' });
  });

  it('identifies closed division past deadline', () => {
    const d = { name: "Men's Open", cap: 8, filled: 6, registrationOpens: '2026-09-01T09:00:00Z', registrationCloses: '2026-09-10' };
    assert.equal(getDivisionLifecycleStage(d, now), 'registration-closed');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Registration Closed', variant: 'status' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: 'Closed (6/8)', variant: 'status' });
  });

  it('identifies draw-locked stage', () => {
    const d = { name: "Men's Open", cap: 8, filled: 8, isDrawLocked: true };
    assert.equal(getDivisionLifecycleStage(d, now), 'draw-locked');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Bracket View', variant: 'highlight' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: 'Draw Locked', variant: 'highlight' });
  });

  it('identifies in-progress stage when matches are being scored', () => {
    const d = { name: "Men's Open", cap: 8, filled: 8, isDrawLocked: true, inProgressMatches: 2, totalMatches: 12, completedMatches: 3 };
    assert.equal(getDivisionLifecycleStage(d, now), 'in-progress');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Live Scores', variant: 'live' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: 'Live Playing', variant: 'live' });
  });

  it('identifies completed stage when all matches are scored', () => {
    const d = { name: "Men's Open", cap: 8, filled: 8, isDrawLocked: true, totalMatches: 12, completedMatches: 12 };
    assert.equal(getDivisionLifecycleStage(d, now), 'completed');
    assert.deepEqual(getPlayerActionBadge(d, now), { label: 'Results', variant: 'status' });
    assert.deepEqual(getOrganizerDivisionBadge(d, now), { label: 'Completed', variant: 'status' });
  });
});

