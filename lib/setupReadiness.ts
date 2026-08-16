/* ── Setup readiness ──────────────────────────────────────────────
 *
 * The six things that have to be true before a tournament can actually be
 * run, read off real state rather than ticked off by hand. A checklist an
 * organizer can satisfy by clicking it is a checklist that lies, so every
 * item here is derived — the two that carry an action link send the
 * organizer to the page that changes the underlying thing.
 *
 * "Done" is deliberately strict in the two places it could be generous:
 * a tournament with no teams does not count as fully paid up, and courts
 * are not "set" until every drawn match actually has a time and a court.
 */

export interface ReadinessDivision {
  name: string;
  /** Team cap for the division. */
  cap: number;
  /** Teams holding a seat (i.e. not on the waiting list). */
  confirmed: number;
  /** Seated teams whose payment has not cleared. */
  unpaid: number;
  /** settings.draw.isLocked — the draw is final, not just generated. */
  drawLocked: boolean;
}

export interface ReadinessInput {
  title: string;
  location: string;
  startDate: string;
  /** Pre-formatted date range for the note, e.g. "Aug 18–19, 2026". */
  dateLabel: string;
  divisions: ReadinessDivision[];
  /** Courts available to schedule on — the explicit roster if there is
   *  one, otherwise the generic court count. */
  courtCount: number;
  totalMatches: number;
  /** Matches carrying both a scheduled time and a court. */
  placedMatches: number;
  /** Pre-formatted first match slot for the note, e.g. "Aug 18, 09:00". */
  firstMatchLabel: string | null;
}

export type ReadinessKey =
  | 'details' | 'divisions' | 'teams' | 'payments' | 'schedule' | 'published';

export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  note: string;
  done: boolean;
  /** Present only while the item is outstanding. */
  actionLabel?: string;
  /** Where the action goes. Omitted when the action opens something on this
   *  page rather than navigating — the setup page maps those by `key`. */
  actionHref?: string;
}

export interface Readiness {
  items: ReadinessItem[];
  doneCount: number;
  total: number;
  /** Whole percent, for the progress bar width. */
  pct: number;
  progressLabel: string;
  /** The first outstanding item's label, or null when everything is done. */
  nextStep: string | null;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function computeReadiness(input: ReadinessInput, slug: string): Readiness {
  const { divisions } = input;
  const hasDivisions = divisions.length > 0;

  const seats = divisions.reduce((s, d) => s + d.cap, 0);
  const filled = divisions.reduce((s, d) => s + d.confirmed, 0);
  const unpaid = divisions.reduce((s, d) => s + d.unpaid, 0);
  const lockedCount = divisions.filter(d => d.drawLocked).length;

  const detailsDone = !!(input.title.trim() && input.location.trim() && input.startDate);

  // Every division at or over its cap. An event with no divisions has no
  // seats to fill, which is not the same thing as being full.
  const teamsDone = hasDivisions && divisions.every(d => d.confirmed >= d.cap);

  // No outstanding payments — but only once somebody has actually
  // registered, otherwise an empty tournament reads as settled up.
  const paymentsDone = filled > 0 && unpaid === 0;

  // Strictest reading: courts to play on, and every drawn match given a
  // slot on one of them.
  const courtsAvailable = input.courtCount > 0;
  const allPlaced = input.totalMatches > 0 && input.placedMatches >= input.totalMatches;
  const scheduleDone = courtsAvailable && allPlaced;

  const publishedDone = hasDivisions && lockedCount === divisions.length;

  const items: ReadinessItem[] = [
    {
      key: 'details',
      label: 'Tournament details',
      note: detailsDone
        ? `${input.dateLabel} · ${input.location}`
        : 'Add a title, dates and location',
      done: detailsDone,
      // No href: this one opens the Edit Tournament dialog in place.
      ...(detailsDone ? {} : { actionLabel: 'Edit tournament' }),
    },
    {
      key: 'divisions',
      label: 'Divisions',
      note: hasDivisions ? divisions.map(d => d.name).join(', ') : 'No divisions yet',
      done: hasDivisions,
    },
    {
      key: 'teams',
      label: 'Teams registered',
      note: hasDivisions
        ? `${filled} of ${seats} seats filled`
        : 'Add a division first',
      done: teamsDone,
    },
    {
      key: 'payments',
      label: 'Payments collected',
      note: filled === 0
        ? 'No teams registered yet'
        : unpaid > 0
          ? `${plural(unpaid, 'team')} unpaid`
          : 'All teams paid',
      done: paymentsDone,
    },
    {
      key: 'schedule',
      label: 'Courts & schedule',
      note: scheduleDone
        ? `${plural(input.courtCount, 'court')}${input.firstMatchLabel ? ` · ${input.firstMatchLabel}` : ''}`
        : input.totalMatches === 0
          ? 'No matches drawn yet'
          : `${input.placedMatches} of ${input.totalMatches} matches placed`,
      done: scheduleDone,
      ...(scheduleDone
        ? {}
        : { actionLabel: 'Set courts', actionHref: `/dashboard/tournament/${slug}/schedule` }),
    },
    {
      key: 'published',
      label: 'Bracket published',
      note: publishedDone
        ? 'Draw locked in every division'
        : hasDivisions
          ? `${lockedCount} of ${divisions.length} draws locked`
          : 'Publish when the draw is set',
      done: publishedDone,
      ...(publishedDone
        ? {}
        : { actionLabel: 'Open bracket', actionHref: `/dashboard/tournament/${slug}` }),
    },
  ];

  const doneCount = items.filter(i => i.done).length;
  const next = items.find(i => !i.done);

  return {
    items,
    doneCount,
    total: items.length,
    pct: Math.round((doneCount / items.length) * 100),
    progressLabel: `${doneCount} of ${items.length} complete`,
    nextStep: next ? next.label : null,
  };
}
