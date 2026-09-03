// Phase 5 — repair.
//
// Solving each slot optimally, in sequence, does not make the whole schedule
// optimal: a choice that is locally cheap at 09:00 can force an expensive one
// at 15:00, and by then the 09:00 decision is already spent. This pass buys
// some of that back with a bounded local search — try an improving exchange,
// keep it if the total cost drops, stop when nothing improves or the iteration
// budget runs out.
//
// Two deliberate limits keep this safe rather than clever:
//
//   * Only exchanges that cannot change the *shape* of the grid are considered
//     — equal block spans, and either the same court or two matches wanting the
//     same net height. A swap that would newly require a net change would need
//     buffer time nobody allocated, so those are simply not proposed.
//   * The search is deterministic: candidate pairs are visited in a fixed
//     order and the same input always produces the same output. Organizers
//     re-run the generator constantly and a schedule that reshuffles itself
//     each time is one nobody trusts.

import { evaluate, type Placement, type ScheduleMetrics, type SolverContext } from './cost.ts';
import { courtOpen } from './grid.ts';
import { teamsOf } from './cost.ts';
import { isExclusive, isGloballyOrdered, isSingleCourt, phaseOrder } from './staging.ts';

export interface RepairResult {
  placements: Placement[];
  metrics: ScheduleMetrics;
  /** Exchanges accepted. */
  improvements: number;
  /** Candidate exchanges examined. */
  examined: number;
}

export function repair(placements: Placement[], ctx: SolverContext): RepairResult {
  const budget = Math.max(0, Math.trunc(ctx.config.repairIterations) || 0);
  let current = [...placements];
  let metrics = evaluate(current, ctx);
  if (budget === 0 || current.length < 2) {
    return { placements: current, metrics, improvements: 0, examined: 0 };
  }

  let improvements = 0;
  let examined = 0;

  // Repeated sweeps: one improving exchange can unlock another, so keep going
  // until a whole sweep finds nothing.
  for (let sweep = 0; sweep < 8 && examined < budget; sweep++) {
    let acceptedThisSweep = 0;

    for (let i = 0; i < current.length && examined < budget; i++) {
      for (let j = i + 1; j < current.length && examined < budget; j++) {
        const a = current[i];
        const b = current[j];
        if (!exchangeable(a, b, ctx)) continue;
        examined++;

        const swapped = applySwap(current, i, j);
        if (!legal(swapped, ctx)) continue;

        const next = evaluate(swapped, ctx);
        if (next.totalCost < metrics.totalCost - 1e-9) {
          current = swapped;
          metrics = next;
          improvements++;
          acceptedThisSweep++;
        }
      }
    }

    if (acceptedThisSweep === 0) break;
  }

  return { placements: current, metrics, improvements, examined };
}

/** Could these two placements trade positions without changing how much of the
 *  grid they occupy, or introducing a net change nobody budgeted time for? */
function exchangeable(a: Placement, b: Placement, ctx: SolverContext): boolean {
  if (a.span !== b.span) return false;                 // would resize the booking
  if (a.courtIndex === b.courtIndex && a.slot.abs === b.slot.abs) return false;

  if (a.courtIndex === b.courtIndex) return true;      // reordering one court is always shape-safe

  const na = ctx.graph.nodes.get(a.matchId);
  const nb = ctx.graph.nodes.get(b.matchId);
  if (!na || !nb) return false;
  // Across courts, only matches wanting the same net height may trade, since
  // neither court then has to be re-rigged.
  return na.netHeight === nb.netHeight;
}

/** The two placements with their court/slot swapped, offsets preserved. */
function applySwap(placements: Placement[], i: number, j: number): Placement[] {
  const a = placements[i];
  const b = placements[j];
  const aOffset = a.startAbs - a.slot.abs;
  const bOffset = b.startAbs - b.slot.abs;
  const aDuration = a.endAbs - a.startAbs;
  const bDuration = b.endAbs - b.startAbs;

  const next = [...placements];
  next[i] = {
    ...a,
    courtIndex: b.courtIndex,
    courtName: b.courtName,
    slot: b.slot,
    startAbs: b.slot.abs + aOffset,
    endAbs: b.slot.abs + aOffset + aDuration,
  };
  next[j] = {
    ...b,
    courtIndex: a.courtIndex,
    courtName: a.courtName,
    slot: a.slot,
    startAbs: a.slot.abs + bOffset,
    endAbs: a.slot.abs + bOffset + bDuration,
  };
  return next;
}

