// Phase 4 — placement.
//
// Time moves forward one slot at a time. At each slot we ask a single, small,
// well-defined question:
//
//     of the matches that are legally playable right now, and the courts that
//     are free right now, which pairing costs least?
//
// That is a min-cost bipartite matching, and it is solved *optimally* by the
// Hungarian algorithm below. With at most twenty courts the matrix is tiny and
// the solve is microseconds, so we get the best possible slot every time
// instead of the first-fit a greedy loop would take. The schedule as a whole is
// still only near-optimal — being optimal in each slot in sequence is not the
// same as being optimal overall — which is what the repair pass is for.
//
// Legality (hard) and preference (soft) are kept strictly apart: this file
// decides what is *allowed*, cost.ts decides what is *good*.
//
// When something cannot be placed at all, the solver does not silently drop it.
// It walks a relaxation ladder — giving up one constraint at a time, weakest
// promise first — and reports exactly which promises it had to break. An
// over-constrained tournament (usually an over-pinned one) is a legitimate
// answer, not a bug, and the organizer needs to be told which rule was the
// problem.

import type { PinnedPlacement, Relaxation } from './types.ts';
import { parseHHMM } from './types.ts';
import { courtOpen, type Slot } from './grid.ts';
import type { MatchNode } from './graph.ts';
import {
  isExclusive,
  isGloballyOrdered,
  isSingleCourt,
  phaseOrder,
  type StagePhase,
  type StageWave,
} from './staging.ts';
import {
  feederEndOf,
  makeTeamTrack,
  placementCost,
  teamsOf,
  type CourtTrack,
  type Placement,
  type SolverContext,
  type TeamTrack,
} from './cost.ts';

/** Stand-in for "illegal" in the cost matrix. Large enough that the matching
 *  never prefers it, finite so the algorithm's arithmetic stays well-behaved. */
const FORBIDDEN = 1e9;

/** Priority a match gains for each slot it has been ready and not placed.
 *
 *  This is scheduling discipline, not a preference, which is why it lives here
 *  and not in the weights: without it a match that slips behind its planned day
 *  is permanently outranked by on-plan matches and can starve forever. It is
 *  deliberately excluded from evaluate(), because "waited a long time" is not a
 *  property that makes a finished schedule good. */
const AGING_PER_SLOT = 90;

/** How many candidates the matching considers per slot. The matrix is O(n²m),
 *  so this keeps a 300-match ready set from making each slot expensive; the
 *  candidates are pre-ranked, so the ones dropped are the ones that would have
 *  lost anyway. */
const MAX_CANDIDATES_PER_SLOT = 96;

interface Rules {
  /** Divisions take the venue in turns during pool play instead of sharing it,
   *  so a court is rigged to one net height and stays there. */
  poolBlocks: boolean;
  /** Hold every division's last round for the final day. */
  finalsOnLastDay: boolean;
  /** Keep each endgame round together: a division's semifinals go side by side
   *  or not at all, and its play-off for 3rd finishes before its final starts. */
  stageFinals: boolean;
  /** Smallest gap, in minutes, a team may be given before playing again.
   *
   *  A number rather than a flag so the ladder can step *down* it instead of
   *  falling off a cliff. Going straight from "a full slot of rest" to "no
   *  constraint" means the matching packs every court solid the moment the
   *  venue is tight, and teams end up playing back to back while court time
   *  sits empty later in the day. The middle rung — any positive gap — keeps
   *  the worst outcome away until it is genuinely unavoidable. */
  minRestMinutes: number;
  /** Per-team matches-per-day ceiling; 0 = none. */
  dailyCap: number;
  /** Refuse to place a match before the day its plan targets. */
  dayFloor: boolean;
}

export interface PinConflict {
  matchId: string;
  reason: string;
}

export interface AssignResult {
  placements: Placement[];
  /** Matches that could not be placed anywhere in the event. */
  unplaced: string[];
  /** Promises the solver had to break to get this far. */
  relaxations: Relaxation[];
  pinConflicts: PinConflict[];
}

