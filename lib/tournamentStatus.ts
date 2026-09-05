import {
  PHASE,
  isPublic,
  registrationState,
  isTournamentLiveDate,
  hasTournamentStarted,
  type Phase,
} from './tournamentLifecycle';

/* ── One tournament, one status ───────────────────────────────────
 *
 * Every surface that shows "where is this tournament up to" used to answer
 * the question itself: the homepage had statusLabels(), the organizer list
 * getTournamentStatus(), each dashboard page its own computeSingleStatus().
 * They disagreed — one read phase 3 as "Live" when phase 3 is registration
 * being open — and they wore different colours for the same word.
 *
 * This is the single answer. The key is what a badge colours itself by; the
 * label is what it says; `short` is the same thing for a narrow row.
 */

export type TournamentStatusKey =
  | 'draft'
  | 'announced'
  | 'open'
  | 'waitlist'
  | 'closed'
  | 'live'
  | 'completed'
  | 'cancelled'
  | 'archived';

export interface TournamentStatusInput {
  archived?: boolean | null;
  cancelled?: boolean | null;
  /** The phase an organizer set. Anything not public reads as a draft. */
  phase?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  /* Registration windows and seats, per division. The tournament's own
     status is the most open state any of its divisions is in. */
  divisions?: {
    registrationOpens?: string | null;
    registrationCloses?: string | null;
    cap?: number | null;
    filled?: number | null;
  }[] | null;
}

export interface TournamentStatus {
  key: TournamentStatusKey;
  label: string;
  short: string;
}

/* Play beats paperwork: a tournament being played today is Live whatever its
   registration windows say, and one whose last day has passed is Completed
   even if a window was left open behind it. */
export function tournamentStatus(
  t: TournamentStatusInput,
  now: Date = new Date(),
): TournamentStatus {
  if (t.archived) return { key: 'archived', label: 'Archived', short: 'Archived' };
  if (t.cancelled) return { key: 'cancelled', label: 'Cancelled', short: 'Cancelled' };

  // Not public yet — nobody outside the organizer's dashboard sees this one.
  if (t.phase === PHASE.draft || (t.phase != null && !isPublic(t.phase as Phase))) {
    return { key: 'draft', label: 'Draft', short: 'Draft' };
  }

  if (isTournamentLiveDate(t.startDate, t.endDate, now)) {
    return { key: 'live', label: 'Live Now', short: 'Live' };
  }
  // Started, but no longer inside its dates: the event is behind us.
  if (hasTournamentStarted(t.startDate, now)) {
    return { key: 'completed', label: 'Completed', short: 'Completed' };
  }

  const divisions = t.divisions ?? [];
  if (divisions.length === 0) {
    return { key: 'announced', label: 'Announced', short: 'Announced' };
  }

  const regState = registrationState(
    divisions.map(d => ({
      registrationOpens: d.registrationOpens || '',
      registrationCloses: d.registrationCloses || '',
    })),
    now,
  );

  if (regState === 'closed') {
    return { key: 'closed', label: 'Registration Closed', short: 'Closed' };
  }
  if (regState !== 'open') {
    // 'opens-soon', or no window set at all: announced and waiting.
    return { key: 'announced', label: 'Announced', short: 'Announced' };
  }

  const seated = divisions.filter(d => (d.cap ?? 0) > 0);
  const allFull = seated.length > 0 && seated.every(d => (d.filled ?? 0) >= (d.cap ?? 0));
  if (allFull) {
    return { key: 'waitlist', label: 'Waitlist Open', short: 'Waitlist' };
  }

  /* Kept from the homepage's own wording: an event past four fifths of its
     seats is still open, but it is worth saying it is going. */
  const fullest = seated.reduce(
    (max, d) => Math.max(max, (d.filled ?? 0) / (d.cap || 1)),
    0,
  );
  if (fullest >= 0.8) {
    return { key: 'open', label: 'Filling fast', short: 'Filling fast' };
  }

  return { key: 'open', label: 'Registration Open', short: 'Open' };
}
