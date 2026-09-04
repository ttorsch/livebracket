// Unit tests for which two courts the homepage hero card is showing.
//
// Run with:  npm test
//
// The rules here are the ones a reader notices and can't articulate: a
// court that stays put while its neighbour changes, a card that doesn't
// repaint faster than it can be read. They depend on a running tournament,
// a live Redis and a referee tapping a screen, so they are asserted
// directly rather than through the page.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  nextSlots,
  EMPTY_SLOTS,
  SLOT_DWELL_MS,
  type HeroLiveMatch,
  type SlotState,
} from './heroLive.ts';

/* A court, reduced to the three fields the slot rules read. */
function court(
  id: string,
  updatedAt: number | null,
  slug = 'khao-lak'
): HeroLiveMatch {
  return {
    matchId: id,
    tournamentSlug: slug,
    tournamentTitle: slug,
    location: '',
    dateLabel: '',
    court: id,
    division: '',
    round: '',
    status: updatedAt === null ? 'upcoming' : 'live',
    startTime: '',
    teamA: { name: 'A', players: [] },
    teamB: { name: 'B', players: [] },
    sets: [],
    pointsA: 0,
    pointsB: 0,
    lastScorer: null,
    updatedAt,
  };
}

/* Places two courts and backdates their arrival, so a test can ask what
 * happens once the dwell has passed without waiting for it. */
function settled(ids: [string, string], slug = 'khao-lak'): SlotState {
  return { slug, ids: [...ids], since: [0, 0] };
}

const LATER = SLOT_DWELL_MS * 10;

describe('nextSlots', () => {
  it('fills both slots hottest first when the card is empty', () => {
    const s = nextSlots(EMPTY_SLOTS, [court('c1', 100), court('c2', 300)], LATER);
    assert.deepEqual(s.ids, ['c2', 'c1']);
    assert.equal(s.slug, 'khao-lak');
  });

  it('leaves a court where it is when its neighbour becomes hotter', () => {
    // The whole point of the slot rules: c1 is on top, c2 scores and
    // overtakes it, and nothing moves — only the score changes.
    const prev = settled(['c1', 'c2']);
    const s = nextSlots(prev, [court('c1', 100), court('c2', 900)], LATER);
    assert.deepEqual(s.ids, ['c1', 'c2']);
  });

  it('gives the vacated slot to the newcomer, not the survivor', () => {
    // c1 goes cold and c5 takes its slot; c2 never moves.
    const prev = settled(['c1', 'c2']);
    const s = nextSlots(
      prev,
      [court('c1', 100), court('c2', 500), court('c5', 900)],
      LATER
    );
    assert.deepEqual(s.ids, ['c5', 'c2']);
  });

  it('holds a court that has only just arrived', () => {
    const prev: SlotState = { slug: 'khao-lak', ids: ['c1', 'c2'], since: [0, LATER] };
    const s = nextSlots(
      prev,
      [court('c1', 100), court('c2', 200), court('c5', 900)],
      LATER + 1_000
    );
    // c2 is colder than c5 but arrived a second ago, so it stays; c1 is
    // the one that has been there long enough to be replaced.
    assert.deepEqual(s.ids, ['c5', 'c2']);
  });

  it('stamps an arrival only for the slot that changed', () => {
    const prev = settled(['c1', 'c2']);
    const s = nextSlots(
      prev,
      [court('c1', 100), court('c2', 500), court('c5', 900)],
      LATER
    );
    assert.equal(s.since[0], LATER, 'c5 just arrived');
    assert.equal(s.since[1], 0, 'c2 never moved');
  });

  it('never mixes two tournaments under one photo', () => {
    const s = nextSlots(
      EMPTY_SLOTS,
      [court('a1', 900, 'alpha'), court('b1', 800, 'beta'), court('a2', 100, 'alpha')],
      LATER
    );
    assert.equal(s.slug, 'alpha');
    assert.deepEqual(s.ids, ['a1', 'a2']);
  });

  it('follows the action to another tournament once the dwell has passed', () => {
    const prev = settled(['a1', 'a2'], 'alpha');
    const s = nextSlots(
      prev,
      [court('a1', 100, 'alpha'), court('a2', 200, 'alpha'), court('b1', 900, 'beta')],
      LATER
    );
    assert.equal(s.slug, 'beta');
    assert.deepEqual(s.ids, ['b1', null]);
  });

  it('will not be yanked to another tournament mid-glance', () => {
    const prev: SlotState = { slug: 'alpha', ids: ['a1', 'a2'], since: [LATER, LATER] };
    const s = nextSlots(
      prev,
      [court('a1', 100, 'alpha'), court('a2', 200, 'alpha'), court('b1', 900, 'beta')],
      LATER + 1_000
    );
    assert.equal(s.slug, 'alpha');
    assert.deepEqual(s.ids, ['a1', 'a2']);
  });

  it('evicts a court from a finished tournament even inside its dwell', () => {
    // Dwell protects a reader's eye, not a wrong caption: alpha is gone
    // from the feed, so its courts cannot stay under beta's photo.
    const prev: SlotState = { slug: 'alpha', ids: ['a1', 'a2'], since: [LATER, LATER] };
    const s = nextSlots(prev, [court('b1', 900, 'beta')], LATER + 1_000);
    assert.equal(s.slug, 'beta');
    assert.deepEqual(s.ids, ['b1', null]);
  });

  it('sorts courts yet to start behind every court in play', () => {
    const s = nextSlots(EMPTY_SLOTS, [court('c1', null), court('c2', 100)], LATER);
    assert.deepEqual(s.ids, ['c2', 'c1']);
  });

  it('holds one court alone rather than padding the pair', () => {
    const s = nextSlots(EMPTY_SLOTS, [court('c1', 100)], LATER);
    assert.deepEqual(s.ids, ['c1', null]);
  });

  it('empties the card when the feed does', () => {
    assert.deepEqual(nextSlots(settled(['c1', 'c2']), [], LATER), EMPTY_SLOTS);
  });

  it('sits still while nobody scores', () => {
    const prev = settled(['c1', 'c2']);
    const matches = [court('c1', 100), court('c2', 500)];
    const first = nextSlots(prev, matches, LATER);
    const second = nextSlots(first, matches, LATER * 2);
    assert.deepEqual(second.ids, first.ids);
    assert.deepEqual(second.since, first.since);
  });
});
