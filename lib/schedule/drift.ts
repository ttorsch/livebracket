// Phase 6 — live drift.
//
// The published grid is a promise. Matches run long anyway, so a schedule needs
// two times per match and not one:
//
//   planned    frozen the moment the organizer publishes. Never moves. This is
//              what players screenshot and what the venue prints.
//   projected  recomputed from what has actually happened. This is what the
//              live board shows.
//
// Propagation is deliberately *court-local*: a match running long pushes the
// rest of that court's day and nothing else. The alternative — shifting the
// whole venue — means one slow match at 10:00 moves twenty courts, and the
// published grid stops meaning anything by mid-morning.
//
// Court-local propagation can break a cross-court dependency: a semi-final on
// Court 1 may now be projected to start before its feeder on Court 4 finishes.
// Those are surfaced as warnings rather than silently fixed, because the fix is
// a human decision — move the match, shorten a warm-up, or accept the delay.
//
// Nothing is ever projected *earlier* than planned. A team that turned up for
// its published time must never find its match already under way.

import { toHHMM } from './types.ts';
import type { Placement } from './cost.ts';
import type { MatchGraph } from './graph.ts';
import { DAY_SPAN, type Grid } from './grid.ts';

export type MatchProgress = 'upcoming' | 'live' | 'done';

/** What actually happened to a match, as far as the live system knows. */
export interface MatchActual {
  matchId: string;
  status: MatchProgress;
  /** Absolute minute play actually began, when known. */
  startAbs?: number;
  /** Absolute minute play actually ended — only meaningful when done. */
  endAbs?: number;
}

export interface Projection {
  matchId: string;
  courtName: string;
  day: number;
  /** The published time. Unchanged, always. */
  plannedTime: string;
  /** Where it is now expected to start. */
  projectedTime: string;
  projectedStartAbs: number;
  projectedEndAbs: number;
  /** Minutes later than published. Never negative. */
  delayMinutes: number;
  status: MatchProgress;
  /** Projected to finish after the venue closes. */
  pastDayEnd: boolean;
}

export interface DependencyWarning {
  matchId: string;
  blockedBy: string;
  /** How far the feeder is projected to overrun the match waiting on it. */
  byMinutes: number;
  message: string;
}

export interface DriftResult {
  projections: Map<string, Projection>;
  warnings: DependencyWarning[];
  /** Worst single delay in the event, in minutes. */
  maxDelayMinutes: number;
  /** Courts currently running behind, worst first. */
  delayedCourts: { courtName: string; day: number; delayMinutes: number }[];
}

export function projectSchedule(
  placements: Placement[],
  actuals: MatchActual[],
  graph: MatchGraph,
  grid: Grid,
): DriftResult {
  const actualBy = new Map(actuals.map(a => [a.matchId, a]));
  const projections = new Map<string, Projection>();

  // One timeline per court per day — the unit drift propagates along.
  const lanes = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = `${p.slot.day}:${p.courtIndex}`;
    const lane = lanes.get(key);
    if (lane) lane.push(p);
    else lanes.set(key, [p]);
  }

  const delayedCourts: { courtName: string; day: number; delayMinutes: number }[] = [];
  let maxDelayMinutes = 0;

  for (const lane of lanes.values()) {
    lane.sort((a, b) => a.startAbs - b.startAbs);
    let runningEnd = -Infinity;
    let laneDelay = 0;

    for (const p of lane) {
      const duration = p.endAbs - p.startAbs;
      const actual = actualBy.get(p.matchId);
      const status: MatchProgress = actual?.status ?? 'upcoming';

      let start: number;
      let end: number;

      if (status === 'done' && actual?.endAbs !== undefined) {
        start = actual.startAbs ?? p.startAbs;
        end = actual.endAbs;
      } else if (status === 'live' && actual?.startAbs !== undefined) {
        start = actual.startAbs;
        end = start + duration;
      } else {
        // Not started: it goes as published, unless the court is still busy.
        start = Math.max(p.startAbs, runningEnd);
        end = start + duration;
      }

      runningEnd = Math.max(runningEnd, end);

      const delay = Math.max(0, start - p.startAbs);
      laneDelay = Math.max(laneDelay, delay);
      maxDelayMinutes = Math.max(maxDelayMinutes, delay);

      projections.set(p.matchId, {
        matchId: p.matchId,
        courtName: p.courtName,
        day: p.slot.day,
        plannedTime: toHHMM(p.startAbs - p.slot.day * DAY_SPAN),
        projectedTime: toHHMM(start - p.slot.day * DAY_SPAN),
        projectedStartAbs: start,
        projectedEndAbs: end,
        delayMinutes: delay,
        status,
        pastDayEnd: end - p.slot.day * DAY_SPAN > grid.dayEnd,
      });
    }

    if (laneDelay > 0 && lane.length > 0) {
      delayedCourts.push({
        courtName: lane[0].courtName,
        day: lane[0].slot.day,
        delayMinutes: laneDelay,
      });
    }
  }

  delayedCourts.sort((a, b) => b.delayMinutes - a.delayMinutes);

  // Cross-court dependencies that drift has broken. Reported, never auto-fixed.
  const warnings: DependencyWarning[] = [];
  for (const p of placements) {
    const node = graph.nodes.get(p.matchId);
    const self = projections.get(p.matchId);
    if (!node || !self) continue;
    if (self.status === 'done') continue;
    for (const dep of node.deps) {
      const feeder = projections.get(dep);
      if (!feeder) continue;
      const overrun = feeder.projectedEndAbs - self.projectedStartAbs;
      if (overrun > 0) {
        warnings.push({
          matchId: p.matchId,
          blockedBy: dep,
          byMinutes: overrun,
          message: `${p.courtName} ${self.projectedTime} is waiting on ${feeder.courtName}, which is projected to finish ${overrun} min later`,
        });
      }
    }
  }
  warnings.sort((a, b) => b.byMinutes - a.byMinutes);

  return { projections, warnings, maxDelayMinutes, delayedCourts };
}

/** Turn a stored wall-clock time into the absolute minute the scheduler uses. */
export function absOf(day: number, time: string): number {
  const [h, m] = time.split(':').map(Number);
  return day * DAY_SPAN + (h || 0) * 60 + (m || 0);
}
