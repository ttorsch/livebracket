// What a finished schedule actually came out as.
//
// This used to be the cost function's other half: the same nine weights that
// *chose* a placement were summed again to *judge* the result, so the report
// could only ever agree with the solver. Under a court queue there is no total
// to minimise — a court takes the best of what it can legally reach and moves
// on — so what is left here is measurement rather than scoring. Every number
// is something an organizer would recognise: how many teams got no gap, how
// many times the crew moved a net, how long the longest day at the venue was.
//
// Nothing here feeds back into placement. That is the point: a number that
// steers the solver cannot also be trusted as an honest description of what
// the solver did.

import type { MatchGraph } from './graph.ts';
import type { Grid } from './grid.ts';
import type { Placement } from './place.ts';

export interface ScheduleMetrics {
  placed: number;
  /** Matches a team walked straight back on court for, with no gap at all. */
  backToBack: number;
  /** Times the crew had to move a net between two matches on one court. */
  netChanges: number;
  /** Shortest gap any named team got between two matches, in minutes. */
  tightestRestMinutes: number;
  /** Shortest gap between a match and one it feeds — the rest the winner of
   *  that match got. Separate because those teams have no name yet, so they
   *  never appear in the measure above. */
  tightestFeederGapMinutes: number;
  /** Sum over team-days of (last finish − first start), in minutes. */
  venueSpanMinutes: number;
  /** Share of the venue's playing minutes the schedule actually uses. */
  courtUtilisation: number;
  /** Last minute of play, absolute. */
  finishAbs: number;
}

export function measure(placements: Placement[], graph: MatchGraph, grid: Grid): ScheduleMetrics {
  const ordered = [...placements].sort(
    (a, b) => a.startAbs - b.startAbs || a.courtIndex - b.courtIndex,
  );
  const endById = new Map(placements.map(p => [p.matchId, p.endAbs]));

  const metrics: ScheduleMetrics = {
    placed: placements.length,
    backToBack: 0,
    netChanges: 0,
    tightestRestMinutes: Infinity,
    tightestFeederGapMinutes: Infinity,
    venueSpanMinutes: 0,
    courtUtilisation: 0,
    finishAbs: 0,
  };

  const lastEnd = new Map<string, number>();
  const dayFirst = new Map<string, number>();
  const dayLast = new Map<string, number>();
  const courtHeight = new Map<number, number | null>();

  for (const p of ordered) {
    const node = graph.nodes.get(p.matchId);
    if (!node) continue;

    for (const team of [node.teamA, node.teamB]) {
      if (!team) continue;
      const previous = lastEnd.get(team);
      if (previous !== undefined) {
        const rest = p.startAbs - previous;
        metrics.tightestRestMinutes = Math.min(metrics.tightestRestMinutes, rest);
        if (rest <= 0) metrics.backToBack++;
      }
      lastEnd.set(team, Math.max(previous ?? -Infinity, p.endAbs));
      const key = `${team}:${p.day}`;
      dayFirst.set(key, Math.min(dayFirst.get(key) ?? p.startAbs, p.startAbs));
      dayLast.set(key, Math.max(dayLast.get(key) ?? p.endAbs, p.endAbs));
    }

    let feederEnd = -Infinity;
    for (const dep of node.deps) feederEnd = Math.max(feederEnd, endById.get(dep) ?? -Infinity);
    if (feederEnd !== -Infinity) {
      const gap = p.startAbs - feederEnd;
      metrics.tightestFeederGapMinutes = Math.min(metrics.tightestFeederGapMinutes, gap);
      if (gap <= 0) metrics.backToBack++;
    }

    // The net sits at the height of the last match that *declared* one — a
    // division with no declared height plays at whatever is rigged and moves
    // nothing, so it is transparent here as it is to the solver.
    const previousHeight = courtHeight.get(p.courtIndex) ?? grid.courts[p.courtIndex]?.netHeight ?? null;
    if (node.netHeight != null && previousHeight != null && previousHeight !== node.netHeight) {
      metrics.netChanges++;
    }
    if (node.netHeight != null) courtHeight.set(p.courtIndex, node.netHeight);

    metrics.finishAbs = Math.max(metrics.finishAbs, p.endAbs);
  }

  for (const [key, first] of dayFirst) {
    metrics.venueSpanMinutes += (dayLast.get(key) ?? first) - first;
  }
  if (!Number.isFinite(metrics.tightestRestMinutes)) metrics.tightestRestMinutes = 0;
  if (!Number.isFinite(metrics.tightestFeederGapMinutes)) metrics.tightestFeederGapMinutes = 0;

  const supply = grid.courtMinutesPerDay * grid.days;
  const used = placements.reduce((total, p) => total + (p.endAbs - p.startAbs), 0);
  metrics.courtUtilisation = supply > 0 ? used / supply : 0;

  return metrics;
}
