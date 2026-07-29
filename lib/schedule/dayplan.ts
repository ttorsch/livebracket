// Phase 2 — the day plan.
//
// Before any match touches a court, decide roughly *which day* each match
// belongs on. Without this step a greedy solver front-loads: it fills day one
// with whatever is ready, which on a multi-day event means one division races
// through its pool play while another has not started.
//
// The plan is a target, not a booking. The solver is free to place a match a
// day early or late when that produces a better schedule — it just pays
// `paceDeviation` for doing so. Only one rule here is hard: on a multi-day
// event every division's last round is held for the final day, so the event
// ends with finals rather than trailing off.
//
// This module also decides court *affinity* — which courts a division prefers.
// Affinity is never a reservation. A division can always use any free court;
// it simply prefers its own, which is what keeps a division's matches clustered
// together and same-net-height divisions sharing court tracks.

import type { CourtSpec, DayPlanStrategy, ScheduleConfig, SchedulableDivision } from './types.ts';
import { autoDedicatedCourts, parseNetHeight } from './types.ts';
import type { Grid } from './grid.ts';
import type { MatchGraph } from './graph.ts';

export interface DayPlan {
  strategy: DayPlanStrategy;
  /** matchId -> the day the plan wants it on. */
  targetDay: Map<string, number>;
  /** divisionId -> minutes of court time the division should use each day. */
  quota: Map<string, number[]>;
  /** divisionId -> [firstDay, lastDay] the division is expected to occupy. */
  window: Map<string, [number, number]>;
  /** The day finals are held on (the last day of the event). */
  finalsDay: number;
}

export function buildDayPlan(
  graph: MatchGraph,
  grid: Grid,
  config: ScheduleConfig,
): DayPlan {
  const days = grid.days;
  const finalsDay = days - 1;
  const window = config.dayPlan === 'compress-division'
    ? compressWindows(graph, grid)
    : new Map([...graph.divisions.keys()].map(id => [id, [0, finalsDay] as [number, number]]));

  const quota = new Map<string, number[]>();
  const targetDay = new Map<string, number>();

  for (const [divisionId, shape] of graph.divisions) {
    const [first, last] = window.get(divisionId) ?? [0, finalsDay];
    const span = Math.max(1, last - first + 1);

    // Spread the division's own work evenly across the days it occupies. Note
    // this is a share of the *division's* minutes, not of the venue's capacity:
    // that is what makes every division advance every day rather than the
    // biggest division finishing first.
    const perDay = shape.minutes / span;
    const row = Array.from({ length: days }, (_, d) =>
      d >= first && d <= last ? perDay : 0,
    );
    quota.set(divisionId, row);

    // Walk the division's matches in dependency order, filling one day's quota
    // before moving to the next.
    const ordered = graph.order.filter(id => graph.nodes.get(id)!.divisionId === divisionId);
    let day = first;
    let used = 0;
    for (const id of ordered) {
      const node = graph.nodes.get(id)!;
      // A whole level moves together: splitting one round across a day
      // boundary mid-level would let half a pool round play on day two for no
      // reason. Roll to the next day only between levels.
      if (used > 0 && used + node.durationMinutes > perDay && day < last) {
        day++;
        used = 0;
      }
      const isFinalRound = node.level === shape.maxLevel && shape.maxLevel > 0;
      const holdForFinals = config.finalsOnLastDay && days > 1 && isFinalRound;
      targetDay.set(id, holdForFinals ? last : Math.min(day, last));
      used += node.durationMinutes;
    }

    // A dependency can never be planned after the match that waits on it.
    for (const id of ordered) {
      const node = graph.nodes.get(id)!;
      let earliest = targetDay.get(id) ?? first;
      for (const dep of node.deps) earliest = Math.max(earliest, targetDay.get(dep) ?? first);
      targetDay.set(id, Math.min(earliest, last));
    }
  }

  return { strategy: config.dayPlan, targetDay, quota, window, finalsDay };
}

/** Day windows for the compress-division strategy: divisions are packed into
 *  consecutive day ranges, biggest first, so a team travels on as few days as
 *  possible. Not the organizer's current choice — kept behind the config flag
 *  because it is the other shape real events use. */
