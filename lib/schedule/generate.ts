// Tournament schedule generator.
//
// A pure, deterministic function: given the divisions (with their matches and
// team pairings) and the venue/day constraints, it assigns every match a court
// and a start time. No randomness, no I/O — trivially unit-testable, and the
// same input always produces the same schedule, which matters because
// organizers re-run this constantly and a schedule that reshuffles itself every
// time is one nobody trusts.
//
// The work is split into phases, each in its own module and each useful alone:
//
//   graph.ts      the tournament as a dependency graph — what must precede
//                 what, how deep each match sits, and the critical path
//   inventory.ts  does the event fit at all, and if not, which lever fixes it
//   dayplan.ts    which day each match belongs on, and which courts each
//                 division prefers
//   grid.ts       courts × slots × days, with staggered lunch
//   cost.ts       what makes one legal schedule better than another
//   assign.ts     the solver: optimal court assignment within each slot
//   repair.ts     bounded local search over the finished schedule
//   drift.ts      live projection once matches start running long
//
// The split is not decoration. Preferences live only in cost.ts, so changing
// what "good" means is an edit to numbers; legality lives only in assign.ts, so
// a schedule can never be made illegal by a change of preference.

import type {
  DayCapacity,
  DivisionDemand,
  PinnedPlacement,
  Relaxation,
  ScheduleAssignment,
  ScheduleConfig,
  SchedulableDivision,
} from './types.ts';
import { courtRoster, normaliseConfig, parseNetHeight, toHHMM } from './types.ts';
import { buildGraph, type MatchGraph } from './graph.ts';
import { buildGrid, DAY_SPAN, type Grid } from './grid.ts';
import { buildDayPlan, courtAffinity, type DayPlan } from './dayplan.ts';
import { buildStaging } from './staging.ts';
import {
  evaluate,
  resolveWeights,
  type Placement,
  type ScheduleMetrics,
  type SolverContext,
} from './cost.ts';
import { assignMatches, type PinConflict } from './assign.ts';
import { repair } from './repair.ts';
import { scheduleInventory, type Inventory } from './inventory.ts';

// Re-exported so callers have one import for the whole subsystem, and so the
// existing pages keep working unchanged.
export * from './types.ts';
export { scheduleInventory, type Inventory } from './inventory.ts';
export { buildGraph, type MatchGraph, type MatchNode } from './graph.ts';
export { buildGrid, type Grid, type Slot, DAY_SPAN } from './grid.ts';
export { buildDayPlan, courtAffinity, type DayPlan } from './dayplan.ts';
export { buildStaging, type StagePhase, type StageWave, type Staging } from './staging.ts';
export { evaluate, type Placement, type ScheduleMetrics, type SolverContext } from './cost.ts';
export { assignMatches, hungarian, type PinConflict } from './assign.ts';
export { repair } from './repair.ts';
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
  overflow: { matchId: string; divisionId: string }[]; // didn't fit before endTime
  dedicatedCourts: Record<string, number>;             // divisionId -> preferred court count
  mode: 'parallel' | 'wave';                           // V_R ≤ 1 vs > 1
  venueRatio: number;                                  // V_R = Σ D_d / courtCount
  pivots: number;                                      // net-height changes
  dayCapacityMinutes: number;                          // playable minutes/court/day
  openingRoundSpill: number;                           // opening-round matches past day one
  capacity: DayCapacity[];                             // supply vs use, per day
  demand: DivisionDemand[];                            // what each division needs
  backToBack: number;                                  // matches a team played with no gap

  // ── Diagnostics. A schedule you can argue with beats one you have to
  //    accept, so the generator explains itself rather than just answering. ──
  metrics: ScheduleMetrics;
  inventory: Inventory;
  /** Promises the solver had to break to place everything. Empty is ideal. */
  relaxations: Relaxation[];
  /** Pins that could not be honoured, and why. */
  pinConflicts: PinConflict[];
  /** Longest dependency chain — the floor on how long the event can take. */
  criticalPathMinutes: number;
  criticalPathMatches: number;
  /** Where the venue is most congested. */
  bottleneck: { day: number; utilisation: number } | null;
  /** Exchanges the repair pass accepted. */
  improvements: number;
  /** The raw placements, for the drift projector and any UI that wants slots
   *  rather than wall-clock strings. */
  placements: Placement[];
  graph: MatchGraph;
  grid: Grid;
  plan: DayPlan;
}

export interface GenerateOptions {
  /** Court/day/time an organizer fixed by hand. Honoured as hard constraints;
   *  anything that cannot be honoured is reported in `pinConflicts` rather than
   *  quietly dropped. */
  pins?: PinnedPlacement[];
}

