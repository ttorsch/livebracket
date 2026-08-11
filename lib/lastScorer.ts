/* ── Which side won the most recent point ─────────────────────────
 *
 * The scorekeeper sends whole state, not a delta — it has to, since the
 * referee can correct a score as well as add to it. So the side that just
 * scored is derived by diffing what arrived against what Redis held.
 *
 * Totals are summed across sets rather than compared per-set: when a set
 * closes, the current score resets to 0 and the finished set is appended,
 * which a per-set comparison would read as a large swing to whoever was
 * behind. Summed, that rollover is a no-op.
 */

export interface Tally {
  sets: { a: number; b: number }[];
  a: number;
  b: number;
}

const total = (t: Tally, side: 'a' | 'b') =>
  (t.sets ?? []).reduce((n, s) => n + (s?.[side] ?? 0), 0) + (t[side] ?? 0);

/** The side that won the point `next` represents, or `previous` when the
 *  change wasn't a point being won.
 *
 *  Only a gain moves the marker. Undoing a mis-tap leaves it on the side
 *  that actually scored last, which is what the board is still showing —
 *  and a correction that touches neither total leaves it alone entirely. */
export function deriveLastScorer(
  prev: (Tally & { lastScorer?: 'a' | 'b' | null }) | null | undefined,
  next: Tally
): 'a' | 'b' | null {
  const gainA = total(next, 'a') - (prev ? total(prev, 'a') : 0);
  const gainB = total(next, 'b') - (prev ? total(prev, 'b') : 0);

  if (gainA > gainB && gainA > 0) return 'a';
  if (gainB > gainA && gainB > 0) return 'b';
  return prev?.lastScorer ?? null;
}
