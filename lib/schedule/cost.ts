// The cost function — the only place that knows what a *good* schedule is.
//
// Every human preference in this generator is a weight here rather than a
// branch in the solver. That is the whole point of the design: switching the
// event's priority from "max rest" to "finish earliest" is a change to numbers,
// not to the algorithm, and an organizer can be given a slider without anyone
// touching the placement code.
//
// Hard constraints are *not* here. Whether a placement is legal at all lives in
// assign.ts; this module only ranks placements that are already legal.

import type { CostWeights, ScheduleConfig } from './types.ts';
import { DEFAULT_WEIGHTS } from './types.ts';
import type { Grid, Slot } from './grid.ts';
import type { MatchGraph, MatchNode } from './graph.ts';
import type { DayPlan } from './dayplan.ts';

export interface Placement {
  matchId: string;
  courtIndex: number;
  courtName: string;
  slot: Slot;
  /** Blocks of the grid this match occupies, buffer included. */
  span: number;
  /** Actual first minute of play — a block later than the slot when a net had
   *  to be moved first. */
  startAbs: number;
  endAbs: number;
  netChange: boolean;
  pinned: boolean;
}

/** Everything the cost function reads that does not change during a run. */
export interface SolverContext {
  graph: MatchGraph;
  grid: Grid;
  plan: DayPlan;
  config: ScheduleConfig;
  weights: CostWeights;
  /** divisionId -> preferred court names. */
  affinity: Map<string, Set<string>>;
  /** Rest a team should get between matches, in minutes. */
  targetRestMinutes: number;
  /** Longest remaining chain in the whole event, for normalising urgency. */
  maxTailMinutes: number;
}

/** Running state of one team as the solver walks time forward. */
export interface TeamTrack {
  lastEnd: number;          // abs minutes, -Infinity before its first match
  lastCourt: string | null;
  /** day -> [first start, last end] of that team's day. */
  dayFirst: Map<number, number>;
  dayLast: Map<number, number>;
  dayCount: Map<number, number>;
}

/** Running state of one court. */
export interface CourtTrack {
  name: string;
  index: number;
  /** Net height currently set, null when nothing has needed one yet. */
  height: number | null;
  isShowCourt: boolean;
  /** day -> slot index -> matchId occupying it. */
  busy: Map<number, Map<number, string>>;
}

export function makeTeamTrack(): TeamTrack {
  return {
    lastEnd: -Infinity,
    lastCourt: null,
    dayFirst: new Map(),
    dayLast: new Map(),
    dayCount: new Map(),
  };
}

export function resolveWeights(config: ScheduleConfig): CostWeights {
  return { ...DEFAULT_WEIGHTS, ...(config.weights ?? {}) };
}

/** Teams whose time this match consumes: the two playing, plus whoever is
 *  refereeing it. Referee duty is court time as far as rest is concerned, which
 *  is why it is folded in here rather than treated as a separate concept. */
export function teamsOf(node: MatchNode): string[] {
  const out: string[] = [];
  if (node.teamA) out.push(node.teamA);
  if (node.teamB) out.push(node.teamB);
  if (node.refereeTeam) out.push(node.refereeTeam);
  return out;
}

/** What it would cost to put `node` on `court` at `slot`.
 *
 *  Lower is better and zero is achievable. Every term is scaled into "slots"
 *  or "events" so the weights are comparable to each other. */
