// Phase 0 — does this event fit at all?
//
// Runs before anything is placed and is useful on its own: the organizer can
// see the verdict while still adding divisions, instead of generating a
// schedule and discovering half of it overflowed.
//
// Two independent limits decide feasibility, and confusing them is the usual
// reason a "just add another court" instinct fails:
//
//   Volume  — total court-minutes available vs. total match-minutes needed.
//             Fixed by adding courts, adding days, extending the day, or
//             shortening the block.
//   Chain   — the critical path through the dependency graph. A four-round
//             knockout is four matches long end to end, and no amount of court
//             space makes a semi-final playable before its quarter-final. Only
//             more *time* fixes this, never more courts.

import type {
  DayCapacity,
  DivisionDemand,
  FeasibilityLever,
  FeasibilityVerdict,
  SchedulableDivision,
  ScheduleConfig,
} from './types.ts';
import { parseNetHeight } from './types.ts';
import { buildGrid } from './grid.ts';
import { buildGraph } from './graph.ts';

/** Above this share of the venue's court time, a schedule will technically fit
 *  but leaves no slack for a match running long, so it is reported as tight. */
const TIGHT_UTILISATION = 0.85;

export interface Inventory {
  capacity: DayCapacity[];
  demand: DivisionDemand[];
  supplyMinutes: number;
  demandMinutes: number;
  matches: number;
  /** Longest dependency chain in minutes — the floor on event length. */
  criticalPathMinutes: number;
  /** Days that chain needs, given the daily playing window. */
  criticalPathDays: number;
  utilisation: number;
  verdict: FeasibilityVerdict;
  /** Why it doesn't fit, in the organizer's language. Empty when it fits. */
  reasons: string[];
  levers: FeasibilityLever[];
}

export function scheduleInventory(
  divisions: SchedulableDivision[],
  config: ScheduleConfig,
  days = 1,
): Inventory {
  const grid = buildGrid(
    config,
    days,
    divisions.flatMap(d => d.matches.map(m => m.durationMinutes ?? config.blockMinutes)),
  );
  const graph = buildGraph(divisions, grid.blockMinutes);
  const courtCount = grid.courts.length;

  const capacity: DayCapacity[] = Array.from({ length: grid.days }, (_, day) => ({
    day,
    playableMinutes: grid.playableMinutesPerCourt,
    courtMinutes: grid.courtMinutesPerDay,
    matchMinutes: 0,
    matches: 0,
  }));

  const demand: DivisionDemand[] = divisions.map(d => {
    const ids = new Set(d.matches.map(m => m.id));
    let minutes = 0;
    for (const id of ids) minutes += graph.nodes.get(id)?.durationMinutes ?? 0;
    return {
      divisionId: d.id,
      label: d.label,
      matches: d.matches.length,
      minutes,
      netHeight: parseNetHeight(d.netHeight),
    };
  });

  const supplyMinutes = grid.courtMinutesPerDay * grid.days;
  const demandMinutes = demand.reduce((s, d) => s + d.minutes, 0);
  const matches = demand.reduce((s, d) => s + d.matches, 0);

  const perDayPlayable = grid.playableMinutesPerCourt;
  const criticalPathDays = perDayPlayable > 0
    ? Math.ceil(graph.criticalPathMinutes / perDayPlayable)
    : Infinity;

  const reasons: string[] = [];
  const levers: FeasibilityLever[] = [];

  const shortfall = demandMinutes - supplyMinutes;
  if (shortfall > 0) {
    reasons.push(
      `${minutesLabel(shortfall)} more court time is needed than the venue has across ${grid.days} day${grid.days === 1 ? '' : 's'}.`,
    );
    if (perDayPlayable > 0) {
      levers.push({
        kind: 'addCourt',
        amount: Math.ceil(shortfall / (perDayPlayable * grid.days)),
        detail: `Add ${Math.ceil(shortfall / (perDayPlayable * grid.days))} court${Math.ceil(shortfall / (perDayPlayable * grid.days)) === 1 ? '' : 's'}`,
      });
      levers.push({
        kind: 'addDay',
        amount: Math.ceil(shortfall / (perDayPlayable * Math.max(1, courtCount))),
        detail: `Add ${Math.ceil(shortfall / (perDayPlayable * Math.max(1, courtCount)))} day${Math.ceil(shortfall / (perDayPlayable * Math.max(1, courtCount))) === 1 ? '' : 's'}`,
      });
    }
    const extraPerDay = Math.ceil(shortfall / (Math.max(1, courtCount) * grid.days));
    levers.push({
      kind: 'extendDay',
      amount: extraPerDay,
      detail: `Play ${minutesLabel(extraPerDay)} longer each day`,
    });
    if (demandMinutes > 0) {
      const newBlock = Math.max(5, Math.floor(grid.blockMinutes * (supplyMinutes / demandMinutes)));
      levers.push({
        kind: 'shortenBlock',
        amount: newBlock,
        detail: `Shorten the match block to ${newBlock} min`,
      });
    }
  }

  if (criticalPathDays > grid.days) {
    reasons.push(
      `The longest run of matches (${graph.criticalPathMatches} back to back, ${minutesLabel(graph.criticalPathMinutes)}) cannot finish in ${grid.days} day${grid.days === 1 ? '' : 's'} — extra courts cannot help, only more time.`,
    );
    levers.push({
      kind: 'addDay',
      amount: criticalPathDays - grid.days,
      detail: `Add ${criticalPathDays - grid.days} day${criticalPathDays - grid.days === 1 ? '' : 's'} for the knockout to finish`,
    });
  }

  const utilisation = supplyMinutes > 0 ? demandMinutes / supplyMinutes : Infinity;
  const verdict: FeasibilityVerdict =
    reasons.length > 0 ? 'overflow' : utilisation > TIGHT_UTILISATION ? 'tight' : 'fits';

  return {
    capacity,
    demand,
    supplyMinutes,
    demandMinutes,
    matches,
    criticalPathMinutes: graph.criticalPathMinutes,
    criticalPathDays: Number.isFinite(criticalPathDays) ? criticalPathDays : 0,
    utilisation,
    verdict,
    reasons,
    levers: dedupeLevers(levers),
  };
}

/** Keep the cheapest ask of each kind — two "add days" levers from the volume
 *  check and the chain check should read as one instruction. */
function dedupeLevers(levers: FeasibilityLever[]): FeasibilityLever[] {
  const best = new Map<string, FeasibilityLever>();
  for (const l of levers) {
    const prev = best.get(l.kind);
    if (!prev) best.set(l.kind, l);
    // shortenBlock is the only lever where a *smaller* number is the bigger
    // ask, so the "worst case" comparison flips for it.
    else if (l.kind === 'shortenBlock' ? l.amount < prev.amount : l.amount > prev.amount) {
      best.set(l.kind, l);
    }
  }
  return [...best.values()];
}

function minutesLabel(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}
