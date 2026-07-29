// The tournament as a dependency graph.
//
// The old generator ordered matches by round number and leaned on a "round N
// must be fully placed before round N+1" rule. That is a blunt instrument: it
// serialises matches that are genuinely independent (two different pools, two
// halves of a bracket) and it cannot express anything finer than "later round".
//
// Here every match is a node and every "this must finish first" relationship is
// an edge. From that one structure three things fall out that the scheduler
// needs and could not otherwise compute:
//
//   level  — how many matches deep from the start. Matches on the same level
//            are mutually independent and may run simultaneously.
//   depth  — the longest chain still ahead of this match. depth 0 is a final.
//            This is what tells the cost function a match is "late-stage" and
//            should not be played at 09:00 on day one.
//   critical path — the longest chain of matches by duration. This is the hard
//            floor on how long the event can possibly take. Twenty courts
//            cannot play a semi-final before its quarter-final is over, so an
//            event whose critical path exceeds the available days does not fit
//            no matter how much court space is added.
//
// Edges are supplied explicitly when the caller knows them (`dependsOn`), and
// otherwise inferred from round structure, which mirrors how the bracket is
// actually built in lib/divisionMatches.ts:
//   - pool matches depend on nothing;
//   - the round that opens the knockout depends on every pool match in its
//     division, because it is drawn off the final pool standings;
//   - each later knockout match depends on the two matches feeding its slot.

import type { SchedulableDivision, SchedulableMatch } from './types.ts';
import { DEFAULT_MATCH_MINUTES } from './types.ts';

export interface MatchNode {
  id: string;
  divisionId: string;
  divisionLabel: string;
  teamA: string | null;
  teamB: string | null;
  refereeTeam: string | null;
  isPool: boolean;
  /** Pool name for a round-robin match, null otherwise. */
  pool: string | null;
  /** The play-off for 3rd: same depth as the final, played before it. */
  isThirdPlace: boolean;
  durationMinutes: number;
  roundIndex: number;
  /** Position of this match inside its division's round, in input order. */
  indexInRound: number;
  netHeight: number | null;
  deps: string[];
  /** Matches that depend on this one — the reverse edges. */
  dependents: string[];
  level: number;
  depth: number;
  /** Longest remaining chain in minutes, this match included. */
  tailMinutes: number;
}

export interface DivisionShape {
  divisionId: string;
  label: string;
  /** Deepest level any of its matches sits at; the division's final round. */
  maxLevel: number;
  matchIds: string[];
  minutes: number;
}

export interface MatchGraph {
  nodes: Map<string, MatchNode>;
  /** Topological order — every match appears after everything it depends on. */
  order: string[];
  /** Match ids grouped by level. */
  levels: string[][];
  divisions: Map<string, DivisionShape>;
  /** Longest dependency chain, in minutes and in matches. */
  criticalPathMinutes: number;
  criticalPathMatches: number;
  /** Edges dropped because they would have formed a cycle. Should always be
   *  empty for a well-formed bracket; non-empty means the caller handed us
   *  something contradictory and we broke it rather than hanging. */
  brokenEdges: { from: string; to: string }[];
}

function durationOf(m: SchedulableMatch, block: number): number {
  const raw = m.durationMinutes ?? block ?? DEFAULT_MATCH_MINUTES;
  return Math.max(1, Math.trunc(raw) || block || DEFAULT_MATCH_MINUTES);
}

/** Group a division's matches by their round index, preserving input order
 *  inside each round and returning rounds in ascending index order. */
function roundsOf(div: SchedulableDivision): { roundIndex: number; matches: SchedulableMatch[] }[] {
  const byRound = new Map<number, SchedulableMatch[]>();
  for (const m of div.matches) {
    const r = m.roundIndex ?? 0;
    const list = byRound.get(r);
    if (list) list.push(m);
    else byRound.set(r, [m]);
  }
  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([roundIndex, matches]) => ({ roundIndex, matches }));
}