function compressWindows(graph: MatchGraph, grid: Grid): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const capacityPerDay = grid.courtMinutesPerDay;
  const remaining = Array.from({ length: grid.days }, () => capacityPerDay);

  const shapes = [...graph.divisions.values()].sort(
    (a, b) => b.minutes - a.minutes || (a.divisionId < b.divisionId ? -1 : 1),
  );

  for (const shape of shapes) {
    // A division needs at least as many days as its dependency chain is deep,
    // since one level cannot start until the level before it has finished.
    const minDays = Math.min(grid.days, Math.max(1, shape.maxLevel + 1 > grid.days ? grid.days : 1));
    let start = 0;
    let need = shape.minutes;
    let end = 0;
    for (let d = 0; d < grid.days; d++) {
      if (remaining[d] <= 0) continue;
      if (need === shape.minutes) start = d;
      const take = Math.min(remaining[d], need);
      remaining[d] -= take;
      need -= take;
      end = d;
      if (need <= 0) break;
    }
    if (end - start + 1 < minDays) end = Math.min(grid.days - 1, start + minDays - 1);
    out.set(shape.divisionId, [start, Math.max(start, end)]);
  }
  return out;
}

/** Which courts each division prefers.
 *
 *  Divisions are clustered by net height first, so divisions needing the same
 *  height sit on the same court tracks and the nets rarely have to move; the
 *  busiest height cohort gets the earliest courts. Inside a cohort, gendered
 *  divisions come before Mixed (Mixed usually draws players from the gendered
 *  draws, so it should run after them) and larger divisions come first. */
export function courtAffinity(
  divisions: SchedulableDivision[],
  courts: CourtSpec[],
  /** divisionId -> courts its pool rotation actually occupies. A division whose
   *  round robin runs four matches at a time needs four courts of its own; give
   *  it two and it spills onto its neighbour's every turn, moving a net each
   *  time. The organizer's explicit override still wins over both. */
  appetite: Map<string, number> = new Map(),
): Map<string, Set<string>> {
  const isMixed = (d: SchedulableDivision) => (d.gender ?? '').toLowerCase().includes('mix');

  const groups = new Map<string, SchedulableDivision[]>();
  for (const d of divisions) {
    const h = parseNetHeight(d.netHeight);
    const key = h == null ? 'unknown' : String(h);
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  const ordered = [...groups.values()]
    .map(ds => ({ ds, volume: ds.reduce((s, d) => s + d.matches.length, 0) }))
    .sort((a, b) => b.volume - a.volume)
    .flatMap(g =>
      [...g.ds].sort((a, b) => {
        const am = isMixed(a) ? 1 : 0;
        const bm = isMixed(b) ? 1 : 0;
        if (am !== bm) return am - bm;
        if (a.matches.length !== b.matches.length) return b.matches.length - a.matches.length;
        return a.id < b.id ? -1 : 1;
      }),
    );

  const want = ordered.map(div =>
    Math.max(
      1,
      Math.min(
        courts.length,
        Math.trunc(
          div.dedicatedCourts ?? appetite.get(div.id) ?? autoDedicatedCourts(div.pools),
        ) || 1,
      ),
    ),
  );

  // Appetites can add up to more than the venue — two divisions each wanting
  // every court is a normal thing to want. Scale them back proportionally so
  // the blocks below stay disjoint; a shared court belongs to nobody and ends
  // up hosting every height, which is the churn this is here to prevent.
  const total = want.reduce((s, n) => s + n, 0);
  if (total > courts.length) {
    let left = courts.length;
    for (let i = 0; i < want.length; i++) {
      const share = Math.max(1, Math.round((want[i] / total) * courts.length));
      want[i] = Math.max(1, Math.min(share, left - (want.length - 1 - i)));
      left -= want[i];
    }
  }

  // Hand out any court nobody asked for, to whichever division is carrying the
  // most matches per court it already has. Leaving courts unclaimed is what
  // makes a schedule churn nets: matches spill onto them in whatever order they
  // come up, and a court that belongs to nobody ends up hosting every height.
  let spare = courts.length - want.reduce((s, n) => s + n, 0);
  while (spare > 0) {
    let pick = -1;
    let heaviest = -1;
    for (let i = 0; i < ordered.length; i++) {
      if (want[i] >= courts.length || want[i] >= ordered[i].matches.length) continue;
      const load = ordered[i].matches.length / want[i];
      if (load > heaviest) {
        heaviest = load;
        pick = i;
      }
    }
    if (pick < 0) break;
    want[pick]++;
    spare--;
  }

  // Contiguous blocks, in the clustered order, so divisions needing the same
  // net height end up on neighbouring courts.
  const out = new Map<string, Set<string>>();
  let cursor = 0;
  ordered.forEach((div, i) => {
    const prefer = new Set<string>();
    for (let k = 0; k < want[i]; k++) {
      prefer.add(courts[cursor % courts.length].name);
      cursor++;
    }
    out.set(div.id, prefer);
  });
  return out;
}
