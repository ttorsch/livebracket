import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskEmail, maskPhone } from './mask.ts';

/* These two decide what a stranger learns by clicking Edit on a team card
 * that is not theirs. The hint has to be recognisable to the person who
 * registered and useless to everyone else, so the tests below are as much
 * about what is *absent* from the output as what is in it. */

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    assert.equal(maskEmail('torsten@gmail.com'), 't••••••@gmail.com');
    assert.equal(maskEmail('apple_pt@hotmail.com'), 'a••••••@hotmail.com');
  });

  it('does not reveal the length of a long local part', () => {
    const short = maskEmail('abcdefg@x.com');
    const long = maskEmail('abcdefghijklmnop@x.com');
    assert.equal(short, long, 'two different addresses must mask identically once past the cap');
  });

  it('does not reveal the length of a very short local part', () => {
    // One letter plus three dots, not one letter plus nothing.
    assert.equal(maskEmail('a@x.com'), 'a•••@x.com');
    assert.equal(maskEmail('ab@x.com'), 'a•••@x.com');
  });

  it('never echoes the local part', () => {
    for (const address of ['secret@x.com', 'a.b.c@y.co.uk', 'UPPER@Z.com']) {
      const masked = maskEmail(address);
      const local = address.slice(0, address.lastIndexOf('@'));
      assert.ok(!masked.includes(local.slice(1)), `${masked} leaks ${local}`);
    }
  });

  it('handles addresses that are not addresses', () => {
    assert.equal(maskEmail(''), '••••');
    assert.equal(maskEmail('not-an-email'), '••••');
    assert.equal(maskEmail('@nolocal.com'), '••••');
  });

  it('trims before masking', () => {
    assert.equal(maskEmail('  torsten@gmail.com  '), 't••••••@gmail.com');
  });
});

describe('maskPhone', () => {
  it('keeps the last four digits, which is what people check against', () => {
    assert.equal(maskPhone('+66 81 301 031'), '••• ••• 1031');
    assert.equal(maskPhone('0812345678'), '••• ••• 5678');
  });

  it('ignores punctuation when finding the last four', () => {
    assert.equal(maskPhone('+66-81-234-5678'), maskPhone('+66 81 234 5678'));
  });

  it('reveals nothing for a number too short to mask', () => {
    assert.equal(maskPhone('123'), '••••');
    assert.equal(maskPhone(''), '••••');
  });
});
