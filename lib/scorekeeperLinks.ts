/* ── Scorekeeper link rows, shared by every surface that shows them ──
 *
 * The organizer sees the same match-to-QR mapping in three places: the
 * live court board, the per-tournament QR panel, and the printed sheet.
 * The grouping rules live here so those three can't drift apart — and so
 * the two on-screen surfaces don't have to pull in jsPDF just to agree on
 * what "the next match on this court" means.
 */

/** One row as returned by GET /api/tournaments/[slug]/scorekeeper. */
export interface ScorekeeperLinkRow {
  matchId: string;
  token: string;
  court: string | null;
  time: string | null;
  status: 'upcoming' | 'live' | 'done';
  division: string;
  round: string;
  teamA: string;
  teamB: string;
}

export const UNASSIGNED_COURT = 'Court not assigned';

export const timeLabel = (iso: string | null) => {
  if (!iso) return 'Unscheduled';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unscheduled';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/* Courts sort the way they're numbered, not the way they're spelled, so
 * "Court 10" lands after "Court 2". Matches with no court go last — they
 * still need codes, they just can't be taped anywhere yet. */
export function sortCourts(courts: string[]): string[] {
  return [...courts].sort((a, b) => {
    if (a === UNASSIGNED_COURT) return 1;
    if (b === UNASSIGNED_COURT) return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const byCourt = (matches: ScorekeeperLinkRow[]) =>
  matches.reduce<Record<string, ScorekeeperLinkRow[]>>((acc, m) => {
    (acc[m.court ?? UNASSIGNED_COURT] ||= []).push(m);
    return acc;
  }, {});

const byTime = (a: ScorekeeperLinkRow, b: ScorekeeperLinkRow) => {
  if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time);
  if (a.time && !b.time) return -1;
  if (!a.time && b.time) return 1;
  return a.teamA.localeCompare(b.teamA);
};

/* One match per court: the one that court needs a scoring link for *right
 * now*. A court's whole day is a dozen codes, and showing them all buries
 * the one the referee standing there actually wants. */
export function nextPerCourt(matches: ScorekeeperLinkRow[]): [string, ScorekeeperLinkRow][] {
  const groups = byCourt(matches);
  return sortCourts(Object.keys(groups))
    .map(court => {
      const list = groups[court];
      // A match already in progress outranks the clock: that referee needs
      // the link now. Otherwise it's the earliest one still to be played.
      const live = list.find(m => m.status === 'live');
      const upcoming = list.filter(m => m.status === 'upcoming').sort(byTime)[0];
      return [court, live ?? upcoming] as [string, ScorekeeperLinkRow];
    })
    .filter(([, m]) => Boolean(m));
}

/** Every match, grouped by court, each court in chronological order.
 *
 * The API sorts live-first because the on-screen surfaces want the urgent
 * link at the top. A printed sheet wants the opposite: read it in the
 * order the day is played. */
export function groupByCourt(matches: ScorekeeperLinkRow[]): [string, ScorekeeperLinkRow[]][] {
  const groups = byCourt(matches);
  return sortCourts(Object.keys(groups)).map(
    court => [court, [...groups[court]].sort(byTime)] as [string, ScorekeeperLinkRow[]],
  );
}