export function generateSchedule(
  divisions: SchedulableDivision[],
  rawConfig: Partial<ScheduleConfig>,
  days = 1,
  options: GenerateOptions = {},
): ScheduleResult {
  const config = normaliseConfig(rawConfig);
  // The grid's resolution follows the lengths actually declared, so a
  // 20-minute pool match books twenty minutes rather than a whole nominal block.
  const grid = buildGrid(
    config,
    days,
    divisions.flatMap(d => d.matches.map(m => m.durationMinutes ?? config.blockMinutes)),
  );
  const graph = buildGraph(divisions, grid.blockMinutes);

  // Net height is a property of the division, but the solver only ever holds
  // matches, so it is copied onto each node once here.
  for (const div of divisions) {
    const height = parseNetHeight(div.netHeight);
    for (const m of div.matches) {
      const node = graph.nodes.get(m.id);
      if (node) node.netHeight = height;
    }
  }

  const plan = buildDayPlan(graph, grid, config);

  // Staging is worked out before court affinity, because the pool rotation is
  // what says how many courts a division actually occupies — and affinity
  // handing it fewer than that is what makes a division spill onto its
  // neighbour's courts and move a net every turn.
  const staging = buildStaging(graph, grid.courts.length, config.stageFinals);
  const affinity = courtAffinity(
    divisions,
    grid.courts,
    new Map(staging.poolPlans.map(p => [p.divisionId, p.poolsAtOnce * p.perPool])),
  );

  // Rig the nets before play starts.
  //
  // A court whose height nobody has declared costs nothing to use at any
  // height, so the very first match on it is free whatever it needs — and the
  // clustering courtAffinity just worked out is thrown away by whichever
  // division happens to reach the court first. Seeding each unspecified court
  // with the height of the division that claims it reflects what actually
  // happens at a venue (nets are set in the morning, not mid-match) and makes
  // straying onto someone else's court cost a net change from the first slot.
  const heightOf = new Map(divisions.map(d => [d.id, parseNetHeight(d.netHeight)]));
  const seeded = new Set<string>();
  for (const [divisionId, prefer] of affinity) {
    const height = heightOf.get(divisionId);
    if (height == null) continue;
    for (const name of prefer) {
      if (seeded.has(name)) continue;
      const court = grid.courts.find(c => c.name === name);
      if (court && court.netHeight == null) {
        court.netHeight = height;
        seeded.add(name);
      }
    }
  }

  let maxTailMinutes = 0;
  for (const node of graph.nodes.values()) {
    maxTailMinutes = Math.max(maxTailMinutes, node.tailMinutes);
  }

  const ctx: SolverContext = {
    graph,
    grid,
    plan,
    config,
    weights: resolveWeights(config),
    affinity,
    staging,
    targetRestMinutes: Math.max(0, config.minRestSlots) * grid.blockMinutes,
    maxTailMinutes,
  };

  const assigned = assignMatches(ctx, options.pins ?? []);
  const repaired = repair(assigned.placements, ctx);
  const placements = repaired.placements;
  const metrics = repaired.metrics.placed > 0 ? repaired.metrics : evaluate(placements, ctx);

  const assignments: ScheduleAssignment[] = placements
    .map(p => ({
      matchId: p.matchId,
      divisionId: graph.nodes.get(p.matchId)?.divisionId ?? '',
      court: p.courtName,
      day: p.slot.day,
      time: toHHMM(p.startAbs - p.slot.day * DAY_SPAN),
      pinned: p.pinned,
    }))
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time) || a.court.localeCompare(b.court));

  const overflow = assigned.unplaced.map(id => ({
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
    const node = graph.nodes.get(p.matchId);
    capacity[p.slot.day].matchMinutes += node?.durationMinutes ?? 0;
    capacity[p.slot.day].matches += 1;
  }

  let bottleneck: { day: number; utilisation: number } | null = null;
  for (const c of capacity) {
    const u = c.courtMinutes > 0 ? c.matchMinutes / c.courtMinutes : 0;
    if (!bottleneck || u > bottleneck.utilisation) bottleneck = { day: c.day, utilisation: u };
  }

  // Legacy shape indicators, kept so the existing dashboard reads unchanged.
  const dedicatedCourts: Record<string, number> = {};
  let sumDd = 0;
  for (const div of divisions) {
    const n = div.matches.length === 0 ? 0 : (affinity.get(div.id)?.size ?? 0);
    dedicatedCourts[div.id] = n;
    sumDd += n;
  }
  const courtCount = Math.max(1, courtRoster(config).length);
  const venueRatio = sumDd / courtCount;

  // Matches in each division's first round that slipped past day one.
  let openingRoundSpill = 0;
  if (grid.days > 1) {
    const placedDay = new Map(placements.map(p => [p.matchId, p.slot.day]));
    for (const node of graph.nodes.values()) {
      if (node.level === 0 && (placedDay.get(node.id) ?? 0) > 0) openingRoundSpill++;
    }
  }

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

    metrics,
    inventory,
    relaxations: assigned.relaxations,
    pinConflicts: assigned.pinConflicts,
    criticalPathMinutes: graph.criticalPathMinutes,
    criticalPathMatches: graph.criticalPathMatches,
    bottleneck,
    improvements: repaired.improvements,
    placements,
    graph,
    grid,
    plan,
  };
}
