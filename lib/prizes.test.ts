// Unit tests for per-division prize money.
//
// Run with:  npm test
//
// The reason this has tests at all is the legacy path. Prize money used to be
// one free-text string per division, buried in an advanced panel, and some
// divisions still carry it. Every one of those must keep rendering exactly
// what its organizer typed — silently dropping an already-published payout is
// worse than never having had the field.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  readPrizes, toStoredPrizes, prizeTotal, hasPrizes, prizeSummary,
  tournamentPrizeLabel, defaultPlacings, emptyPrizes,
} from './prizes.ts';

describe('readPrizes', () => {
  it('reads a stored payout table', () => {
    const prizes = readPrizes({
      prizes: [
        { place: '1st', amount: 50000, note: '+ trophy' },
        { place: '2nd', amount: 30000, note: '' },
      ],
      prizeNote: 'Paid at the closing ceremony.',
    });
    assert.equal(prizes.placings.length, 2);
    assert.deepEqual(prizes.placings[0], { place: '1st', amount: 50000, note: '+ trophy' });
    assert.equal(prizes.note, 'Paid at the closing ceremony.');
  });

  it('carries a legacy prizePool string through as the note', () => {
    const prizes = readPrizes({ prizePool: 'Cash 1st: 50%, 2nd: 30%, 3rd: 20%' });
    assert.deepEqual(prizes.placings, []);
    assert.equal(prizes.note, 'Cash 1st: 50%, 2nd: 30%, 3rd: 20%');
    // It still counts as something to show a player, which is what keeps the
    // public page off its "to be announced" empty state.
    assert.equal(hasPrizes(prizes), true);
  });

  it('ignores a legacy string once a table has been saved over it', () => {
    const prizes = readPrizes({
      prizePool: 'the old text',
      prizes: [{ place: '1st', amount: 1000, note: '' }],
      prizeNote: '',
    });
    assert.equal(prizes.note, '');
    assert.equal(prizes.placings.length, 1);
  });

  it('gives empty prizes for a division that has never set any', () => {
    assert.deepEqual(readPrizes({}), emptyPrizes());
    assert.deepEqual(readPrizes(null), emptyPrizes());
    assert.equal(hasPrizes(readPrizes({ prizePool: '   ' })), false);
  });

  it('drops rows nobody could read and refuses negative money', () => {
    const prizes = readPrizes({
      prizes: [
        { place: '', amount: 9999, note: 'unlabelled' },
        { place: '1st', amount: -500, note: '' },
        { place: '2nd', amount: 1000.6, note: '' },
        'not an object',
        null,
      ],
    });
    assert.deepEqual(prizes.placings, [
      { place: '1st', amount: 0, note: '' },
      { place: '2nd', amount: 1001, note: '' },
    ]);
  });

  it('caps how many placings a division can store', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ place: `P${i}`, amount: 1, note: '' }));
    assert.equal(readPrizes({ prizes: many }).placings.length, 12);
  });
});

describe('toStoredPrizes', () => {
  it('trims and drops blank rows on the way to the database', () => {
    const stored = toStoredPrizes({
      placings: [
        { place: ' 1st ', amount: 5000, note: '  + 2 nights  ' },
        { place: '', amount: 0, note: '' },
      ],
      note: '  Cash only.  ',
    });
    assert.deepEqual(stored.prizes, [{ place: '1st', amount: 5000, note: '+ 2 nights' }]);
    assert.equal(stored.prizeNote, 'Cash only.');
  });

  it('round-trips through readPrizes unchanged', () => {
    const written = toStoredPrizes({
      placings: [{ place: '1st', amount: 5000, note: '' }],
      note: 'Cash only.',
    });
    const read = readPrizes(written as unknown as Record<string, unknown>);
    assert.deepEqual(read.placings, written.prizes);
    assert.equal(read.note, written.prizeNote);
  });

  it('stores the editor default as nothing at all', () => {
    // The editor opens on an empty podium; saving without typing an amount
    // must not advertise a ฿0 first place.
    const stored = toStoredPrizes({ placings: defaultPlacings(), note: '' });
    assert.equal(prizeTotal(readPrizes(stored as unknown as Record<string, unknown>)), 0);
  });
});

describe('prizeTotal and prizeSummary', () => {
  it('adds up only the cash', () => {
    const prizes = readPrizes({
      prizes: [
        { place: '1st', amount: 50000, note: '' },
        { place: '2nd', amount: 30000, note: '' },
        { place: 'Best Spiker', amount: 0, note: 'Trophy' },
      ],
    });
    assert.equal(prizeTotal(prizes), 80000);
    assert.equal(prizeSummary(prizes, 'THB'), '฿80,000 in prizes');
  });

  it('says prizes exist without a figure when none of them are cash', () => {
    const prizes = readPrizes({ prizes: [{ place: '1st', amount: 0, note: 'Trophy' }] });
    assert.equal(prizeSummary(prizes, 'THB'), 'Prizes awarded');
  });

  it('says nothing at all when there are no prizes', () => {
    assert.equal(prizeSummary(emptyPrizes(), 'THB'), null);
  });
});

describe('tournamentPrizeLabel', () => {
  it('is silent when no division pays out', () => {
    assert.equal(tournamentPrizeLabel([]), null);
    assert.equal(tournamentPrizeLabel([{ prizeTotal: 0, currency: 'THB' }]), null);
  });

  it('adds up divisions sharing a currency', () => {
    assert.equal(
      tournamentPrizeLabel([
        { prizeTotal: 80000, currency: 'THB' },
        { prizeTotal: 40000, currency: 'THB' },
        { prizeTotal: 0, currency: 'THB' },
      ]),
      '฿120,000',
    );
  });

  it('refuses to add different currencies into one false number', () => {
    assert.equal(
      tournamentPrizeLabel([
        { prizeTotal: 80000, currency: 'THB' },
        { prizeTotal: 2000, currency: 'USD' },
      ]),
      'Prize money',
    );
  });

  it('ignores the currency of divisions paying nothing', () => {
    // A USD division with no prize money must not turn a baht event into the
    // vague "Prize money" label.
    assert.equal(
      tournamentPrizeLabel([
        { prizeTotal: 80000, currency: 'THB' },
        { prizeTotal: 0, currency: 'USD' },
      ]),
      '฿80,000',
    );
  });
});