/** Dependency edges for one division, inferred from its round structure. */
function inferDeps(div: SchedulableDivision): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const rounds = roundsOf(div);
  const poolIds = div.matches.filter(m => m.isPool).map(m => m.id);

  let previousKnockout: SchedulableMatch[] | null = null;

  for (const round of rounds) {
    const isPoolRound = round.matches.every(m => m.isPool);
    if (isPoolRound) {
      // Round-robin: every match is independent of every other. Ordering
      // within a pool is a rest question, not a correctness one, and the cost
      // function handles rest.
      for (const m of round.matches) out.set(m.id, []);
      continue;
    }

    // The play-off for 3rd is drawn from two *losers*, so the halving rule
    // below says nothing useful about it — and because it is drawn after the
    // final, applying that rule anyway would have it wait on the final. Its
    // edges can only come from the caller, via `dependsOn`.
    const contenders = round.matches.filter(m => !m.isThirdPlace);
    if (contenders.length === 0) continue;

    for (const [i, m] of contenders.entries()) {
      if (!previousKnockout) {
        // First knockout round: seeded off the completed pool standings, so it
        // waits on all of pool play — not just on the pools its own teams came
        // from, because a crossover can draw from any pool.
        out.set(m.id, [...poolIds]);
        continue;
      }
      // Slot i of this round is fed by slots 2i and 2i+1 of the round before.
      const feeders = [previousKnockout[2 * i], previousKnockout[2 * i + 1]]
        .filter((f): f is SchedulableMatch => Boolean(f))
        .map(f => f.id);
      // A round that isn't a clean halving of the one before it (consolation
      // brackets, odd shapes) can't be read slot-by-slot; fall back to waiting
      // on the whole previous round, which is always correct if conservative.
      out.set(m.id, feeders.length > 0 ? feeders : previousKnockout.map(f => f.id));
    }
    previousKnockout = contenders;
  }

  return out;
}

export function buildGraph(
  divisions: SchedulableDivision[],
  blockMinutes: number,
): MatchGraph {
  const nodes = new Map<string, MatchNode>();
  const divisionShapes = new Map<string, DivisionShape>();

  for (const div of divisions) {
    const inferred = inferDeps(div);
    const rounds = roundsOf(div);
    const indexInRound = new Map<string, number>();
    for (const round of rounds) {
      round.matches.forEach((m, i) => indexInRound.set(m.id, i));
    }

    for (const m of div.matches) {
      nodes.set(m.id, {
        id: m.id,
        divisionId: div.id,
        divisionLabel: div.label,
        teamA: m.teamA,
        teamB: m.teamB,
        refereeTeam: m.refereeTeam ?? null,
        isPool: m.isPool,
        pool: m.pool ?? null,
        isThirdPlace: !!m.isThirdPlace,
        durationMinutes: durationOf(m, blockMinutes),
        roundIndex: m.roundIndex ?? 0,
        indexInRound: indexInRound.get(m.id) ?? 0,
        netHeight: null, // filled by the caller from the division; see generate.ts
        deps: m.dependsOn ?? inferred.get(m.id) ?? [],
        dependents: [],
        level: 0,
        depth: 0,
        tailMinutes: 0,
      });
    }

    divisionShapes.set(div.id, {
      divisionId: div.id,
      label: div.label,
      maxLevel: 0,
      matchIds: div.matches.map(m => m.id),
      minutes: div.matches.reduce((s, m) => s + durationOf(m, blockMinutes), 0),
    });
  }

  // Drop edges pointing at matches we were never given, so a partially-loaded
  // division can still be scheduled instead of failing outright.
  for (const node of nodes.values()) {
    node.deps = node.deps.filter(d => nodes.has(d) && d !== node.id);
  }

  const brokenEdges = breakCycles(nodes);

  for (const node of nodes.values()) {
    for (const dep of node.deps) nodes.get(dep)!.dependents.push(node.id);
  }

  const order = topoOrder(nodes);

  // level: longest path from a source. Computed forwards over the topological
  // order, so every dependency is already final when a node is visited.
  for (const id of order) {
    const node = nodes.get(id)!;
    let level = 0;
    for (const dep of node.deps) level = Math.max(level, nodes.get(dep)!.level + 1);
    node.level = level;
  }

  // depth/tail: longest path to a terminal. Computed backwards over the same
  // order for the same reason.
  for (let i = order.length - 1; i >= 0; i--) {
    const node = nodes.get(order[i])!;
    let depth = 0;
    let tail = 0;
    for (const child of node.dependents) {
      const c = nodes.get(child)!;
      depth = Math.max(depth, c.depth + 1);
      tail = Math.max(tail, c.tailMinutes);
    }
    node.depth = depth;
    node.tailMinutes = tail + node.durationMinutes;
  }

  const levels: string[][] = [];
  for (const id of order) {
    const node = nodes.get(id)!;
    (levels[node.level] ??= []).push(id);
    const shape = divisionShapes.get(node.divisionId);
    if (shape) shape.maxLevel = Math.max(shape.maxLevel, node.level);
  }
  for (let i = 0; i < levels.length; i++) levels[i] ??= [];

  let criticalPathMinutes = 0;
  let criticalPathMatches = 0;
  for (const node of nodes.values()) {
    if (node.level === 0) {
      criticalPathMinutes = Math.max(criticalPathMinutes, node.tailMinutes);
    }
    criticalPathMatches = Math.max(criticalPathMatches, node.depth + 1);
  }

  return {
    nodes,
    order,
    levels,
    divisions: divisionShapes,
    criticalPathMinutes,
    criticalPathMatches,
    brokenEdges,
  };
}