export function assignMatches(
  ctx: SolverContext,
  pins: PinnedPlacement[] = [],
): AssignResult {
  // The rest target starts life as a hard filter whatever the config says.
  //
  // That is what "soft" actually has to mean here. If rest were merely
  // expensive, the matching would still fill every free court the moment any
  // match was playable — a court can never choose to stay empty — and a
  // division with more matches than its teams can rest through would be packed
  // solid. Filtering short-rested matches out of the candidate set is what lets
  // a court sit idle for a slot so the players can recover. "Soft" is expressed
  // by the ladder below being willing to give the rule up, not by pricing it.
  const base: Rules = {
    poolBlocks: ctx.staging.enabled,
    finalsOnLastDay: ctx.config.finalsOnLastDay,
    stageFinals: ctx.staging.enabled,
    minRestMinutes: ctx.targetRestMinutes,
    dailyCap: Math.max(0, Math.trunc(ctx.config.maxMatchesPerTeamPerDay) || 0),
    dayFloor: true,
  };

  // Weakest promise first, and the order is a judgement about what an organizer
  // would actually trade. Holding finals for the last day is presentation. A
  // full rest gap is comfort. The day plan is only guidance, and the daily cap
  // a welfare rule. Sending a team straight back on court with no gap at all is
  // the thing nobody wants, so it goes last — after every other lever is spent.
  const ladder: { rules: Rules; gave: Relaxation | null }[] = [{ rules: base, gave: null }];

  let rules = base;
  const step = (patch: Partial<Rules>, gave: Relaxation) => {
    rules = { ...rules, ...patch };
    ladder.push({ rules, gave });
  };

  // Sharing the venue between divisions costs net changes and nothing else, so
  // it is the first thing given up — an annoyance beats a schedule that does
  // not fit.
  if (base.poolBlocks) step({ poolBlocks: false }, 'poolBlocks');
  step({ finalsOnLastDay: false }, 'finalsOnLastDay');
  // Staging is given up early for the same reason as the rung above it: a
  // semifinal played at an awkward time is a disappointment, a semifinal with
  // nowhere to play at all is a broken tournament.
  if (base.stageFinals) step({ stageFinals: false }, 'stageFinals');
  // An organizer who declared rest non-negotiable gets exactly that: the rungs
  // that would trade it away are simply not built, and matches overflow instead.
  if (!ctx.config.restIsHard) step({ minRestMinutes: 1 }, 'restIsHard');
  step({ dayFloor: false }, 'dayQuota');
  if (base.dailyCap > 0) step({ dailyCap: 0 }, 'maxMatchesPerTeamPerDay');
  if (!ctx.config.restIsHard) step({ minRestMinutes: 0 }, 'backToBack');

  let best: AssignResult | null = null;
  const given: Relaxation[] = [];

  for (const rung of ladder) {
    const run = solve(ctx, pins, rung.rules);
    if (rung.gave) given.push(rung.gave);
    const result: AssignResult = { ...run, relaxations: [...given] };
    if (!best || run.unplaced.length < best.unplaced.length) best = result;
    if (run.unplaced.length === 0) return result;
  }

  return best ?? { placements: [], unplaced: [], relaxations: [...given], pinConflicts: [] };
}

