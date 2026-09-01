// What a hand-edited schedule got wrong.
//
// The generator's job is to produce a schedule nobody has to argue with. This
// module's job is the opposite: to let an organizer overrule it and still know
// exactly what that cost. They know things the solver does not — a team's
// flight, a sponsor's window, which court the photographer is on — so a move
// the solver would call illegal is often the right move. Refusing it would be
// the tool telling the organizer they are wrong about their own event.
//
// So nothing here blocks anything. Every check returns a description of what
// broke, and the caller decides how loud to be about it. That is also why the
// messages name the *other* match or team involved rather than just the rule:
// "Winner of M9 hasn't played yet" is something an organizer can act on;
// "dependency violation" is not.
//
// Pure and synchronous, so the editing UI can re-run it on every drag without
// touching the solver, and so it can be tested without a schedule at all.

import type { MatchGraph } from './graph.ts';
import { teamsOf } from './cost.ts';
import { DAY_SPAN, type Grid } from './grid.ts';

/** One match as the editor currently has it placed. */
export interface EditedPlacement {
  matchId: string;
  court: string;
  day: number;
  /** Minutes past midnight on its own day. */
  startMin: number;
  durationMinutes: number;
}

export type ProblemKind =
  | 'courtClash'
  | 'teamClash'
  | 'shortRest'
  | 'dependency'
  | 'outsideDay'
  | 'blocked';

export interface ScheduleProblem {
  matchId: string;
  kind: ProblemKind;
  /** Written for an organizer, naming what to look at rather than which rule
   *  fired. */
  message: string;
  /** The other match involved, when there is one — so the UI can highlight it. */
  otherMatchId?: string;
}

export interface ValidateOptions {
  /** Gap a team should get between matches, in minutes. 0 disables the check. */
  targetRestMinutes?: number;
  /** How to name a match in a message. Defaults to the raw id, which is only
   *  useful in tests — the UI passes its own labels ("M14"). */
  label?: (matchId: string) => string;
  /** How to name a team in a message. Defaults to the raw id for the same
   *  reason — but a team id is a UUID, so a caller that does not supply this
   *  puts a UUID in front of the organizer. The UI passes the team's name. */
  teamLabel?: (teamId: string) => string;
}

const abs = (p: EditedPlacement) => p.day * DAY_SPAN + p.startMin;
const endAbs = (p: EditedPlacement) => abs(p) + p.durationMinutes;