/** Remove the minimum obvious set of edges that make the graph cyclic. A valid
 *  bracket never needs this; it exists so bad input degrades into a schedule
 *  with a warning rather than an infinite loop. */
function breakCycles(nodes: Map<string, MatchNode>): { from: string; to: string }[] {
  const broken: { from: string; to: string }[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // unvisited / on-stack / done

  const visit = (id: string): void => {
    state.set(id, 1);
    const node = nodes.get(id)!;
    const keep: string[] = [];
    for (const dep of node.deps) {
      const s = state.get(dep) ?? 0;
      if (s === 1) {
        broken.push({ from: dep, to: id }); // closes a loop — drop it
        continue;
      }
      if (s === 0) visit(dep);
      keep.push(dep);
    }
    node.deps = keep;
    state.set(id, 2);
  };

  for (const id of nodes.keys()) if ((state.get(id) ?? 0) === 0) visit(id);
  return broken;
}

/** Kahn's algorithm, with ties broken deterministically so the same input
 *  always produces the same order (and therefore the same schedule). */
function topoOrder(nodes: Map<string, MatchNode>): string[] {
  const indegree = new Map<string, number>();
  for (const [id, node] of nodes) indegree.set(id, node.deps.length);

  const ready = [...nodes.keys()].filter(id => (indegree.get(id) ?? 0) === 0);
  ready.sort(compareIds(nodes));

  const out: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    out.push(id);
    for (const child of nodes.get(id)!.dependents) {
      const left = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, left);
      if (left === 0) {
        // Keep `ready` sorted on insert rather than re-sorting the whole list.
        const cmp = compareIds(nodes);
        let lo = 0;
        let hi = ready.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cmp(ready[mid], child) <= 0) lo = mid + 1;
          else hi = mid;
        }
        ready.splice(lo, 0, child);
      }
    }
  }

  // Anything left over sat in a cycle we failed to break; append it so no match
  // is silently lost.
  if (out.length < nodes.size) {
    const seen = new Set(out);
    for (const id of nodes.keys()) if (!seen.has(id)) out.push(id);
  }
  return out;
}

function compareIds(nodes: Map<string, MatchNode>) {
  return (a: string, b: string): number => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    if (na.roundIndex !== nb.roundIndex) return na.roundIndex - nb.roundIndex;
    if (na.indexInRound !== nb.indexInRound) return na.indexInRound - nb.indexInRound;
    return na.id < nb.id ? -1 : na.id > nb.id ? 1 : 0;
  };
}
