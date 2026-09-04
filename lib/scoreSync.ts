/* ── Keeping one match's score straight across devices ────────────
 *
 * Two things go wrong once a scorekeeper link can be opened more than once,
 * and both of them lose points — the one outcome this screen must never have.
 *
 *   1. Two devices score at the same time. Each pushes whole state, so the
 *      slower one silently erases the faster one's points.
 *   2. A device goes offline mid-match. Its points exist nowhere but the
 *      device, and the battery is what decides whether they survive.
 *
 * The answers are ownership (one device scores, the rest follow) and a
 * retry queue that outlives the tab. The decisions for both live here,
 * free of React and of Redis, so they can be tested directly.
 */

export interface Tally {
  sets: { a: number; b: number }[];
  a: number;
  b: number;
}

/* ── Ownership ────────────────────────────────────────────────────
 *
 * A match is owned by the device that last claimed it. An unclaimed match
 * — nobody has scored yet — is open to whoever taps first, so the ordinary
 * one-phone case never has to think about any of this. */
export type ScoringRole = 'owner' | 'follower' | 'unclaimed';

export function scoringRole(owner: string | null | undefined, deviceId: string): ScoringRole {
  if (!owner) return 'unclaimed';
  return owner === deviceId ? 'owner' : 'follower';
}

/** Whether this device may push a score. A follower may not — it has to
 *  take over first, which is a deliberate tap rather than a side effect of
 *  opening the link. */
export function canScore(role: ScoringRole): boolean {
  return role !== 'follower';
}

/* ── Retry ────────────────────────────────────────────────────────
 *
 * Exponential, capped. Deterministic on purpose: there is at most one
 * device pushing a given match, so there is no herd to scatter, and a
 * predictable delay is one less thing to reason about at the net. */
export function retryDelay(attempt: number, base = 1000, cap = 15000): number {
  if (attempt <= 0) return base;
  return Math.min(base * 2 ** attempt, cap);
}

/* ── Recovering a device's own unsynced points ────────────────────
 *
 * What the tab could not push is kept in localStorage, so a crash, a reload
 * or a flat battery does not take the score with it. On the way back in,
 * the question is which copy is further along.
 *
 * `updatedAt` decides it, not the score itself: a referee correcting a
 * mis-tap makes the newer copy *lower*, and "further along" measured in
 * points would throw that correction away. The comparison that matters is
 * the same device against its own earlier push, so one clock is reading
 * against itself and drift between devices never enters into it.
 *
 * Ties go to the server. If both stamps match, the server already has this
 * state and restoring is a no-op that risks re-pushing stale numbers. */
export function shouldRestoreLocal(
  local: { updatedAt: number } | null | undefined,
  server: { updatedAt?: number } | null | undefined
): boolean {
  if (!local || typeof local.updatedAt !== 'number') return false;
  return local.updatedAt > (server?.updatedAt ?? 0);
}

/** Total points on the board, used to describe a recovery to the referee
 *  ("12 points restored") rather than to decide one. */
export function totalPoints(t: Tally): number {
  const sets = t.sets ?? [];
  return sets.reduce((n, s) => n + (s?.a ?? 0) + (s?.b ?? 0), 0) + (t.a ?? 0) + (t.b ?? 0);
}
