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
import { autoDedicatedCourts, divisionGenderCohort, divisionGenderRank, parseNetHeight } from './types.ts';
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

    // Walk the division's matches in dependency order.
    // Pool play and opening stages target the earliest available day (first).
    // Finals target the last day when finalsOnLastDay is enabled.
    // Artificial per-day minute quotas are retired so court time is filled greedily.
    const ordered = graph.order.filter(id => graph.nodes.get(id)!.divisionId === divisionId);
    for (const id of ordered) {
      const node = graph.nodes.get(id)!;
      const isFinalRound = node.level === shape.maxLevel && shape.maxLevel > 0;
      const holdForFinals = config.finalsOnLastDay && days > 1 && isFinalRound;
      targetDay.set(id, holdForFinals ? last : first);
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
        const gA = divisionGenderRank({ gender: a.gender, label: a.label });
        const gB = divisionGenderRank({ gender: b.gender, label: b.label });
        if (gA !== gB) return gA - gB;
        if (a.matches.length !== b.matches.length) return b.matches.length - a.matches.length;
        return a.id < b.id ? -1 : 1;
      }),
    );

  const dedicated = ordered.map(div =>
    Math.max(
      1,
      Math.trunc(
        div.dedicatedCourts ?? appetite.get(div.id) ?? autoDedicatedCourts(div.pools),
      ) || 1,
    ),
  );

  const totalDedicated = dedicated.reduce((s, n) => s + n, 0);
  const out = new Map<string, Set<string>>();
  const hasCohort0 = ordered.some(d => divisionGenderCohort(d) === 0);
  const cohort0Divs = ordered.filter(d => divisionGenderCohort(d) === 0);
  const cohort1Divs = ordered.filter(d => divisionGenderCohort(d) === 1);

  if (hasCohort0 && cohort0Divs.length > 0) {
    const c0Dedicated = cohort0Divs.map(div =>
      Math.max(
        1,
        Math.trunc(
          div.dedicatedCourts ?? appetite.get(div.id) ?? autoDedicatedCourts(div.pools),
        ) || 1,
      ),
    );
    let cursor = 0;
    cohort0Divs.forEach((div, i) => {
      const wantCount = c0Dedicated[i];
      const prefer = new Set<string>();
      if (wantCount >= courts.length) {
        for (const c of courts) prefer.add(c.name);
      } else {
        for (let k = 0; k < wantCount; k++) {
          prefer.add(courts[(cursor + k) % courts.length].name);
        }
        cursor = (cursor + wantCount) % courts.length;
      }
      out.set(div.id, prefer);
    });

    // Cohort 1 (non-gendered) divisions play after Cohort 0 finishes and expand to full venue (Option B)
    cohort1Divs.forEach(div => {
      out.set(div.id, new Set(courts.map(c => c.name)));
    });
  } else if (totalDedicated <= courts.length) {
    // Dedicated courts fit concurrently in the venue. Allocate disjoint contiguous court blocks.
    let cursor = 0;
    ordered.forEach((div, i) => {
      const prefer = new Set<string>();
      for (let k = 0; k < dedicated[i]; k++) {
        prefer.add(courts[cursor % courts.length].name);
        cursor++;
      }
      out.set(div.id, prefer);
    });

    // Hand out any spare court to whichever division has the highest load per court
    let spare = courts.length - cursor;
    while (spare > 0) {
      let pick = -1;
      let heaviest = -1;
      for (let i = 0; i < ordered.length; i++) {
        const set = out.get(ordered[i].id)!;
        if (set.size >= courts.length || set.size >= ordered[i].matches.length) continue;
        const load = ordered[i].matches.length / set.size;
        if (load > heaviest) {
          heaviest = load;
          pick = i;
        }
      }
      if (pick < 0) break;
      out.get(ordered[pick].id)!.add(courts[cursor % courts.length].name);
      cursor++;
      spare--;
    }
  } else {
    // Total dedicated courts exceed the venue count, so divisions run in block waves.
    // If a division has dedicated courts >= courts.length (or fits the full venue),
    // it uses all courts during its wave without divisionSpread penalty.
    let cursor = 0;
    ordered.forEach((div, i) => {
      const wantCount = dedicated[i];
      const prefer = new Set<string>();
      if (wantCount >= courts.length) {
        for (const c of courts) prefer.add(c.name);
      } else {
        for (let k = 0; k < wantCount; k++) {
          prefer.add(courts[(cursor + k) % courts.length].name);
        }
        cursor = (cursor + wantCount) % courts.length;
      }
      out.set(div.id, prefer);
    });
  }

  return out;
}