export function placementCost(
  node: MatchNode,
  court: CourtTrack,
  slot: Slot,
  startAbs: number,
  endAbs: number,
  netChange: boolean,
  teams: Map<string, TeamTrack>,
  ctx: SolverContext,
): number {
  const w = ctx.weights;
  const block = ctx.grid.blockMinutes;
  let cost = 0;

  // ── Rest. The organizer's primary goal, so this dominates. ───────────────
  for (const teamId of teamsOf(node)) {
    const track = teams.get(teamId);
    if (!track || track.lastEnd === -Infinity) continue; // hasn't played yet
    const rest = startAbs - track.lastEnd;
    if (rest <= 0) cost += w.backToBack;
    const deficit = Math.max(0, ctx.targetRestMinutes - rest);
    if (deficit > 0) cost += w.restDeficit * (deficit / block);
    if (track.lastCourt && track.lastCourt !== court.name) cost += w.courtChurn;
  }

  // ── Net height. The buffer is already charged as real court time by the
  //    caller; this is the extra discouragement so nets move only when waiting
  //    for the right court would be worse. ─────────────────────────────────
  if (netChange) cost += w.netChange;

  // ── Venue span: how much longer this makes each team's day. ──────────────
  for (const teamId of teamsOf(node)) {
    const track = teams.get(teamId);
    if (!track) continue;
    const first = track.dayFirst.get(slot.day);
    const last = track.dayLast.get(slot.day);
    if (first === undefined || last === undefined) continue; // first match of the day is free
    const before = last - first;
    const after = Math.max(last, endAbs) - Math.min(first, startAbs);
    cost += w.venueSpan * (Math.max(0, after - before) / block);
  }

  // ── Pace: keeping every division on its day plan is what makes divisions
  //    progress together instead of one racing ahead. ───────────────────────
  const target = ctx.plan.targetDay.get(node.id);
  if (target !== undefined) cost += w.paceDeviation * Math.abs(slot.day - target);

  // ── Critical-path urgency: a match with a long chain of matches still ahead
  //    of it decides when the event can finish, so it goes first. Expressed as
  //    a penalty on *short* tails to keep every cost non-negative. ──────────
  if (ctx.maxTailMinutes > 0) {
    cost += w.depthUrgency * ((ctx.maxTailMinutes - node.tailMinutes) / block);
  }

  // ── Court fit. ───────────────────────────────────────────────────────────
  if (court.isShowCourt && node.depth > 0) {
    cost += w.showCourtMisuse * Math.min(node.depth, 3);
  }
  const prefer = ctx.affinity.get(node.divisionId);
  if (prefer && prefer.size > 0 && !prefer.has(court.name)) cost += w.divisionSpread;

  return cost;
}

export interface ScheduleMetrics {
  totalCost: number;
  placed: number;
  /** Matches a team had to play with no gap at all. */
  backToBack: number;
  /** Total rest shortfall across the event, in slots. */
  restDeficitSlots: number;
  netChanges: number;
  /** Σ |actual day − planned day| over every match. */
  paceDeviationDays: number;
  courtChurn: number;
  /** Shortest gap any team got between two matches, in minutes. */
  tightestRestMinutes: number;
  averageRestMinutes: number;
  /** Σ over team-days of (last end − first start), in minutes. */
  venueSpanMinutes: number;
  /** Share of available court blocks actually used. */
  courtUtilisation: number;
  /** Last minute of play, as an absolute minute. */
  finishAbs: number;
}

/** Score a complete schedule from scratch.
 *
 *  Used by the repair pass, which needs a total it can compare before and
 *  after a swap. Walking placements in time order reproduces exactly the state
 *  the incremental cost saw during placement, so the two agree. */