/** Every hard rule the placement phase enforced, re-checked over a whole
 *  candidate schedule. Cheaper to verify than to incrementally maintain, and
 *  verification is what makes the repair pass safe to let loose. */
function legal(placements: Placement[], ctx: SolverContext): boolean {
  const { grid, graph } = ctx;

  const byId = new Map(placements.map(p => [p.matchId, p]));

  // Court occupancy and the day/lunch window.
  const seen = new Set<string>();
  for (const p of placements) {
    if (!courtOpen(grid, p.courtIndex, p.slot, p.span)) return false;
    for (let k = 0; k < p.span; k++) {
      const key = `${p.slot.day}:${p.courtIndex}:${p.slot.index + k}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }

  // Dependencies: a feeder must be finished before the match it feeds starts.
  for (const p of placements) {
    const node = graph.nodes.get(p.matchId);
    if (!node) continue;
    for (const dep of node.deps) {
      const d = byId.get(dep);
      if (!d) continue;               // unplaced feeders are already an overflow
      if (d.endAbs > p.startAbs) return false;
    }
  }

  // The medal-round programme holds. Without this the repair pass would happily
  // move one semifinal to a cheaper slot and leave its twin behind, or drift a
  // final off the show court — undoing the very things staging exists to
  // guarantee, and calling it an improvement, because the cost function prices
  // matches one at a time and knows nothing about a programme.
  if (ctx.staging.enabled) {
    const span = (wave: { matchIds: string[] }) => {
      const placed = wave.matchIds.map(id => byId.get(id)).filter((p): p is Placement => !!p);
      if (placed.length === 0) return null;
      return {
        placed,
        start: Math.min(...placed.map(p => p.slot.abs)),
        end: Math.max(...placed.map(p => p.endAbs)),
      };
    };

    let finalsCourt: number | null = null;
    for (const wave of ctx.staging.waves) {
      const here = span(wave);
      if (!here) continue;

      // A wave starts together.
      if (here.placed.some(p => p.slot.abs !== here.start)) return false;

      // A wave this one explicitly follows finishes first.
      for (const key of wave.after) {
        const before = span(ctx.staging.waves.find(w => w.key === key) ?? { matchIds: [] });
        if (before && before.end > here.start) return false;
      }

      for (const other of ctx.staging.waves) {
        if (other.key === wave.key) continue;
        const there = span(other);
        if (!there) continue;
        // Earlier phases finish before later ones begin — among the phases that
        // are ordered against every division. Pool play is not.
        if (
          isGloballyOrdered(wave.phase) &&
          isGloballyOrdered(other.phase) &&
          phaseOrder(other.phase) < phaseOrder(wave.phase) &&
          there.end > here.start
        ) {
          return false;
        }
        // Two waves of an exclusive phase never overlap.
        if (
          other.phase === wave.phase &&
          isExclusive(wave.phase) &&
          here.start < there.end &&
          there.start < here.end
        ) {
          return false;
        }
      }

      // Every wave of a single-court phase is on the same one court.
      if (isSingleCourt(wave.phase)) {
        for (const p of here.placed) {
          if (finalsCourt === null) finalsCourt = p.courtIndex;
          else if (p.courtIndex !== finalsCourt) return false;
        }
      }
    }
  }

  // A team cannot be in two places at once.
  const spans = new Map<string, { s: number; e: number }[]>();
  for (const p of placements) {
    const node = graph.nodes.get(p.matchId);
    if (!node) continue;
    for (const teamId of teamsOf(node)) {
      const list = spans.get(teamId);
      if (list) list.push({ s: p.startAbs, e: p.endAbs });
      else spans.set(teamId, [{ s: p.startAbs, e: p.endAbs }]);
    }
  }
  for (const list of spans.values()) {
    list.sort((x, y) => x.s - y.s);
    for (let i = 1; i < list.length; i++) if (list[i].s < list[i - 1].e) return false;
  }

  return true;
}