function hhmm(minutes: number): string {
  const m = ((minutes % DAY_SPAN) + DAY_SPAN) % DAY_SPAN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Everything wrong with this arrangement, in the order an organizer would
 *  want to fix it: things that cannot physically happen first, then things that
 *  are merely unfair. */
export function validateSchedule(
  placements: EditedPlacement[],
  graph: MatchGraph,
  grid: Grid,
  options: ValidateOptions = {},
): ScheduleProblem[] {
  const name = options.label ?? ((id: string) => id);
  const teamName = options.teamLabel ?? ((id: string) => id);
  const rest = Math.max(0, options.targetRestMinutes ?? 0);
  const problems: ScheduleProblem[] = [];
  const byId = new Map(placements.map(p => [p.matchId, p]));

  // ── Two matches on one court. ──────────────────────────────────────────
  const byCourt = new Map<string, EditedPlacement[]>();
  for (const p of placements) {
    const key = `${p.day}|${p.court}`;
    const list = byCourt.get(key);
    if (list) list.push(p);
    else byCourt.set(key, [p]);
  }
  for (const list of byCourt.values()) {
    const ordered = [...list].sort((a, b) => abs(a) - abs(b));
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (abs(current) < endAbs(previous)) {
        problems.push({
          matchId: current.matchId,
          otherMatchId: previous.matchId,
          kind: 'courtClash',
          message: `${current.court} is still busy with ${name(previous.matchId)} until ${hhmm(endAbs(previous))}`,
        });
      }
    }
  }

  // ── One team, two courts. And the gap between a team's matches. ────────
  const byTeam = new Map<string, EditedPlacement[]>();
  for (const p of placements) {
    const node = graph.nodes.get(p.matchId);
    if (!node) continue;
    for (const team of teamsOf(node)) {
      const list = byTeam.get(team);
      if (list) list.push(p);
      else byTeam.set(team, [p]);
    }
  }
  for (const [team, list] of byTeam) {
    const ordered = [...list].sort((a, b) => abs(a) - abs(b));
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      const gap = abs(current) - endAbs(previous);
      if (gap < 0) {
        problems.push({
          matchId: current.matchId,
          otherMatchId: previous.matchId,
          kind: 'teamClash',
          message: `${teamName(team)} is already on court for ${name(previous.matchId)} until ${hhmm(endAbs(previous))}`,
        });
      } else if (gap === 0) {
        // Only a genuine back-to-back is worth saying out loud.
        //
        // A gap merely shorter than the target is not a fault: pool play now
        // fills the courts and prices rest rather than gating it, so a 20-minute
        // turnaround between 20-minute matches is the *expected* shape of a
        // round robin, not a mistake. Flagging it put a warning on half the
        // cards and buried the problems that actually need looking at.
        problems.push({
          matchId: current.matchId,
          otherMatchId: previous.matchId,
          kind: 'shortRest',
          message: `${teamName(team)} plays this straight after ${name(previous.matchId)} with no break`,
        });
      }
    }
  }

  // ── A match played before the match it depends on. ─────────────────────
  //
  // This is the one a drag breaks most easily and the one that is hardest to
  // see, because the sides of a knockout match are still "Winner of …" — the
  // conflict is with a match, not with a name on the card.
  for (const p of placements) {
    const node = graph.nodes.get(p.matchId);
    if (!node) continue;
    for (const dep of node.deps) {
      const feeder = byId.get(dep);
      if (!feeder) continue;
      const gap = abs(p) - endAbs(feeder);
      if (gap < 0) {
        problems.push({
          matchId: p.matchId,
          otherMatchId: dep,
          kind: 'dependency',
          message: `${name(dep)} has not finished yet — it runs until ${hhmm(endAbs(feeder))}`,
        });
      } else if (rest > 0 && gap < rest) {
        problems.push({
          matchId: p.matchId,
          otherMatchId: dep,
          kind: 'shortRest',
          message:
            gap === 0
              ? `whoever wins ${name(dep)} walks straight back on`
              : `whoever wins ${name(dep)} gets only ${gap} min`,
        });
      }
    }
  }

  // ── Off the end of the day, or on top of something the venue is using. ──
  const courtIndex = new Map(grid.courts.map((c, i) => [c.name, i]));
  for (const p of placements) {
    if (p.startMin < grid.dayStart || p.startMin + p.durationMinutes > grid.dayEnd) {
      problems.push({
        matchId: p.matchId,
        kind: 'outsideDay',
        message: `runs ${hhmm(p.startMin)}–${hhmm(p.startMin + p.durationMinutes)}, outside the ${hhmm(grid.dayStart)}–${hhmm(grid.dayEnd)} playing day`,
      });
      continue;
    }
    const ci = courtIndex.get(p.court);
    if (ci === undefined) continue;
    const end = p.startMin + p.durationMinutes;
    // Scanned by overlap rather than by dividing out an index: lunch splits the
    // day into runs, so ordinals are not evenly spaced from `dayStart`.
    let onBlock = false;
    for (let i = 0; i < grid.slotsPerDay; i++) {
      const s = grid.slotStarts[i];
      if (s < end && s + grid.slotMinutes > p.startMin && grid.blocked[p.day]?.[ci]?.[i]) {
        onBlock = true;
        break;
      }
    }
    // Lunch is checked against the window itself, not against slots. No slot
    // exists inside the break, so a hand-placed match sitting in it overlaps
    // nothing on the grid and would otherwise pass unremarked.
    const onLunch = grid.lunch != null && p.startMin < grid.lunch.end && end > grid.lunch.start;
    if (onBlock) {
      problems.push({ matchId: p.matchId, kind: 'blocked', message: `overlaps time you have blocked out on ${p.court}` });
    } else if (onLunch) {
      problems.push({ matchId: p.matchId, kind: 'blocked', message: `overlaps the lunch break, when nobody plays` });
    }
  }

  return problems;
}
