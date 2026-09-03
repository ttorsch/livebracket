// Tournament schedule generator.
//
// A pure, deterministic function: given the divisions (with their matches and
// team pairings) and the venue/day constraints, it gives every match a court
// and a start time. No randomness, no I/O — trivially unit-testable, and the
// same input always produces the same schedule, which matters because
// organizers re-run this constantly and a schedule that reshuffles itself
// every time is one nobody trusts.
//
// The work is split into phases, each in its own module and each useful alone:
//
//   graph.ts      the tournament as a dependency graph — what must precede
//                 what, how deep each match sits, and the critical path
//   inventory.ts  does the event fit at all, and if not, which lever fixes it
//   grid.ts       the playing day: courts, runs, lunch and blocked time
//   appetite.ts   how many courts each division wants, and which it gets
//   score.ts      which match a free court takes next
//   place.ts      the walk — every court a column, filled downward
//   metrics.ts    what the finished schedule came out as
//   drift.ts      live projection once matches start running long
//
// The split is not decoration. What a court is *allowed* to take lives only in
// place.ts and what it *prefers* lives only in score.ts, so a change of taste
// can never make a schedule illegal.

import type {
  BlockedPeriod,
  DayCapacity,
  DivisionDemand,
  ScheduleAssignment,
  ScheduleConfig,
  SchedulableDivision,
} from './types.ts';
import { courtRoster, normaliseConfig, toHHMM } from './types.ts';
import { buildGraph, type MatchGraph } from './graph.ts';
import { buildGrid, DAY_SPAN, type Grid } from './grid.ts';
import { placeMatches, type Placement } from './place.ts';
import { measure, type ScheduleMetrics } from './metrics.ts';
import type { Appetite } from './appetite.ts';
import { scheduleInventory, type Inventory } from './inventory.ts';

// Re-exported so callers have one import for the whole subsystem.
export * from './types.ts';
export { scheduleInventory, type Inventory } from './inventory.ts';
export { buildGraph, type MatchGraph, type MatchNode } from './graph.ts';
export { buildGrid, type Grid, type Slot, DAY_SPAN } from './grid.ts';
export {
  appetiteOf,
  allotBlocks,
  divisionQueue,
  type Appetite,
  type Block,
} from './appetite.ts';
export { scoreCandidate, compareCandidates, type CourtHistory } from './score.ts';
export { placeMatches, type Placement } from './place.ts';
export { measure, type ScheduleMetrics } from './metrics.ts';
export {
  validateSchedule,
  type EditedPlacement,
  type ProblemKind,
  type ScheduleProblem,
} from './validate.ts';
export {
  projectSchedule,
  absOf,
  type DriftResult,
  type MatchActual,
  type Projection,
  type DependencyWarning,
} from './drift.ts';

export interface ScheduleResult {
  assignments: ScheduleAssignment[];
  overflow: { matchId: string; divisionId: string }[]; // no room inside the event
  /** divisionId -> courts its block was cut to. */
  dedicatedCourts: Record<string, number>;
  mode: 'parallel' | 'wave';                           // does the venue hold everyone at once
  venueRatio: number;                                  // total appetite / courts
  pivots: number;                                      // net-height changes
  dayCapacityMinutes: number;                          // playable minutes/court/day
  openingRoundSpill: number;                           // opening-round matches past day one
  capacity: DayCapacity[];                             // supply vs use, per day
  demand: DivisionDemand[];                            // what each division needs
  backToBack: number;                                  // matches a team played with no gap
  blocks?: BlockedPeriod[];                            // blocks including auto Net Adjust periods

  // -- Diagnostics. A schedule you can argue with beats one you have to
  //    accept, so the generator explains itself rather than just answering. --
  metrics: ScheduleMetrics;
  inventory: Inventory;
  /** What each division wanted from the venue, and the order they took it in. */
  appetites: Appetite[];
  queue: string[];
  /** Longest dependency chain — the floor on how long the event can take. */
  criticalPathMinutes: number;
  criticalPathMatches: number;
  /** Where the venue is most congested. */
  bottleneck: { day: number; utilisation: number } | null;
  /** The raw placements, for the drift projector and any UI that wants
   *  minutes rather than wall-clock strings. */
  placements: Placement[];
  graph: MatchGraph;
  grid: Grid;
}

