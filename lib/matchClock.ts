/* ── The match clock ──────────────────────────────────────────────
 *
 * One match has one duration. It runs from the first point — stamped
 * into the live state server-side as `startedAt` — so the referee's
 * scorekeeper and the organizer's court board read the same number, and
 * reloading either tab doesn't restart it.
 */

/** Seconds elapsed since the match started, or null before the first point. */
export function elapsedSeconds(startedAt: number | null | undefined, now: number): number | null {
  if (!startedAt) return null;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** mm:ss, rolling over to h:mm:ss once a match passes the hour. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
