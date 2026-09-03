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

/** Divisions in **pool play** at once. Two: any more and roster overlap starts
 *  double-booking real people, who are entered in several divisions under
 *  unrelated team ids the solver cannot connect.
 *
 *  It counts round robins and nothing else. A division past its pools is out
 *  of the queue entirely — see the walk. */
const CONCURRENT_POOL_DIVISIONS = 2;

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
  const dailyCap = Math.max(0, Math.trunc(config.maxMatchesPerTeamPerDay) || 0);
  const stageEndgame = config.stageFinals !== false;
  const holdFinals = config.finalsOnLastDay && grid.days > 1;

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
  /** team -> day -> matches played that day, for the per-day cap. */
  const dayCount = new Map<string, Map<number, number>>();
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

  /** Is this a gendered division? Non-gendered draws take their players from
   *  the gendered ones, so their round robins can never overlap. */
  const gendered = (divisionId: string): boolean => {
    const shape = shapeOf(divisionId);
    return cohortRank({ gender: shape?.gender, label: shape?.label }) === 0;
  };
  const genderedPools = [...graph.nodes.values()].filter(n => n.isPool && gendered(n.divisionId));

  // A handful of endgame matches have to start *together* — a division's two
  // semifinals side by side, every play-off for 3rd at once — because that is
  // the programme an organizer runs, not an optimisation. They are the one
  // thing a court queue cannot express on its own: courts drift apart as the
  // day goes on, so two matches taken by two courts land at two times.
  //
  // Kept deliberately small. All-or-nothing placement across the *whole* event
  // is what used to deadlock, stranding matches beside an idle venue; here it
  // covers two to four matches at the very end, and dissolves into ordinary
  // per-court placement if it cannot find its courts, so it can stall the
  // endgame but never lose it.
  const groups: { key: string; matchIds: string[] }[] = [];
  if (stageEndgame) {
    for (const [divisionId] of graph.divisions) {
      const semis = phaseMatches('semifinal').filter(n => n.divisionId === divisionId);
      if (semis.length >= 2) groups.push({ key: `sf:${divisionId}`, matchIds: semis.map(n => n.id) });
    }
    const thirds = phaseMatches('third');
    if (thirds.length >= 2) groups.push({ key: 'third:all', matchIds: thirds.map(n => n.id) });
  }
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const id of g.matchIds) groupOf.set(id, g.key);
  const dissolved = new Set<string>();
  const stalled = new Map<string, number>();


  const allPlaced = (nodes: MatchNode[]) => nodes.every(n => placements.has(n.id));
  const latestEnd = (nodes: MatchNode[]) =>
    nodes.reduce((t, n) => Math.max(t, endOf.get(n.id) ?? -Infinity), -Infinity);

  /** Is this match's phase open, and from when? -1 means "not yet". */
  const phaseFloor = (node: MatchNode): number => {
    const phase = phaseOf(node);

    // The last round of a division is held for the final day of a multi-day
    // event, so the event ends with finals rather than trailing off. It is a
    // floor rather than a filter: the match is not refused, it is simply not
    // available before that morning.
    const shape = shapeOf(node.divisionId);
    const isLastRound = !!shape && shape.maxLevel > 0 && node.level === shape.maxLevel;
    let dayFloor = holdFinals && isLastRound
      ? (grid.days - 1) * DAY_SPAN + grid.dayStart
      : -Infinity;

    // A non-gendered round robin waits for the last gendered one to *finish*,
    // not merely to be placed. Courts drift apart as the day goes on, so the
    // block a Mixed draw is given can stand free while the last Men's pool
    // match is still running on the court beside it — and the same people
    // would be on both.
    if (phase === 'pool') {
      return gendered(node.divisionId)
        ? dayFloor
        : Math.max(dayFloor, latestEnd(genderedPools));
    }

    // The opening round of a bracket answers only to its own feeders, so it is
    // free to take a court a round robin has left standing. That is its job
    // here: a division's appetite is half its field by design, so while the
    // last round robin plays on its two courts the rest of the venue has
    // nothing else it may legally take. Measured on the organizer's
    // tournament, letting the quarter-finals fill those gaps and widening the
    // round robin to fill them both finish at the same minute — and the
    // quarter-finals cost 3 back-to-back matches against 19.
    if (phase === 'early' || !stageEndgame) return dayFloor;

    // No medal round anywhere until every round robin in the event has been
    // played. Said against `isPool` rather than against a round index, because
    // the medal rounds are ordered by phase — the play-off for 3rd is drawn
    // after the final and played before it — so a short bracket running
    // straight from pools to semi-finals has no round for a gate to grip.
    const pools = phaseMatches('pool');
    if (pools.length > 0) {
      if (!allPlaced(pools)) return -1;
      dayFloor = Math.max(dayFloor, latestEnd(pools));
    }

    // And no medal round anywhere until every bracket round before it has been
    // played. Without this the lockstep only reached as far as the rounds the
    // *round index* gates — Women played their semi-finals while Men's
    // quarter-finals had not been played at all, because the score prefers to
    // keep a court on the division that last used it and the medal rounds are
    // ordered by phase rather than by round. The event advances as one field.
    const early = phaseMatches('early');
    if (early.length > 0) {
      if (!allPlaced(early)) return -1;
      dayFloor = Math.max(dayFloor, latestEnd(early));
    }

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
      return Math.max(floor, dayFloor);
    }

    if (phase === 'third') {
      const semis = phaseMatches('semifinal');
      if (!allPlaced(semis)) return -1;
      return Math.max(latestEnd(semis), dayFloor);
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
    return Math.max(floor, dayFloor);
  };

  /** Does this match have to wait for the event's current round?
   *
   *  Pool play and the early knockout do: the whole event finishes a round
   *  before opening the next, which is what keeps one division's bracket from
   *  starting beside another division's round robin.
   *
   *  The medal rounds do not, because round order is not play order there.
   *  The play-off for 3rd is *drawn* after the final — it needs both losing
   *  semifinalists — and *played* before it, so its round index is higher than
   *  the final's. Gating it on round order deadlocked the pair: the final
   *  waited for the play-off, and the play-off waited for a round that would
   *  only come round after the final. Their true order is the phase
   *  programme, and their dependencies are stated outright. */
  const roundGated = (node: MatchNode): boolean => phaseOf(node) === 'pool';

  /** The lowest round *anywhere in the event* that still has matches in it.
   *
   *  Read across every division, not within one. The whole event advances a
   *  round at a time: every round robin is finished before any bracket opens,
   *  and every quarter-final is played before any semi-final is.
   *
   *  Reading it per division let a division race ahead of the field — Women
   *  playing their semi-finals while Mixed was still working through its round
   *  robin, which is not a schedule anyone would write by hand. It also
   *  produced the ugliest thing on the calendar: a bracket that opens the
   *  instant the last pool match ends sends that winner straight back on
   *  court. Measured on the organizer's tournament, reading the round globally
   *  halves those — 16 down to 8 — as a side effect of nothing but ordering.
   *
   *  Divisions of different sizes do not have the same number of rounds, so a
   *  sixteen-team draw's round of 16 runs alongside an eight-team draw's
   *  quarter-finals. That is the right pairing: each is the opening round of
   *  its own bracket. */
  const currentRound = (): number => {
    let lowest = Infinity;
    for (const id of remaining) lowest = Math.min(lowest, graph.nodes.get(id)!.roundIndex);
    return lowest;
  };

  /** Is this division still in its round robin?
   *
   *  A block is a **reservation only while its owner is playing pools**. That
   *  is what the appetite sized it for: half the division on court, half
   *  resting. A knockout round is a different shape — four quarter-finals want
   *  four courts for one slot and then hand them all back — so holding a
   *  division to its pool block past the round robin strands the venue and
   *  runs an entire bracket down a single column. Once the pools are done the
   *  block opens to whoever is running. */
  const inPoolPlay = (divisionId: string): boolean => {
    for (const id of remaining) {
      const node = graph.nodes.get(id)!;
      if (node.divisionId === divisionId && node.isPool) return true;
    }
    return false;
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

    // ── Who is on the venue ──────────────────────────────────────────────
    //
    // **The queue is about pool play, and nothing else.** Two round robins run
    // at a time; a division leaves the queue the moment its pools are done,
    // and its knockout then competes for whatever court is free like any other
    // work. The next division's pools start immediately behind it.
    //
    // Holding a queue slot until a division was *entirely* finished deadlocked
    // the event outright, and the cause was a circular wait rather than a
    // shortage of court time: the play-off for 3rd waits on every division's
    // semifinals, the last division could not reach its semifinals because the
    // first two still held both slots, and so the first two could never
    // finish. Measured on the organizer's own tournament: 22 of 54 matches
    // stranded — one whole division and both play-off/final pairs — with the
    // venue idle from midday on day one.
    //
    // The cost is that a non-gendered division's pools may now overlap a
    // gendered division's *knockout*. That is a far smaller exposure than the
    // rule was written for: a round robin has every team playing, a knockout
    // has four of eight, and it buys back the courts that were standing empty.
    const unfinished = queue.filter(id => !divisionDone(id));
    if (unfinished.length === 0) break;

    // A free slot is not an invitation. A Mixed draw overlaps *both* gendered
    // draws, so it may only begin once neither of them is still in its round
    // robin — one of the two finishing early does not let it in. Without this
    // the smaller gendered division finishes, Mixed takes its slot, and the
    // same people are booked on two courts while the other gendered division
    // is still playing.
    const genderedStillPooling = unfinished.some(id => gendered(id) && inPoolPlay(id));
    const pooling = unfinished
      .filter(id => inPoolPlay(id) && (gendered(id) || !genderedStillPooling))
      .slice(0, CONCURRENT_POOL_DIVISIONS);
    const pastPools = unfinished.filter(id => !inPoolPlay(id));
    const runningIds = new Set([...pooling, ...pastPools]);

    // Blocks are cut for the round robins, each exactly its appetite wide.
    // Whatever is left over is unreserved — and under the round lockstep there
    // is usually nothing that may use it, so it stands idle. That is the
    // honest answer: the only way to fill it is to put the resting half of a
    // division back on court, which is the one thing the appetite exists to
    // prevent.
    for (const court of courts) court.ownerId = null;
    const blocks = allotBlocks(
      pooling.map(id => appetiteOfDivision.get(id)!).filter(Boolean),
      courts.length,
    );
    const blocked_ = new Set(blocks.map(b => b.divisionId));
    for (const block of blocks) {
      for (const c of block.courts) courts[c].ownerId = block.divisionId;
    }
    // A court whose net nobody has declared takes its owner's height for free:
    // nets are rigged in the morning, not mid-match.
    for (const court of courts) {
      if (court.lastEndAbs === -Infinity && court.ownerId) {
        court.height = heightOf.get(court.ownerId) ?? court.height;
      }
    }

    const round = currentRound();

    // Cleared every pass, not on every commit. A court with nothing to take is
    // only exhausted *for this sweep*: the divisions advance a round between
    // passes, so what a court may consider changes underneath it. Carrying the
    // flag forward retired every court one pass before the finals became
    // eligible, and the event finished with its finals unplaced.
    for (const court of courts) court.exhausted = false;

    let placedThisPass = false;

    for (const group of groups) {
      if (dissolved.has(group.key)) continue;
      if (group.matchIds.every(id => !remaining.has(id))) continue;
      const outcome = placeTogether(group.matchIds, runningIds, round);
      if (outcome === 'placed') {
        placedThisPass = true;
        stalled.delete(group.key);
      } else if (outcome === 'crowded') {
        // Only a group that *should* be able to go counts as stalled. One
        // still waiting its turn in the queue, or on an earlier phase, is not
        // stuck — it simply is not due yet.
        const tries = (stalled.get(group.key) ?? 0) + 1;
        stalled.set(group.key, tries);
        // The programme is worth waiting for, but not worth losing matches
        // over: once it is clear the venue will not offer the courts side by
        // side, the round is placed the ordinary way and the organizer sees a
        // staggered endgame rather than an unplaced one.
        if (tries > courts.length + 2) dissolved.add(group.key);
      }
    }

    for (const court of courts) {
      if (court.exhausted || remaining.size === 0) continue;

      const reserved = court.ownerId != null && inPoolPlay(court.ownerId);
      let best: { node: MatchNode; start: number; netChange: boolean; score: number; tie: ReturnType<typeof tieOf> } | null = null;
      let earliestSeen = Infinity;

      for (const id of remaining) {
        const node = graph.nodes.get(id)!;
        if (!runningIds.has(node.divisionId)) continue;
        if (roundGated(node) && node.roundIndex !== round) continue;

        // Court ownership, while the owner is still playing its pools.
        //
        // A reservation binds **both ways**, and it has to, because the
        // appetite is the only thing keeping half a division off court:
        //
        //   - nobody else plays on a block whose owner is mid-round-robin, and
        //   - a round robin never spills off its own block.
        //
        // Leaving either half open undoes the arithmetic. A knockout allowed
        // onto a reserved court at matching net height took the block out from
        // under the division about to use it; a round robin allowed onto the
        // unreserved courts beside it ran four matches at once instead of two,
        // put all eight of its teams on court, and every one of them played
        // back to back. Measured on the organizer's tournament: 12 back-to-back
        // matches, all of them one division spilling off its own two courts.
        //
        // Once the owner is out of pool play the block is released outright:
        // the endgame uses whatever is free and pays for any net it moves.
        const owns = node.divisionId === court.ownerId;
        if (reserved && !owns) continue;
        if (node.isPool && blocked_.has(node.divisionId) && !owns) continue;

        const group = groupOf.get(node.id);
        if (group !== undefined && !dissolved.has(group)) continue;

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

    // A pass that places nothing is not necessarily the end: an endgame group
    // holding out for courts side by side will either get them as the venue
    // empties, or give up and dissolve.
    if (!placedThisPass) {
      const holdingOut = groups.some(
        g => !dissolved.has(g.key) && g.matchIds.some(id => remaining.has(id)),
      );
      if (!holdingOut) break;
    }
  }

  const ordered = [...placements.values()].sort(
    (a, b) => a.startAbs - b.startAbs || a.courtIndex - b.courtIndex,
  );

  return { placements: ordered, unplaced: [...remaining], appetites, queue };

  /** Put every match of a group on its own court, all starting at the same
   *  minute. Each match takes the earliest court it can, and the whole group
   *  is then aligned to the latest of those starts — so the group goes as soon
   *  as the venue can hold all of it at once, and not before. */
  function placeTogether(
    matchIds: string[],
    runningIds: Set<string>,
    round: number,
  ): 'placed' | 'waiting' | 'crowded' {
    const pending = matchIds.filter(id => remaining.has(id));
    if (pending.length === 0) return 'waiting';
    const nodes = pending.map(id => graph.nodes.get(id)!);

    for (const node of nodes) {
      if (!runningIds.has(node.divisionId)) return 'waiting';
      if (roundGated(node) && node.roundIndex !== round) return 'waiting';
      if (phaseFloor(node) === -1) return 'waiting';
      // A group whose feeders have not been played yet is not *crowded*, it is
      // simply not due. Counting those against its patience dissolved every
      // semifinal pair long before its quarter-finals had even been placed,
      // and the pair was then laid down one at a time — the exact stagger the
      // group exists to prevent.
      for (const dep of node.deps) if (!endOf.has(dep)) return 'waiting';
    }

    const taken = new Set<number>();
    const picks: { node: MatchNode; court: CourtState; start: number }[] = [];
    for (const node of nodes) {
      let best: { court: CourtState; start: number } | null = null;
      for (const court of courts) {
        if (taken.has(court.index)) continue;
        if (court.ownerId != null && inPoolPlay(court.ownerId)) continue;
        const option = earliestOn(node, court, phaseFloor(node));
        if (!option) continue;
        if (!best || option.start < best.start) best = { court, start: option.start };
      }
      if (!best) return 'crowded';
      taken.add(best.court.index);
      picks.push({ node, court: best.court, start: best.start });
    }

    const together = Math.max(...picks.map(p => p.start));
    const settled: { node: MatchNode; court: CourtState; netChange: boolean }[] = [];
    for (const pick of picks) {
      const option = earliestOn(pick.node, pick.court, Math.max(together, phaseFloor(pick.node)));
      if (!option || option.start !== together) return 'crowded';
      settled.push({ node: pick.node, court: pick.court, netChange: option.netChange });
    }
    for (const s of settled) commit(s.node, s.court, together, s.netChange);
    return 'placed';
  }

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
    for (let round = 0; round < 8; round++) {
      const settled = settle(node, court, t, duration, mayRunLate(node));
      if (settled === null) return null;
      t = settled;

      // Most matches one team may be given in a day. A team that has had its
      // fill waits for tomorrow rather than being refused outright — which is
      // only meaningful on a multi-day event, and on a single day is the same
      // as not placing the match at all.
      if (dailyCap > 0) {
        const day = Math.floor(t / DAY_SPAN);
        const full = teamsOf(node).some(team => (dayCount.get(team)?.get(day) ?? 0) >= dailyCap);
        if (full) {
          if (day + 1 >= grid.days) return null;
          t = (day + 1) * DAY_SPAN + grid.dayStart;
          continue;
        }
      }

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
    late: boolean,
  ): number | null {
    let t = from;
    for (let i = 0; i < 64; i++) {
      const clearOfTeams = pastTeamBookings(node, t, duration);
      const fitted = fitToDay(court, clearOfTeams, duration, late);
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
  function fitToDay(
    court: CourtState,
    from: number,
    duration: number,
    late: boolean,
  ): number | null {
    let t = from;
    const tolerance = Math.floor(duration * OVERRUN);

    for (let i = 0; i < 512; i++) {
      const day = Math.floor(t / DAY_SPAN);
      if (day >= grid.days) return late ? runLate(court, from, duration) : null;
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

  /** May this match be played after the configured end of the last day?
   *
   *  Only the medal rounds. An event whose day is genuinely too short should
   *  say so rather than quietly drop its own final: a play-off and a final
   *  that spill past closing are a schedule the organizer can look at and
   *  decide about — moving them, extending the day, adding a court — where an
   *  unplaced final is just an absence.
   *
   *  Pool play gets no such licence. A round robin that does not fit is the
   *  event not fitting, and inventing evening court time for a hundred pool
   *  matches would hide exactly the problem the organizer needs to see. */
  function mayRunLate(node: MatchNode): boolean {
    const phase = phaseOf(node);
    return phase === 'semifinal' || phase === 'third' || phase === 'final';
  }

  /** Where a match goes when it has run out of event. On the last day, after
   *  whatever the court already holds, past closing time.
   *
   *  Past closing, but not past midnight. "No ceiling" means the evening, not
   *  the small hours: a match that cannot finish before the day is out has
   *  nowhere real to go, and placing it on a day the event does not have is a
   *  worse answer than reporting it as overflow. */
  function runLate(court: CourtState, from: number, duration: number): number | null {
    const base = (grid.days - 1) * DAY_SPAN;
    let t = Math.max(from, court.freeAt, base + grid.dayStart);
    if (t < base) t = base + grid.dayStart;
    if (grid.lunch) {
      const open = base + grid.lunch.start;
      const shut = base + grid.lunch.end;
      if (t >= open && t < shut) t = shut;
    }
    let blocked = blockedUntil(court.index, grid.days - 1, t - base, duration);
    for (let i = 0; blocked !== null && i < 64; i++) {
      t = base + blocked;
      blocked = blockedUntil(court.index, grid.days - 1, t - base, duration);
    }
    return t + duration <= base + DAY_SPAN ? t : null;
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
      const days = dayCount.get(team) ?? new Map<number, number>();
      days.set(day, (days.get(day) ?? 0) + 1);
      dayCount.set(team, days);
    }
    if (phaseOf(node) === 'final' && finalsCourt === null) finalsCourt = court.index;
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
