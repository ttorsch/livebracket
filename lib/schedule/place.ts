// Placement — the venue as N court queues.
//
// Every court is a column, filled downward. A court's next match starts the
// minute the previous one ends, and the generator walks courts 1…N in order
// giving each one its next match, then comes round again. There is no clock to
// simulate and nothing waits for a real court to free: this is a preview an
// organizer reads off a wall chart.
//
// That replaces four generations of machinery that had accumulated on top of
// each other — an auction over every match and every court, court affinity to
// stop the auction scattering divisions, a day plan to stop it front-loading,
// and all-or-nothing waves to stop affinity being ignored. Each layer had been
// added to fix a symptom of the one before it and none had been removed, so
// they contradicted each other and the contradictions were patched in place.
// The worst of it was structural rather than cosmetic: a wave that could never
// find enough free courts at one instant was held forever, so matches came out
// unplaced while the venue stood visibly idle.
//
// A court queue cannot do that. A court either has a legal match to take or it
// has none, and if it has none it moves to the first moment it might.
//
// Three things decide a placement, and they are strictly separated:
//
//   eligibility  which matches this court is allowed to consider at all
//   feasibility  the earliest minute a match could legally start there
//   the score    which of the allowed matches it takes (see score.ts)
//
// See .scratch/schedule-placement/issues/20-placement-by-court-queue.md

import type { MatchGraph, MatchNode } from './graph.ts';
import { DAY_SPAN, type Grid } from './grid.ts';
import type { BlockedPeriod, ScheduleConfig } from './types.ts';
import { parseHHMM, parseNetHeight } from './types.ts';
import { normaliseBuffer } from './netChange.ts';
import { allotBlocks, appetiteOf, cohortRank, divisionQueue, type Appetite } from './appetite.ts';
import { compareCandidates, poolKey, scoreCandidate, type CourtHistory } from './score.ts';

/** One match's court, day and time. */
export interface Placement {
  matchId: string;
  courtIndex: number;
  courtName: string;
  /** Signed offset from the tournament's start date. */
  day: number;
  /** day * 1440 + minute of day. */
  startAbs: number;
  endAbs: number;
  /** True when the net had to move for this match. */
  netChange: boolean;
}

export interface PlaceResult {
  placements: Placement[];
  /** Matches with nowhere to go inside the event's days. */
  unplaced: string[];
  /** What each division wanted, for the organizer to see. */
  appetites: Appetite[];
  /** The order divisions took the venue in. */
  queue: string[];
}

/** How far past lunch or the end of the day a match may run.
 *
 *  A boundary that refuses a match finishing four minutes late costs a whole
 *  slot of court time to save four minutes nobody would notice. A *blocked
 *  period* gets no such tolerance: a ceremony on a named court is a thing
 *  actually happening there. */
const OVERRUN = 0.2;

/** Divisions on court at once. Two: any more and roster overlap starts
 *  double-booking real people, who are entered in several divisions under
 *  unrelated team ids the solver cannot connect. */
const CONCURRENT_DIVISIONS = 2;

type Phase = 'pool' | 'early' | 'semifinal' | 'third' | 'final';

interface CourtState extends CourtHistory {
  index: number;
  name: string;
  /** Earliest minute this court is next available. */
  freeAt: number;
  /** End of the last match played here; -Infinity on an untouched court. */
  lastEndAbs: number;
  /** Division whose block this court currently belongs to. */
  ownerId: string | null;
  /** No candidate will ever reach this court again. */
  exhausted: boolean;
}

interface Interval { s: number; e: number }

const teamsOf = (n: MatchNode): string[] =>
  [n.teamA, n.teamB].filter((t): t is string => Boolean(t));