export function evaluate(placements: Placement[], ctx: SolverContext): ScheduleMetrics {
  const ordered = [...placements].sort(
    (a, b) => a.startAbs - b.startAbs || a.courtIndex - b.courtIndex,
  );

  const teams = new Map<string, TeamTrack>();
  const courtHeight = new Map<number, number | null>();

  const metrics: ScheduleMetrics = {
    totalCost: 0,
    placed: placements.length,
    backToBack: 0,
    restDeficitSlots: 0,
    netChanges: 0,
    paceDeviationDays: 0,
    courtChurn: 0,
    tightestRestMinutes: Infinity,
    averageRestMinutes: 0,
    venueSpanMinutes: 0,
    courtUtilisation: 0,
    finishAbs: 0,
  };

  const w = ctx.weights;
  const block = ctx.grid.blockMinutes;
  let restSamples = 0;
  let restTotal = 0;

  for (const p of ordered) {
    const node = ctx.graph.nodes.get(p.matchId);
    if (!node) continue;
    const court = ctx.grid.courts[p.courtIndex];
    const courtName = court?.name ?? p.courtName;

    for (const teamId of teamsOf(node)) {
      let track = teams.get(teamId);
      if (!track) {
        track = makeTeamTrack();
        teams.set(teamId, track);
      }
      if (track.lastEnd !== -Infinity) {
        const rest = p.startAbs - track.lastEnd;
        restSamples++;
        restTotal += rest;
        metrics.tightestRestMinutes = Math.min(metrics.tightestRestMinutes, rest);
        if (rest <= 0) {
          metrics.backToBack++;
          metrics.totalCost += w.backToBack;
        }
        const deficit = Math.max(0, ctx.targetRestMinutes - rest);
        if (deficit > 0) {
          metrics.restDeficitSlots += deficit / block;
          metrics.totalCost += w.restDeficit * (deficit / block);
        }
        if (track.lastCourt && track.lastCourt !== courtName) {
          metrics.courtChurn++;
          metrics.totalCost += w.courtChurn;
        }
      }
      track.lastEnd = Math.max(track.lastEnd, p.endAbs);
      track.lastCourt = courtName;
      const first = track.dayFirst.get(p.slot.day);
      track.dayFirst.set(p.slot.day, first === undefined ? p.startAbs : Math.min(first, p.startAbs));
      const last = track.dayLast.get(p.slot.day);
      track.dayLast.set(p.slot.day, last === undefined ? p.endAbs : Math.max(last, p.endAbs));
      track.dayCount.set(p.slot.day, (track.dayCount.get(p.slot.day) ?? 0) + 1);
    }

    const prevHeight = courtHeight.get(p.courtIndex) ?? court?.netHeight ?? null;
    if (node.netHeight != null && prevHeight != null && prevHeight !== node.netHeight) {
      metrics.netChanges++;
      metrics.totalCost += w.netChange;
    }
    if (node.netHeight != null) courtHeight.set(p.courtIndex, node.netHeight);

    const target = ctx.plan.targetDay.get(node.id);
    if (target !== undefined) {
      const dev = Math.abs(p.slot.day - target);
      metrics.paceDeviationDays += dev;
      metrics.totalCost += w.paceDeviation * dev;
    }

    if (ctx.maxTailMinutes > 0) {
      metrics.totalCost += w.depthUrgency * ((ctx.maxTailMinutes - node.tailMinutes) / block);
    }
    if (court?.isShowCourt && node.depth > 0) {
      metrics.totalCost += w.showCourtMisuse * Math.min(node.depth, 3);
    }
    const prefer = ctx.affinity.get(node.divisionId);
    if (prefer && prefer.size > 0 && !prefer.has(courtName)) metrics.totalCost += w.divisionSpread;

    metrics.finishAbs = Math.max(metrics.finishAbs, p.endAbs);
  }

  for (const track of teams.values()) {
    for (const [day, first] of track.dayFirst) {
      const last = track.dayLast.get(day) ?? first;
      metrics.venueSpanMinutes += last - first;
      metrics.totalCost += w.venueSpan * ((last - first) / block);
    }
  }

  metrics.averageRestMinutes = restSamples > 0 ? restTotal / restSamples : 0;
  if (!Number.isFinite(metrics.tightestRestMinutes)) metrics.tightestRestMinutes = 0;

  const usableBlocks = ctx.grid.slots.length * ctx.grid.courts.length;
  const usedBlocks = placements.reduce((s, p) => s + p.span, 0);
  metrics.courtUtilisation = usableBlocks > 0 ? usedBlocks / usableBlocks : 0;

  return metrics;
}