function solve(
  ctx: SolverContext,
  pins: PinnedPlacement[],
  rules: Rules,
): Omit<AssignResult, 'relaxations'> {
  const { graph, grid } = ctx;
  // Two different units, deliberately. `step` is the grid's resolution and is
  // what geometry is measured in — where a slot starts, how many slots a match
  // occupies. `block` is the nominal match length and is what *judgement* is
  // measured in — how long a match has been waiting, in match-lengths.
  const step = grid.slotMinutes;
  const block = grid.blockMinutes;

  // busy[day][courtIndex][slotIndex] — the match occupying that block, if any.
  const busy: (string | null)[][][] = Array.from({ length: grid.days }, () =>
    Array.from({ length: grid.courts.length }, () =>
      Array.from({ length: grid.slotsPerDay }, () => null),
    ),
  );

  const courts: CourtTrack[] = grid.courts.map((spec, index) => ({
    name: spec.name,
    index,
    height: spec.netHeight ?? null,
    isShowCourt: Boolean(spec.isShowCourt),
    busy: new Map(),
  }));

  const teams = new Map<string, TeamTrack>();
  const trackFor = (id: string): TeamTrack => {
    let t = teams.get(id);
    if (!t) {
      t = makeTeamTrack();
      teams.set(id, t);
    }
    return t;
  };

  const placements = new Map<string, Placement>();
  const endOf = new Map<string, number>();
  /** The one court every final is played on, chosen by the first final placed. */
  let sharedCourt: number | null = null;
  /** The division currently part-way through its round robin, and the net
   *  height it plays at. While one holds this, only divisions that play at the
   *  same height may share the venue with it. */
  let poolOccupier: string | null = null;
  let occupierHeight: number | null = null;

  /** Net height a division plays at, read off any of its matches. */
  const heightOf = (divisionId: string): number | null => {
    for (const node of graph.nodes.values()) {
      if (node.divisionId === divisionId && node.netHeight != null) return node.netHeight;
    }
    return null;
  };

  /** May this match share the floor with whoever currently holds it?
   *
   *  Taking turns exists to stop the net moving, so it only has to apply to
   *  divisions that would move it. Two divisions playing at the same height —
   *  or either of them at no declared height — cost nothing to interleave, and
   *  interleaving them is what fills the courts the first one cannot use. */
  const mayShare = (node: MatchNode): boolean => {
    if (poolOccupier === null || node.divisionId === poolOccupier) return true;
    return occupierHeight == null || node.netHeight == null || node.netHeight === occupierHeight;
  };
  const remaining = new Set(graph.order);
  const readySince = new Map<string, number>();
  const pinConflicts: PinConflict[] = [];

  const courtByName = new Map(grid.courts.map((c, i) => [c.name, i]));

  const occupy = (p: Placement): void => {
    for (let k = 0; k < p.span; k++) {
      busy[p.slot.day][p.courtIndex][p.slot.index + k] = p.matchId;
    }
    const node = graph.nodes.get(p.matchId)!;
    if (node.netHeight != null) courts[p.courtIndex].height = node.netHeight;
    for (const teamId of teamsOf(node)) {
      const t = trackFor(teamId);
      t.lastEnd = Math.max(t.lastEnd, p.endAbs);
      t.lastCourt = p.courtName;
      const first = t.dayFirst.get(p.slot.day);
      t.dayFirst.set(p.slot.day, first === undefined ? p.startAbs : Math.min(first, p.startAbs));
      const last = t.dayLast.get(p.slot.day);
      t.dayLast.set(p.slot.day, last === undefined ? p.endAbs : Math.max(last, p.endAbs));
      t.dayCount.set(p.slot.day, (t.dayCount.get(p.slot.day) ?? 0) + 1);
    }
    placements.set(p.matchId, p);
    endOf.set(p.matchId, p.endAbs);
    remaining.delete(p.matchId);
  };

  // ── Pins first. They are hard constraints, so they claim their court and
  //    slot before the solver sees the grid at all. ─────────────────────────
  for (const pin of pins) {
    const node = graph.nodes.get(pin.matchId);
    if (!node) continue;
    const courtIndex = courtByName.get(pin.court);
    if (courtIndex === undefined) {
      pinConflicts.push({ matchId: pin.matchId, reason: `No court named "${pin.court}"` });
      continue;
    }
    const startMin = parseHHMM(pin.time);
    const index = Math.round((startMin - grid.dayStart) / step);
    const slot = grid.slots.find(s => s.day === pin.day && s.index === index);
    if (!slot || startMin !== grid.dayStart + index * step) {
      pinConflicts.push({
        matchId: pin.matchId,
        reason: `${pin.time} on day ${pin.day + 1} is not a slot on the grid`,
      });
      continue;
    }
    const span = Math.max(1, Math.ceil(node.durationMinutes / step));
    if (!courtOpen(grid, courtIndex, slot, span)) {
      pinConflicts.push({ matchId: pin.matchId, reason: `${pin.court} is on its lunch break, or the match runs past the end of the day` });
      continue;
    }
    let clash = false;
    for (let k = 0; k < span; k++) if (busy[slot.day][courtIndex][slot.index + k]) clash = true;
    if (clash) {
      pinConflicts.push({ matchId: pin.matchId, reason: `${pin.court} is already taken at ${pin.time}` });
      continue;
    }
    occupy({
      matchId: pin.matchId,
      courtIndex,
      courtName: pin.court,
      slot,
      span,
      startAbs: slot.abs,
      endAbs: slot.abs + node.durationMinutes,
      netChange: false,
      pinned: true,
    });
  }

  // ── The slot walk. ───────────────────────────────────────────────────────
  for (const slot of grid.slots) {
    if (remaining.size === 0) break;

    const freeCourts: number[] = [];
    for (let c = 0; c < courts.length; c++) {
      if (!busy[slot.day][c][slot.index] && courtOpen(grid, c, slot, 1)) freeCourts.push(c);
    }
    if (freeCourts.length === 0) continue;

    // Matches that may legally start in this slot on some court.
    const ready: MatchNode[] = [];
    for (const id of remaining) {
      const node = graph.nodes.get(id)!;
      if (!isReady(node, slot, rules)) continue;
      if (!readySince.has(id)) readySince.set(id, slot.abs);
      ready.push(node);
    }
    if (ready.length === 0) continue;

    // While a division is part-way through its round robin the venue is its
    // own. Letting another division borrow a court in the gaps is what puts two
    // net heights on the floor at once and moves a net every time a court
    // changes hands — the rotation would be tidy and the nets would not. The
    // claim is released the moment its last pool match is placed.
    if (poolOccupier !== null) {
      const stillOwed = ctx.staging.waves.some(
        w => w.phase === 'pool' && w.divisionId === poolOccupier && w.matchIds.some(id => remaining.has(id)),
      );
      if (!stillOwed) {
        poolOccupier = null;
        occupierHeight = null;
      }
    }

    // ── The medal rounds, placed a wave at a time. ─────────────────────────
    //
    // Waves are settled here rather than left to the matching below, because
    // the matching cannot be told "all of these or none of them". It optimises
    // court by court, so given two semifinals and one spare court it takes one
    // and leaves its twin for later — the exact stagger staging exists to
    // prevent. So a wave is offered the free courts as a unit: it takes them
    // all or it waits for a slot where it can.
    const held = new Set<string>();
    if (rules.stageFinals) {
      const readyIds = new Set(ready.map(n => n.id));
      const startable: { wave: StageWave; pending: string[] }[] = [];

      for (const wave of ctx.staging.waves) {
        const pending = wave.matchIds.filter(id => remaining.has(id));
        if (pending.length === 0) continue;

        const finished = (ids: string[]) =>
          ids.every(id => {
            const end = endOf.get(id);
            return end !== undefined && end <= slot.abs;
          });

        // 1. Every wave of an earlier globally-ordered phase must be finished.
        //    This is what puts all the semifinals in front of all the play-offs,
        //    and all the play-offs in front of the first final. Pool play is
        //    excluded: one division's round robin is nobody else's business, and
        //    the knockout already waits on its own pools through the graph.
        const earlierDone =
          !isGloballyOrdered(wave.phase) ||
          ctx.staging.waves.every(other => {
            if (!isGloballyOrdered(other.phase)) return true;
            if (phaseOrder(other.phase) >= phaseOrder(wave.phase)) return true;
            return finished(other.matchIds);
          });

        // 2. Waves this one explicitly follows — the pool rotation's turns.
        const ownTurn = wave.after.every(key => {
          const previous = ctx.staging.waves.find(w => w.key === key);
          return !previous || finished(previous.matchIds);
        });

        // 3. Divisions take the venue in turns during pool play rather than
        //    sharing it. Sharing means two net heights alive at once and a net
        //    moved every time a court changes hands; taking turns means each
        //    division's round robin runs start to finish on courts rigged once.
        //    A division may start only when no other division is mid-rotation.
        const blockClear =
          !rules.poolBlocks ||
          wave.phase !== 'pool' ||
          pending.every(id => mayShare(graph.nodes.get(id)!));

        // 2. In an exclusive phase only one wave runs at a time, so any other
        //    wave of this phase that has already started must be over.
        const exclusiveClear =
          !isExclusive(wave.phase) ||
          ctx.staging.waves.every(other => {
            if (other.key === wave.key || other.phase !== wave.phase) return true;
            return other.matchIds.every(id => {
              const end = endOf.get(id);
              return end === undefined || end <= slot.abs;
            });
          });

        if (earlierDone && ownTurn && blockClear && exclusiveClear && pending.every(id => readyIds.has(id))) {
          startable.push({ wave, pending });
        } else if (wave.phase !== 'pool') {
          for (const id of pending) held.add(id);
        }
      }

      // Ordering only matters between waves of the same exclusive phase — which
      // division's semifinals go first. Whoever has been ready longest goes
      // first, so a division that could have played does not sit and wait on
      // one that could not; ties break on the key, so the answer is stable.
      const waitedSince = (ids: string[]) =>
        Math.min(...ids.map(id => readySince.get(id) ?? slot.abs));
      startable.sort(
        (a, b) =>
          phaseOrder(a.wave.phase) - phaseOrder(b.wave.phase) ||
          waitedSince(a.pending) - waitedSince(b.pending) ||
          a.wave.order - b.wave.order ||
          (a.wave.key < b.wave.key ? -1 : 1),
      );

      const placedPhases = new Set<StagePhase>();
      for (const { wave, pending } of startable) {
        // Only one wave per exclusive phase may be started in this slot, since
        // two started together are two running at once.
        if (isExclusive(wave.phase) && placedPhases.has(wave.phase)) {
          for (const id of pending) held.add(id);
          continue;
        }

        let open = freeCourts.filter(c => !busy[slot.day][c][slot.index]);
        // Every final shares one court. The first final to be placed chooses
        // it — by cost, so a show court wins when there is one — and every
        // final after that waits for that same court to come free.
        if (isSingleCourt(wave.phase) && sharedCourt !== null) {
          open = open.filter(c => c === sharedCourt);
        }
        if (open.length < pending.length) {
          // No room for the whole turn. A medal round waits for a slot where it
          // fits; a pool turn just lets the matching take what it can, because
          // an idle court costs the event more than a short gap costs a team.
          if (wave.phase !== 'pool') for (const id of pending) held.add(id);
          continue;
        }
        const nodes = pending.map(id => graph.nodes.get(id)!);
        const matrix = nodes.map(node => open.map(c => costOf(node, c, slot)));
        const matching = hungarian(matrix);
        // A wave is only placed if every one of its matches found a court.
        if (matching.some((col, r) => col < 0 || matrix[r][col] >= FORBIDDEN)) {
          if (wave.phase !== 'pool') for (const id of pending) held.add(id);
          continue;
        }
        if (rules.poolBlocks && wave.phase === 'pool' && !nodes.every(mayShare)) {
          // Claimed since this slot's candidates were chosen — two divisions
          // can both look startable before either has actually gone.
          continue;
        }
        matching.forEach((col, r) => place(nodes[r], open[col], slot));
        if (wave.phase === 'pool' && wave.divisionId && poolOccupier === null) {
          poolOccupier = wave.divisionId;
          occupierHeight = heightOf(wave.divisionId);
        }
        placedPhases.add(wave.phase);
        if (isSingleCourt(wave.phase) && sharedCourt === null) {
          sharedCourt = open[matching[0]];
        }
      }
    }

    // Pre-rank so the matrix stays small: longest remaining chain first (it
    // gates the end of the event), then whoever has waited longest.
    ready.sort((a, b) => {
      const wa = slot.abs - (readySince.get(a.id) ?? slot.abs);
      const wb = slot.abs - (readySince.get(b.id) ?? slot.abs);
      if (wb !== wa) return wb - wa;
      if (b.tailMinutes !== a.tailMinutes) return b.tailMinutes - a.tailMinutes;
      return a.id < b.id ? -1 : 1;
    });
    // A team can only be on one court at a time, and the matching cannot see
    // that: it pairs matches to courts, so nothing stops it choosing two
    // matches in this slot that share a team. Enforcing it here — one match
    // per team enters the matrix, highest-ranked first — keeps the matching
    // optimal over what it is given instead of having to undo its answer
    // afterwards. The matches dropped are not lost; they are simply the next
    // slot's candidates.
    const claimed = new Set<string>();
    const candidates: MatchNode[] = [];
    for (const node of ready) {
      if (held.has(node.id) || !remaining.has(node.id)) continue; // waiting on its round, or already placed with it
      if (!mayShare(node)) continue; // another height has the floor
      const teamIds = teamsOf(node);
      // `ready` was decided before this slot's turns were placed, so a team may
      // have gone on court since. Re-check against what is actually committed —
      // a stale entry here would put one team on two courts at once.
      if (teamIds.some(t => (teams.get(t)?.lastEnd ?? -Infinity) > slot.abs)) continue;
      if (teamIds.some(t => claimed.has(t))) continue;
      for (const t of teamIds) claimed.add(t);
      candidates.push(node);
      if (candidates.length >= MAX_CANDIDATES_PER_SLOT) break;
    }
    if (candidates.length === 0) continue;

    const openCourts = freeCourts.filter(c => !busy[slot.day][c][slot.index]);
    if (openCourts.length === 0) continue;

    const cost: number[][] = candidates.map(node => openCourts.map(c => costOf(node, c, slot)));

    const matching = hungarian(cost);
    for (let r = 0; r < matching.length; r++) {
      const col = matching[r];
      if (col < 0 || cost[r][col] >= FORBIDDEN) continue;
      place(candidates[r], openCourts[col], slot);
    }
  }

  return {
    placements: [...placements.values()],
    unplaced: [...remaining],
    pinConflicts,
  };

  /** What putting `node` on this court in this slot would cost, FORBIDDEN when
   *  it cannot go there at all. Shared by the staged-group placement and the
   *  ordinary matching so both rank courts by exactly the same measure. */
  function costOf(node: MatchNode, courtIndex: number, slot: Slot): number {
    const option = optionFor(node, courtIndex, slot);
    if (!option) return FORBIDDEN;
    const waited = (slot.abs - (readySince.get(node.id) ?? slot.abs)) / block;
    return (
      placementCost(
        node,
        courts[courtIndex],
        slot,
        option.startAbs,
        option.endAbs,
        option.netChange,
        feederEndOf(node, id => endOf.get(id)),
        teams,
        ctx,
      ) - AGING_PER_SLOT * waited
    );
  }

  /** Commit `node` to this court and slot. */
  function place(node: MatchNode, courtIndex: number, slot: Slot): void {
    const option = optionFor(node, courtIndex, slot);
    if (!option) return;
    occupy({
      matchId: node.id,
      courtIndex,
      courtName: courts[courtIndex].name,
      slot,
      span: option.span,
      startAbs: option.startAbs,
      endAbs: option.endAbs,
      netChange: option.netChange,
      pinned: false,
    });
  }

  /** Is this match allowed to start in this slot at all — before we even ask
   *  which court? Everything here is a hard constraint. */
  function isReady(node: MatchNode, slot: Slot, r: Rules): boolean {
    // Dependencies: every feeder must be placed *and finished* — and the team
    // that comes through it is owed rest just like a named one. Without the
    // second half, a knockout bracket looks completely unconstrained (both
    // sides are still TBD, so no team track exists) and the winner of a match
    // gets sent straight back on court in the very next slot.
    for (const dep of node.deps) {
      const end = endOf.get(dep);
      if (end === undefined || end > slot.abs) return false;
      if (slot.abs - end < r.minRestMinutes) return false;
    }

    for (const teamId of teamsOf(node)) {
      const t = teams.get(teamId);
      if (!t) continue;
      if (t.lastEnd > slot.abs) return false; // already on court
      if (r.dailyCap > 0 && (t.dayCount.get(slot.day) ?? 0) >= r.dailyCap) return false;
      // Rest is a hard filter in the knockout, where a tired team plays a match
      // that ends someone's tournament. In pool play it is a price instead: a
      // court left empty to protect a gap helps nobody, so the round robin
      // fills the venue and the cost function — which charges a full slot of
      // deficit and a heavy surcharge for a genuine back-to-back — makes sure
      // the tired teams are the last ones picked rather than the first.
      if (!node.isPool && t.lastEnd !== -Infinity && slot.abs - t.lastEnd < r.minRestMinutes) {
        return false;
      }
    }

    // The day plan wants every division to advance a little every day. Taking
    // the venue in turns wants one division's round robin finished before the
    // next begins. Those are opposite instructions, so on pool play the turn
    // wins and the pace plan stands aside — otherwise a division is told to
    // wait for a later day while also holding the courts nobody else may use.
    const paced = !(r.poolBlocks && ctx.staging.waveOf.get(node.id)?.phase === 'pool');
    if (r.dayFloor && paced) {
      const target = ctx.plan.targetDay.get(node.id);
      if (target !== undefined && slot.day < target) return false;
    }

    if (r.finalsOnLastDay && grid.days > 1) {
      const shape = graph.divisions.get(node.divisionId);
      if (shape && shape.maxLevel > 0 && node.level === shape.maxLevel && slot.day !== grid.days - 1) {
        return false;
      }
    }

    return true;
  }

  /** How this match would sit on this court, or null if it cannot. A net-height
   *  change is charged as real court time in front of the match, so a court at
   *  the wrong height is genuinely more expensive rather than merely
   *  discouraged. */
  function optionFor(
    node: MatchNode,
    courtIndex: number,
    slot: Slot,
  ): { span: number; startAbs: number; endAbs: number; netChange: boolean } | null {
    const court = courts[courtIndex];
    const netChange =
      node.netHeight != null && court.height != null && court.height !== node.netHeight;
    const buffer = netChange ? Math.max(0, Math.trunc(ctx.config.netBufferMinutes) || 0) : 0;
    const span = Math.max(1, Math.ceil((buffer + node.durationMinutes) / step));

    if (!courtOpen(grid, courtIndex, slot, span)) return null;
    for (let k = 0; k < span; k++) {
      if (busy[slot.day][courtIndex][slot.index + k]) return null;
    }
    const startAbs = slot.abs + buffer;
    return { span, startAbs, endAbs: startAbs + node.durationMinutes, netChange };
  }
}

/** Hungarian algorithm (Jonker-Volgenant form) for rectangular min-cost
 *  assignment. Returns, for each row, the column it was matched to, or -1.
 *
 *  Rows are matches and columns are courts. Either can outnumber the other:
 *  more matches than courts is the normal busy case and the extras simply wait
 *  for the next slot; more courts than matches leaves courts idle. */
export function hungarian(cost: number[][]): number[] {
  const rows = cost.length;
  if (rows === 0) return [];
  const cols = cost[0].length;
  if (cols === 0) return new Array(rows).fill(-1);

  // The algorithm needs rows ≤ cols, so transpose when it isn't and flip the
  // answer back at the end.
  if (rows > cols) {
    const transposed: number[][] = Array.from({ length: cols }, (_, j) =>
      Array.from({ length: rows }, (_, i) => cost[i][j]),
    );
    const solved = hungarian(transposed);
    const out = new Array<number>(rows).fill(-1);
    for (let j = 0; j < solved.length; j++) if (solved[j] >= 0) out[solved[j]] = j;
    return out;
  }

  const n = rows;
  const m = cols;
  const INF = Infinity;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);  // column -> row
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) out[p[j] - 1] = j - 1;
  return out;
}