export function placeMatches(
  graph: MatchGraph,
  grid: Grid,
  config: ScheduleConfig,
): PlaceResult {
  const buffer = normaliseBuffer(config.netBufferMinutes);
  const matchesOf = new Map<string, MatchNode[]>();
  for (const node of graph.nodes.values()) {
    const list = matchesOf.get(node.divisionId);
    if (list) list.push(node);
    else matchesOf.set(node.divisionId, [node]);
  }

  const appetites = [...matchesOf.entries()].map(([id, ms]) => appetiteOf(id, ms));
  const appetiteOfDivision = new Map(appetites.map(a => [a.divisionId, a]));
  const shapeOf = (id: string) => graph.divisions.get(id);
  const queue = divisionQueue(appetites, id => {
    const shape = shapeOf(id);
    return cohortRank({ gender: shape?.gender, label: shape?.label });
  });

  const heightOf = new Map<string, number | null>();
  for (const [id, shape] of graph.divisions) heightOf.set(id, shape.netHeight);

  const blockedOn = courtBlocks(config, grid);

  const courts: CourtState[] = grid.courts.map((spec, index) => ({
    index,
    name: spec.name,
    freeAt: grid.dayStart,
    lastEndAbs: -Infinity,
    height: spec.netHeight ?? null,
    lastDivisionId: null,
    poolsPlayed: new Set<string>(),
    ownerId: null,
    exhausted: false,
  }));

  const remaining = new Set(graph.order);
  const placements = new Map<string, Placement>();
  const endOf = new Map<string, number>();
  const teamBusy = new Map<string, Interval[]>();
  const poolLastStart = new Map<string, number>();
  /** The one court every final is played on, claimed by the first final. */
  let finalsCourt: number | null = null;

  // ── The phase of a match, and what the endgame programme demands of it ──
  //
  // The medal rounds are a programme rather than a queue: semifinals one
  // division at a time so the division that is waiting is resting rather than
  // idling, every play-off for 3rd together, and finals one after another on a
  // single court so the whole venue has one match to watch. Expressed as
  // ordering rules on the candidate set rather than as all-or-nothing waves —
  // a wave is what used to deadlock, and two semifinals that are the only
  // eligible matches land side by side on their own.
  const phaseOf = (node: MatchNode): Phase => {
    if (node.isPool) return 'pool';
    const maxLevel = shapeOf(node.divisionId)?.maxLevel ?? 0;
    if (maxLevel < 1) return 'early';
    if (node.isThirdPlace) return 'third';
    if (node.level === maxLevel) return 'final';
    if (node.level === maxLevel - 1) return 'semifinal';
    return 'early';
  };

  const byPhase = new Map<Phase, MatchNode[]>();
  for (const node of graph.nodes.values()) {
    const phase = phaseOf(node);
    const list = byPhase.get(phase);
    if (list) list.push(node);
    else byPhase.set(phase, [node]);
  }
  const phaseMatches = (p: Phase) => byPhase.get(p) ?? [];

  const allPlaced = (nodes: MatchNode[]) => nodes.every(n => placements.has(n.id));
  const latestEnd = (nodes: MatchNode[]) =>
    nodes.reduce((t, n) => Math.max(t, endOf.get(n.id) ?? -Infinity), -Infinity);

  /** Is this match's phase open, and from when? -1 means "not yet". */
  const phaseFloor = (node: MatchNode): number => {
    const phase = phaseOf(node);
    if (phase === 'pool' || phase === 'early') return -Infinity;

    if (phase === 'semifinal') {
      // One division's semifinals at a time: any other division that has
      // started its semifinals must have placed all of them, and this
      // division's cannot begin until those have finished.
      let floor = -Infinity;
      for (const [id] of graph.divisions) {
        if (id === node.divisionId) continue;
        const theirs = phaseMatches('semifinal').filter(n => n.divisionId === id);
        if (theirs.length === 0) continue;
        const started = theirs.some(n => placements.has(n.id));
        if (!started) continue;
        if (!allPlaced(theirs)) return -1; // mid-round elsewhere; wait
        floor = Math.max(floor, latestEnd(theirs));
      }
      return floor;
    }

    if (phase === 'third') {
      const semis = phaseMatches('semifinal');
      if (!allPlaced(semis)) return -1;
      return latestEnd(semis);
    }

    // A final waits on every play-off for 3rd, and on every earlier final —
    // they are played one at a time.
    const thirds = phaseMatches('third');
    if (!allPlaced(thirds)) return -1;
    let floor = Math.max(latestEnd(thirds), latestEnd(phaseMatches('semifinal')));
    for (const other of phaseMatches('final')) {
      if (other.id === node.id) continue;
      const end = endOf.get(other.id);
      if (end !== undefined) floor = Math.max(floor, end);
    }
    return floor;
  };

  /** The lowest round a division still has matches in. Placement never runs
   *  ahead of it, so a division finishes each round before opening the next
   *  and the endgame cannot start beside its own pool play. */
  const currentRound = (divisionId: string): number => {
    let lowest = Infinity;
    for (const id of remaining) {
      const node = graph.nodes.get(id)!;
      if (node.divisionId === divisionId) lowest = Math.min(lowest, node.roundIndex);
    }
    return lowest;
  };

  const divisionDone = (divisionId: string): boolean => {
    for (const id of remaining) {
      if (graph.nodes.get(id)!.divisionId === divisionId) return false;
    }
    return true;
  };

  // ── The walk ────────────────────────────────────────────────────────────
  const maxPasses = graph.nodes.size + grid.courts.length + 8;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (remaining.size === 0) break;

    // The front of the queue takes the venue. When a division finishes, the
    // next one enters and the blocks are re-cut around it — which is the
    // handover, and the one moment a whole block may be re-rigged at once.
    const running = queue
      .filter(id => !divisionDone(id))
      .slice(0, CONCURRENT_DIVISIONS)
      .map(id => appetiteOfDivision.get(id)!)
      .filter(Boolean);
    if (running.length === 0) break;

    for (const block of allotBlocks(running, courts.length)) {
      for (const c of block.courts) courts[c].ownerId = block.divisionId;
    }
    // A court whose net nobody has declared takes its owner's height for free:
    // nets are rigged in the morning, not mid-match.
    for (const court of courts) {
      if (court.lastEndAbs === -Infinity && court.ownerId) {
        court.height = heightOf.get(court.ownerId) ?? court.height;
      }
    }

    const runningIds = new Set(running.map(r => r.divisionId));
    const roundOf = new Map<string, number>();
    for (const id of runningIds) roundOf.set(id, currentRound(id));

    let placedThisPass = false;
    for (const court of courts) {
      if (court.exhausted || remaining.size === 0) continue;

      const ownerFinished = court.ownerId == null || divisionDone(court.ownerId);
      let best: { node: MatchNode; start: number; netChange: boolean; score: number; tie: ReturnType<typeof tieOf> } | null = null;
      let earliestSeen = Infinity;

      for (const id of remaining) {
        const node = graph.nodes.get(id)!;
        if (!runningIds.has(node.divisionId)) continue;
        if (node.roundIndex !== roundOf.get(node.divisionId)) continue;

        // Court ownership. A division plays on its own block. Another
        // division may borrow an idle court only at **zero net change** —
        // which is what a reservation always should have been, and what a
        // 26-point preference never was. A block whose owner has finished
        // everything is released outright, and re-rigged once.
        const owns = node.divisionId === court.ownerId;
        const freeSwap = node.netHeight == null || court.height == null || court.height === node.netHeight;
        if (!owns && !ownerFinished && !freeSwap) continue;

        const floor = phaseFloor(node);
        if (floor === -1) continue;
        if (phaseOf(node) === 'final' && finalsCourt !== null && court.index !== finalsCourt) continue;

        const option = earliestOn(node, court, floor);
        if (!option) continue;

        // A court takes the first thing it can, and only ranks what it could
        // have taken then. Without this a match available two hours later
        // could outscore one available now and the column would stall.
        if (option.start > earliestSeen) continue;
        if (option.start < earliestSeen) {
          earliestSeen = option.start;
          best = null;
        }

        const score = scoreCandidate(node, court, {
          backToBack: option.backToBack,
          netChange: option.netChange,
        });
        const tie = tieOf(node, option.start);
        const candidate = { node, start: option.start, netChange: option.netChange, score, tie };
        if (!best || compareCandidates(candidate, best) < 0) best = candidate;
      }

      if (!best) {
        court.exhausted = true;
        continue;
      }
      commit(best.node, court, best.start, best.netChange);
      placedThisPass = true;
    }

    if (!placedThisPass) break;
  }

  const ordered = [...placements.values()].sort(
    (a, b) => a.startAbs - b.startAbs || a.courtIndex - b.courtIndex,
  );

  return { placements: ordered, unplaced: [...remaining], appetites, queue };

  // ── Feasibility ─────────────────────────────────────────────────────────

  function tieOf(node: MatchNode, start: number) {
    let rested = -Infinity;
    for (const team of teamsOf(node)) {
      for (const iv of teamBusy.get(team) ?? []) rested = Math.max(rested, iv.e);
    }
    for (const dep of node.deps) rested = Math.max(rested, endOf.get(dep) ?? -Infinity);
    const key = poolKey(node);
    return {
      teamsRestedSince: rested,
      poolLastStart: key ? poolLastStart.get(key) ?? -Infinity : -Infinity,
      indexInRound: node.indexInRound,
      matchId: node.id,
      start,
    };
  }

  /** The earliest minute this match could legally start on this court, or
   *  null when there is no such minute inside the event. */
  function earliestOn(
    node: MatchNode,
    court: CourtState,
    floor: number,
  ): { start: number; netChange: boolean; backToBack: boolean } | null {
    const duration = node.durationMinutes;

    let t = Math.max(court.freeAt, floor);
    // Every feeder must be finished. A knockout match also owes rest to the
    // team coming through it, which is the only handle there is on a side the
    // draw has not named yet.
    for (const dep of node.deps) {
      const end = endOf.get(dep);
      if (end === undefined) return null;
      t = Math.max(t, end);
    }

    let netChange = false;
    for (let round = 0; round < 4; round++) {
      const settled = settle(node, court, t, duration);
      if (settled === null) return null;
      t = settled;

      // A net change is a wait, not a flat charge: the crew starts the moment
      // the previous match ends, so a match already sitting far enough after
      // one pays nothing — and a court's first match of a *day* pays nothing
      // at all, because nets are rigged before play starts.
      const sameDay =
        court.lastEndAbs > -Infinity &&
        Math.floor(court.lastEndAbs / DAY_SPAN) === Math.floor(t / DAY_SPAN);
      netChange =
        sameDay && node.netHeight != null && court.height != null && court.height !== node.netHeight;
      if (!netChange) break;
      const ready = court.lastEndAbs + buffer;
      if (t >= ready) break;
      t = ready;
    }

    let backToBack = false;
    for (const team of teamsOf(node)) {
      for (const iv of teamBusy.get(team) ?? []) if (iv.e === t) backToBack = true;
    }
    for (const dep of node.deps) if (endOf.get(dep) === t) backToBack = true;

    return { start: t, netChange, backToBack };
  }

  /** Push `t` forward until the match fits: no team double-booked, inside a
   *  playing run, and clear of any blocked period. Returns null once it would
   *  run past the last day.
   *
   *  The two constraints feed each other — sliding past lunch can land a match
   *  on top of a team's other booking, and stepping past that booking can push
   *  it back out of the day — so they are alternated to a fixed point rather
   *  than applied once each. */
  function settle(
    node: MatchNode,
    court: CourtState,
    from: number,
    duration: number,
  ): number | null {
    let t = from;
    for (let i = 0; i < 64; i++) {
      const clearOfTeams = pastTeamBookings(node, t, duration);
      const fitted = fitToDay(court, clearOfTeams, duration);
      if (fitted === null) return null;
      if (fitted === clearOfTeams) return fitted;
      t = fitted;
    }
    return t;
  }

  /** The first minute at or after `from` where neither side of this match is
   *  already on court. A team can only be in one place at a time, and courts
   *  are filled column by column rather than in strict time order, so a team's
   *  later booking on another court is already on the board. */
  function pastTeamBookings(node: MatchNode, from: number, duration: number): number {
    let t = from;
    for (let i = 0; i < 64; i++) {
      let moved = false;
      for (const team of teamsOf(node)) {
        for (const iv of teamBusy.get(team) ?? []) {
          if (t < iv.e && iv.s < t + duration) {
            t = iv.e;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return t;
  }

  /** Slide `t` into the first minute of a playing run that can hold the whole
   *  match, on this day or a later one. */
  function fitToDay(court: CourtState, from: number, duration: number): number | null {
    let t = from;
    const tolerance = Math.floor(duration * OVERRUN);

    for (let i = 0; i < 512; i++) {
      const day = Math.floor(t / DAY_SPAN);
      if (day >= grid.days) return null;
      const base = day * DAY_SPAN;
      const start = t - base;

      if (start < grid.dayStart) {
        t = base + grid.dayStart;
        continue;
      }
      if (start + duration > grid.dayEnd + tolerance) {
        t = (day + 1) * DAY_SPAN + grid.dayStart;
        continue;
      }
      if (grid.lunch) {
        const { start: ls, end: le } = grid.lunch;
        if (start >= ls && start < le) {
          t = base + le;
          continue;
        }
        if (start < ls && start + duration > ls + tolerance) {
          t = base + le;
          continue;
        }
      }
      const clash = blockedUntil(court.index, day, start, duration);
      if (clash !== null) {
        t = base + clash;
        continue;
      }
      return t;
    }
    return null;
  }

  /** End of the first blocked period this match would run into, or null. */
  function blockedUntil(courtIndex: number, day: number, start: number, duration: number): number | null {
    for (const period of blockedOn(courtIndex, day)) {
      if (start < period.end && period.start < start + duration) return period.end;
    }
    return null;
  }

  function commit(node: MatchNode, court: CourtState, start: number, netChange: boolean): void {
    const end = start + node.durationMinutes;
    const day = Math.floor(start / DAY_SPAN);

    placements.set(node.id, {
      matchId: node.id,
      courtIndex: court.index,
      courtName: court.name,
      day,
      startAbs: start,
      endAbs: end,
      netChange,
    });
    endOf.set(node.id, end);
    remaining.delete(node.id);

    court.freeAt = end;
    court.lastEndAbs = end;
    court.lastDivisionId = node.divisionId;
    if (node.netHeight != null) court.height = node.netHeight;
    const key = poolKey(node);
    if (key) {
      court.poolsPlayed.add(key);
      poolLastStart.set(key, Math.max(poolLastStart.get(key) ?? -Infinity, start));
    }
    for (const team of teamsOf(node)) {
      const list = teamBusy.get(team);
      if (list) list.push({ s: start, e: end });
      else teamBusy.set(team, [{ s: start, e: end }]);
    }
    if (phaseOf(node) === 'final' && finalsCourt === null) finalsCourt = court.index;
    // A court that has been given work is worth asking again.
    for (const c of courts) c.exhausted = false;
  }
}

/** Court time the organizer has taken off the board, as minute windows per
 *  court and day. Read from the config rather than off the grid's slot map,
 *  because a court queue starts matches on real minutes rather than on slot
 *  boundaries. Auto-generated net-adjust markers are ignored: they describe a
 *  previous generation's output, not the organizer's intent. */
function courtBlocks(config: ScheduleConfig, grid: Grid) {
  const periods: (BlockedPeriod & { s: number; e: number })[] = (config.blocks ?? [])
    .filter(b => b.label !== 'Net Adjust')
    .map(b => ({ ...b, s: parseHHMM(b.start), e: parseHHMM(b.end) }))
    .filter(b => b.e > b.s);

  return (courtIndex: number, day: number): { start: number; end: number }[] => {
    const name = grid.courts[courtIndex]?.name;
    return periods
      .filter(b => (b.court == null || b.court === name) && (b.day == null || b.day === day))
      .map(b => ({ start: b.s, end: b.e }));
  };
}

/** Net height a division declares, parsed once. Re-exported so callers that
 *  hold raw divisions rather than a graph ask the same question. */
export { parseNetHeight };
