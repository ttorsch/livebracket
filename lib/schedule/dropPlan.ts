/* Where a match goes when the organizer drops it, and what that does to the
 * matches around it.
 *
 * A court is one unbroken queue: matches sit one after another and two of them
 * can never share a minute. So a drop is an *insertion* rather than a free
 * placement — the match takes the start time of whatever it was dropped in
 * front of, and that match, with everything behind it on the court, moves later
 * by the length of the arrival. The court it came from closes over the hole it
 * left, so neither court is left with a gap nobody asked for.
 *
 * Lunch, blocked time and the end of the day are deliberately not consulted. A
 * push that lands on one of them is a problem the organizer can see and decide
 * about; silently refusing the drop, or hunting for the next free minute, would
 * both put the match somewhere they did not point at.
 */

/** Where a dropped match is going: in front of another match, onto the end of a
 *  court's run, or at a bare time (minutes since midnight) — the last being
 *  what dropping on empty calendar space means. */
export type DropTarget = { beforeId: string } | { append: true } | { time: number };

/** A match as the planner needs to see it. `start` is minutes since midnight,
 *  and null for a match that has not been given a time yet. */
export type Placement = {
  id: string;
  court: string;
  day: number;
  start: number | null;
  durationMinutes: number;
};

/** A match that has to move, and where to. */
export type PlannedMove = { id: string; court: string; day: number; start: number };

const durationOf = (p: { durationMinutes: number }) => Math.max(5, Math.trunc(p.durationMinutes) || 45);

/**
 * Plan a drop.
 *
 * @param placements Every match in the schedule, however it is currently placed.
 * @param matchId    The match being dropped.
 * @param court      The court it is being dropped on.
 * @param day        The day index it is being dropped on.
 * @param target     The point on that court it is being dropped at.
 * @param emptyStart The time to use when appending to a court that has nothing
 *                   on it yet — the start of the day, as far as the caller is
 *                   concerned.
 * @returns Every match that has to move, the dropped one included. Empty when
 *          the drop cannot be resolved, which is the caller's cue to do nothing.
 */
export function planDrop(
  placements: Placement[],
  matchId: string,
  court: string,
  day: number,
  target: DropTarget,
  emptyStart: number,
): PlannedMove[] {
  const moved = placements.find(p => p.id === matchId);
  if (!moved) return [];
  const dur = durationOf(moved);

  /* New start times so far, by match id. The dropped match itself is not in
     here — it is added once the drop point is known. */
  const moves = new Map<string, number>();

  /** A court's matches, earliest first, reading any move already decided. */
  const runOf = (c: string, d: number) =>
    placements
      .filter(p => p.id !== matchId && p.court === c && p.day === d && p.start != null)
      .map(p => ({ p, start: moves.get(p.id) ?? (p.start as number) }))
      .sort((a, b) => a.start - b.start);

  // 1. Lifting the match out closes the gap behind it: on the court it came
  //    from, everything that started after it comes forward by its length.
  if (moved.start != null) {
    for (const entry of runOf(moved.court, moved.day)) {
      if (entry.start >= moved.start) moves.set(entry.p.id, entry.start - dur);
    }
  }

  // 2. The destination is read *after* that gap closed. That is what makes
  //    moving a match further down its own court land it where the queue
  //    actually is, rather than where it was before the match was lifted.
  const dest = runOf(court, day);

  let start: number;
  if ('beforeId' in target) {
    const at = dest.find(entry => entry.p.id === target.beforeId);
    if (!at) return [];
    start = at.start;
  } else if ('append' in target) {
    start = dest.length > 0 ? Math.max(...dest.map(e => e.start + durationOf(e.p))) : emptyStart;
  } else {
    start = target.time;
  }

  // 3. Nothing may overlap. The first match at or after the drop point, and
  //    everything behind it, moves later by just enough to clear the arrival:
  //    a full match length when dropped in front of one, and nothing at all
  //    when dropped into a gap already wide enough to hold it.
  const after = dest.filter(entry => entry.start >= start);
  if (after.length > 0) {
    const delta = Math.max(0, start + dur - after[0].start);
    if (delta > 0) for (const entry of after) moves.set(entry.p.id, entry.start + delta);
  }

  const byId = new Map(placements.map(p => [p.id, p] as const));
  const result: PlannedMove[] = [{ id: matchId, court, day, start }];
  for (const [id, at] of moves) {
    const p = byId.get(id);
    // A match only ever moves in time here; the court it is on is not the
    // planner's to change.
    if (p) result.push({ id, court: p.court, day: p.day, start: at });
  }
  return result;
}
