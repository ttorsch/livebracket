import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signInDestination, safeNext, isOrganizerPath } from './authRedirect.ts';

describe('safeNext', () => {
  test('keeps a same-origin path', () => {
    assert.equal(safeNext('/tournament/abc'), '/tournament/abc');
  });

  test('refuses another host disguised as a path', () => {
    assert.equal(safeNext('//evil.example/steal'), null);
  });

  test('refuses an absolute URL', () => {
    assert.equal(safeNext('https://evil.example'), null);
  });

  test('refuses auth surfaces, which would loop', () => {
    assert.equal(safeNext('/login'), null);
    assert.equal(safeNext('/login?role=player'), null);
    assert.equal(safeNext('/auth/callback'), null);
    assert.equal(safeNext('/reset-password'), null);
  });

  test('handles missing values', () => {
    assert.equal(safeNext(null), null);
    assert.equal(safeNext(''), null);
  });
});

describe('isOrganizerPath', () => {
  test('matches the dashboard and its children', () => {
    assert.equal(isOrganizerPath('/dashboard'), true);
    assert.equal(isOrganizerPath('/dashboard/tournament/x'), true);
  });

  test('does not match a lookalike prefix', () => {
    assert.equal(isOrganizerPath('/dashboards-public'), false);
    assert.equal(isOrganizerPath('/profile'), false);
  });
});

describe('signInDestination — organizer', () => {
  /* The regression this was written for: "Sign in" on the homepage attaches
   * next=/, the visitor switches to the Organizer tab, and used to land
   * back on the homepage instead of their dashboard. */
  test('ignores a public-page next and goes to the dashboard', () => {
    assert.equal(signInDestination('organizer', '/'), '/dashboard');
    assert.equal(signInDestination('organizer', '/tournament/sideout'), '/dashboard');
  });

  test('with no next at all, goes to the dashboard', () => {
    assert.equal(signInDestination('organizer', null), '/dashboard');
  });

  test('keeps a next that is already inside the dashboard', () => {
    assert.equal(
      signInDestination('organizer', '/dashboard/tournament/sideout/schedule'),
      '/dashboard/tournament/sideout/schedule'
    );
  });

  test('never follows a hostile next', () => {
    assert.equal(signInDestination('organizer', '//evil.example'), '/dashboard');
  });
});

describe('signInDestination — player', () => {
  test('returns to the page they were reading', () => {
    assert.equal(signInDestination('player', '/tournament/sideout'), '/tournament/sideout');
    assert.equal(
      signInDestination('player', '/tournament/sideout/register'),
      '/tournament/sideout/register'
    );
    assert.equal(signInDestination('player', '/'), '/');
  });

  test('falls back to the profile with no next', () => {
    assert.equal(signInDestination('player', null), '/profile');
  });

  test('drops a dashboard next it could not use anyway', () => {
    assert.equal(signInDestination('player', '/dashboard'), '/profile');
  });

  test('never follows a hostile next', () => {
    assert.equal(signInDestination('player', '//evil.example'), '/profile');
  });
});