export function generateSchedule(
  divisions: SchedulableDivision[],
  rawConfig: Partial<ScheduleConfig>,
  days = 1,
): ScheduleResult {
  const config = normaliseConfig(rawConfig);
  // The grid's resolution follows the lengths actually declared, so a
  // 20-minute pool match books twenty minutes rather than a whole nominal
  // block.
  const grid = buildGrid(
    config,
    days,
    divisions.flatMap(d => d.matches.map(m => m.durationMinutes ?? config.blockMinutes)),
  );
  const graph = buildGraph(divisions, grid.blockMinutes);

  const placed = placeMatches(graph, grid, config);
  const placements = placed.placements;
  const metrics = measure(placements, graph, grid);

  const assignments: ScheduleAssignment[] = placements
    .map(p => ({
      matchId: p.matchId,
      divisionId: graph.nodes.get(p.matchId)?.divisionId ?? '',
      court: p.courtName,
      day: p.day,
      time: toHHMM(p.startAbs - p.day * DAY_SPAN),
    }))
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time) || a.court.localeCompare(b.court));

  const overflow = placed.unplaced.map(id => ({
    matchId: id,
    divisionId: graph.nodes.get(id)?.divisionId ?? '',
  }));

  const inventory = scheduleInventory(divisions, config, days);

  // Per-day supply vs. actual use.
  const capacity: DayCapacity[] = Array.from({ length: grid.days }, (_, day) => ({
    day,
    playableMinutes: grid.playableMinutesPerCourt,
    courtMinutes: grid.courtMinutesPerDay,
    matchMinutes: 0,
    matches: 0,
  }));
  for (const p of placements) {
    const row = capacity[p.day];
    if (!row) continue;
    row.matchMinutes += graph.nodes.get(p.matchId)?.durationMinutes ?? 0;
    row.matches += 1;
  }

  let bottleneck: { day: number; utilisation: number } | null = null;
  for (const c of capacity) {
    const u = c.courtMinutes > 0 ? c.matchMinutes / c.courtMinutes : 0;
    if (!bottleneck || u > bottleneck.utilisation) bottleneck = { day: c.day, utilisation: u };
  }

  // What each division asked the venue for. A ratio above 1 means they cannot
  // all be on court at once and have to take turns — not a fault, it is what
  // the queue is for.
  const dedicatedCourts: Record<string, number> = {};
  let wanted = 0;
  for (const appetite of placed.appetites) {
    dedicatedCourts[appetite.divisionId] = appetite.appetite;
    wanted += appetite.appetite;
  }
  for (const div of divisions) dedicatedCourts[div.id] ??= 0;
  const courtCount = Math.max(1, courtRoster(config).length);
  const venueRatio = wanted / courtCount;

  // Matches in a division's opening round that slipped past day one.
  let openingRoundSpill = 0;
  if (grid.days > 1) {
    const dayOf = new Map(placements.map(p => [p.matchId, p.day]));
    for (const node of graph.nodes.values()) {
      if (node.level === 0 && (dayOf.get(node.id) ?? 0) > 0) openingRoundSpill++;
    }
  }

  const kept = (config.blocks ?? []).filter(b => b.label !== 'Net Adjust');
  const blocks = [...kept, ...netAdjustBlocks(placements, config, grid)];

  return {
    assignments,
    overflow,
    dedicatedCourts,
    mode: venueRatio <= 1 ? 'parallel' : 'wave',
    venueRatio,
    pivots: metrics.netChanges,
    dayCapacityMinutes: grid.playableMinutesPerCourt,
    openingRoundSpill,
    capacity,
    demand: inventory.demand,
    backToBack: metrics.backToBack,
    blocks,

    metrics,
    inventory,
    appetites: placed.appetites,
    queue: placed.queue,
    criticalPathMinutes: graph.criticalPathMinutes,
    criticalPathMatches: graph.criticalPathMatches,
    bottleneck,
    placements,
    graph,
    grid,
  };
}

/** The gap a net change leaves on a court, drawn on the calendar so the
 *  organizer can see where the crew is working rather than wondering why a
 *  court stands empty for a quarter of an hour. Derived from the finished
 *  schedule and never stored — the next generate works them out again.
 *
 *  The marker covers the whole gap the change costs, not just the crew's
 *  minutes. A ten-minute net change on a fifteen-minute grid takes the court
 *  out for fifteen: the crew finishes at 16:10 and the next match still cannot
 *  begin until 16:15, because a match that starts off the grid takes the whole
 *  column off it for the rest of the day. Drawing only the ten left five
 *  minutes of unexplained white space under the marker and made the schedule
 *  look like it had lost time nobody could account for.
 *
 *  Set `netBufferMinutes` to a whole number of grid steps and the rounding
 *  disappears; below one, the difference is real court time and belongs on
 *  screen rather than hidden. */
function netAdjustBlocks(placements: Placement[], config: ScheduleConfig, grid: Grid): BlockedPeriod[] {
  if (!(config.netBufferMinutes > 0)) return [];
  const out: BlockedPeriod[] = [];
  const lunch = grid.lunch;

  const byCourtDay = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = `${p.courtName} ${p.day}`;
    const list = byCourtDay.get(key);
    if (list) list.push(p);
    else byCourtDay.set(key, [p]);
  }

  for (const list of byCourtDay.values()) {
    list.sort((a, b) => a.startAbs - b.startAbs);
    for (let i = 0; i < list.length - 1; i++) {
      const next = list[i + 1];
      if (!next.netChange) continue;
      const gap = next.startAbs - list[i].endAbs;
      const step = Math.max(1, grid.slotMinutes);
      const cost = Math.ceil(config.netBufferMinutes / step) * step;
      const length = Math.min(gap, cost);
      if (length < 5) continue;
      const from = list[i].endAbs - list[i].day * DAY_SPAN;
      // Nobody is waiting for a court during the break, so nobody is moving a
      // net in it either — the crew has the whole of lunch to do it in. A
      // marker drawn there is a claim about work that is not happening, and it
      // also holds the lunch row open at full height for an hour of announced
      // emptiness.
      if (lunch && from < lunch.end && lunch.start < from + length) continue;
      out.push({
        court: list[i].courtName,
        day: list[i].day,
        start: toHHMM(from),
        end: toHHMM(from + length),
        label: 'Net Adjust',
      });
    }
  }
  return out;
}
