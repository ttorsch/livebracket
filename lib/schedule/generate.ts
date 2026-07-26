// Tournament schedule generator.
//
// A pure, deterministic function: given the divisions (with their matches and
// team pairings) and the venue/day constraints, it assigns every match a court
// and a start time. No randomness, no I/O — trivially unit-testable and
// re-runs identically.
//
// Phase 1 established the court/time packing, lunch handling, D_d sizing and
// basic FIFO handover. Phase 2 adds the "dynamic rolling wave" intelligence:
//   - V_R = Σ D_d / courtCount, and (in parallel mode) spare courts are handed
//     to the busiest divisions so no court sits idle.
//   - Division prioritisation clusters same-net-height divisions so they reuse
//     the same court tracks (minimising net swaps), runs the busiest cohort in
//     the morning, and places Mixed after gendered divisions (crossover rule).
//   - Net-height pivots: when a court hands over to a division needing a
//     different net height, a netBufferMinutes block is inserted first.
//   - Staggered round-robin: pool matches are reordered by the circle method
//     and interleaved across a division's pools, so teams get rest between
//     matches instead of playing back-to-back.

export interface ScheduleConfig {
  startTime: string;        // "HH:MM" 24h, day start
  endTime: string;          // "HH:MM" 24h, day end
  courtCount: number;       // C_total
  blockMinutes: number;     // T_block (match slot incl. buffer)
  lunchStart: string;       // "HH:MM"
  lunchEnd: string;         // "HH:MM"
  netBufferMinutes: number; // gap inserted on a net-height change
  // Most matches one team may be given on a single day. 0 = no limit. Only
  // enforceable where the generator knows who is playing, i.e. pool play —
  // a knockout match's teams aren't decided until the round feeding it is.
  maxMatchesPerTeamPerDay: number;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  startTime: '09:00',
  endTime: '18:00',
  courtCount: 4,
  blockMinutes: 45,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  netBufferMinutes: 15,
  maxMatchesPerTeamPerDay: 0,
};

export interface SchedulableMatch {
  id: string;
  teamA: string | null;      // team id (null for TBD / bye)
  teamB: string | null;
  isPool: boolean;           // true = pool-play (round-robin) match
  durationMinutes?: number;  // this match's slot length; falls back to config.blockMinutes
  // 0-based position of this match's round in the division's setup round list.
  // Drives the opening-round pass on multi-day events. When every match omits
  // it they all read as round 0, which collapses to the original single pass.
  roundIndex?: number;
}

/** Fallback match length (minutes) when a match/round declares none. */
export const DEFAULT_MATCH_MINUTES = 45;

export interface SchedulableDivision {
  id: string;
  label: string;
  pools: number;                    // used to auto-derive D_d
  netHeight?: string | null;        // free text, e.g. "2.24m" — parsed for pivots/grouping
  gender?: string | null;           // e.g. "Men" / "Mixed" — for crossover ordering
  dedicatedCourts?: number | null;  // organizer override for D_d (absent = auto)
  matches: SchedulableMatch[];
}

export interface ScheduleAssignment {
  matchId: string;
  divisionId: string;
  court: string;   // e.g. "Court 2"
  day: number;     // 0-based day offset from the tournament start date
  time: string;    // "HH:MM" start time
}

/** Court time available on one day of the event. */
export interface DayCapacity {
  day: number;              // 0-based day offset
  playableMinutes: number;  // per court, window minus lunch
  courtMinutes: number;     // playableMinutes × courts — the day's total supply
  matchMinutes: number;     // of that, how much the generated schedule used
  matches: number;          // matches placed on this day
}

/** What one division needs from the schedule, before anything is placed. */
export interface DivisionDemand {
  divisionId: string;
  label: string;
  matches: number;
  minutes: number;          // Σ match durations
  netHeight: number | null;
}

export interface ScheduleResult {
  assignments: ScheduleAssignment[];
  overflow: { matchId: string; divisionId: string }[]; // didn't fit before endTime
  dedicatedCourts: Record<string, number>;             // divisionId -> D_d used
  mode: 'parallel' | 'wave';                           // V_R ≤ 1 vs > 1
  venueRatio: number;                                  // V_R = Σ D_d / courtCount
  pivots: number;                                      // net-height pivot blocks inserted
  dayCapacityMinutes: number;                          // playable minutes/court/day (window − lunch)
  openingRoundSpill: number;                           // opening-round matches that didn't fit day one
  capacity: DayCapacity[];                             // supply vs use, per day
  demand: DivisionDemand[];                            // what each division needs
  backToBack: number;                                  // matches a team had to play with no gap
}

/** Court time on offer versus court time needed, without scheduling anything.
 *  Step one of generating a schedule and useful on its own: the organizer can
 *  see whether the event fits at all before running the generator. */
export function scheduleInventory(
  divisions: SchedulableDivision[],
  config: ScheduleConfig,
  days = 1,
): { capacity: DayCapacity[]; demand: DivisionDemand[]; supplyMinutes: number; demandMinutes: number; matches: number } {
  const courtCount = Math.max(1, Math.trunc(config.courtCount) || 1);
  const block = Math.max(1, Math.trunc(config.blockMinutes) || 1);
  const dayStart = parseHHMM(config.startTime);
  const dayEnd = parseHHMM(config.endTime);
  const lunchStart = parseHHMM(config.lunchStart);
  const lunchEnd = parseHHMM(config.lunchEnd);
  const dayCount = Math.max(1, Math.trunc(days) || 1);

  const lunchInWindow = lunchEnd > lunchStart && lunchStart >= dayStart && lunchEnd <= dayEnd;
  const playableMinutes = Math.max(0, dayEnd - dayStart - (lunchInWindow ? lunchEnd - lunchStart : 0));

  const capacity: DayCapacity[] = Array.from({ length: dayCount }, (_, day) => ({
    day,
    playableMinutes,
    courtMinutes: playableMinutes * courtCount,
    matchMinutes: 0,
    matches: 0,
  }));

  const dur = (m: SchedulableMatch) => Math.max(1, Math.trunc(m.durationMinutes ?? block) || block);
  const demand: DivisionDemand[] = divisions.map(d => ({
    divisionId: d.id,
    label: d.label,
    matches: d.matches.length,
    minutes: d.matches.reduce((s, m) => s + dur(m), 0),
    netHeight: parseNetHeight(d.netHeight),
  }));

  return {
    capacity,
    demand,
    supplyMinutes: playableMinutes * courtCount * dayCount,
    demandMinutes: demand.reduce((s, d) => s + d.minutes, 0),
    matches: demand.reduce((s, d) => s + d.matches, 0),
  };
}

/** Auto dedicated-court count for a division: half its pools, min 1.
 *  Matches the framework's worked example (4 pools → 2, 2 pools → 1). */
export function autoDedicatedCourts(pools: number): number {
  return Math.max(1, Math.ceil((pools || 1) / 2));
}

/** Pull the first number out of a free-text net height ("2.43m (Men)" → 2.43).
 *  Returns null when there's no parseable height (treated as "unknown"). */
export function parseNetHeight(raw?: string | null): number | null {
  if (!raw) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(raw);
  return m ? Number(m[1]) : null;
}

function parseHHMM(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Court cursors are absolute timeline minutes across the whole event:
// `day * DAY_SPAN + minuteOfDay`. DAY_SPAN exceeds any minute-of-day (1440),
// so ordering cursors by value orders them by (day, time).
const DAY_SPAN = 1440;

interface DaySlot { day: number; min: number; abs: number; }

interface DayWindow {
  dayStart: number;
  dayEnd: number;
  lunchStart: number;
  lunchEnd: number;
  days: number;
}

/** Earliest valid slot at or after absolute cursor `from` that fits a `block`
 *  minutes long match: clamps into the day window, skips the lunch block, and
 *  rolls to the next day's start when the block won't fit before `dayEnd`.
 *  Returns null once past the final day. Block length is per-match, so a longer
 *  match can roll to the next day where a shorter one still fits the same day. */
function nextSlot(from: number, w: DayWindow, block: number): DaySlot | null {
  let day = Math.floor(from / DAY_SPAN);
  let min = from - day * DAY_SPAN;
  if (min < w.dayStart) min = w.dayStart;
  while (day < w.days) {
    let s = min;
    if (w.lunchEnd > w.lunchStart && s < w.lunchEnd && s + block > w.lunchStart) {
      s = w.lunchEnd; // would overlap lunch — push to just after it
    }
    if (s + block <= w.dayEnd) return { day, min: s, abs: day * DAY_SPAN + s };
    day += 1; // doesn't fit today — try the next day
    min = w.dayStart;
  }
  return null;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Split a division's pool matches into pools by shared teams. A round-robin
 *  pool is a clique, so each connected component of the team co-occurrence
 *  graph is exactly one pool — no dependence on how the draw was generated. */
function detectPools(poolMatches: SchedulableMatch[]): SchedulableMatch[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (parent.get(cur) !== root) { const next = parent.get(cur) ?? root; parent.set(cur, root); cur = next; }
    return root;
  };
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a: string, b: string) => { add(a); add(b); parent.set(find(a), find(b)); };

  for (const m of poolMatches) {
    if (m.teamA) add(m.teamA);
    if (m.teamB) add(m.teamB);
    if (m.teamA && m.teamB) union(m.teamA, m.teamB);
  }

  const groups = new Map<string, SchedulableMatch[]>();
  for (const m of poolMatches) {
    const anchor = m.teamA ?? m.teamB;
    const key = anchor ? find(anchor) : '__none__';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  }
  return [...groups.values()];
}

/** Circle-method round-robin rounds for a set of teams. Each returned round is
 *  a list of disjoint pairings (no team appears twice within a round). */
function circleRounds(teams: string[]): [string, string][][] {
  const arr = [...teams];
  if (arr.length % 2 === 1) arr.push('__BYE__');
  const n = arr.length;
  if (n < 2) return [];
  const fixed = arr[0];
  let rot = arr.slice(1);
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const lineup = [fixed, ...rot];
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') round.push([a, b]);
    }
    rounds.push(round);
    rot = [rot[rot.length - 1], ...rot.slice(0, rot.length - 1)]; // rotate
  }
  return rounds;
}

/** Order one pool's matches into fatigue-reducing rounds (circle method),
 *  returning rounds of match ids. Matches whose pairing can't be placed (e.g.
 *  an incomplete round-robin) are appended as a final round so nothing is lost. */
function staggerPool(matches: SchedulableMatch[]): string[][] {
  const teams = new Set<string>();
  const byPair = new Map<string, string>();
  for (const m of matches) {
    if (m.teamA) teams.add(m.teamA);
    if (m.teamB) teams.add(m.teamB);
    if (m.teamA && m.teamB) byPair.set(pairKey(m.teamA, m.teamB), m.id);
  }
  const used = new Set<string>();
  const out: string[][] = [];
  for (const round of circleRounds([...teams])) {
    const ids: string[] = [];
    for (const [a, b] of round) {
      const id = byPair.get(pairKey(a, b));
      if (id && !used.has(id)) { ids.push(id); used.add(id); }
    }
    if (ids.length) out.push(ids);
  }
  const leftovers = matches.filter(m => !used.has(m.id)).map(m => m.id);
  if (leftovers.length) out.push(leftovers);
  return out;
}

/** Full play order for a division: staggered pool play (rounds interleaved
 *  across pools so pools progress in lockstep), then knockout in bracket order. */
function orderDivisionMatches(div: SchedulableDivision): string[] {
  const poolMatches = div.matches.filter(m => m.isPool);
  const nonPool = div.matches.filter(m => !m.isPool);
  const poolRounds = detectPools(poolMatches).map(staggerPool);
  const maxRounds = poolRounds.reduce((mx, pr) => Math.max(mx, pr.length), 0);

  const ordered: string[] = [];
  for (let r = 0; r < maxRounds; r++) {
    for (const pr of poolRounds) if (pr[r]) ordered.push(...pr[r]);
  }
  ordered.push(...nonPool.map(m => m.id));
  return ordered;
}

/** Queue order for divisions: cluster by net height (fewest net swaps), run the
 *  busiest net-height cohort first (morning), and within a cohort place gendered
 *  divisions before Mixed (crossover) then the larger division first. */
function prioritizeDivisions(divisions: SchedulableDivision[]): SchedulableDivision[] {
  const isMixed = (d: SchedulableDivision) => (d.gender ?? '').toLowerCase().includes('mix');
  const heightKey = (d: SchedulableDivision) => {
    const h = parseNetHeight(d.netHeight);
    return h == null ? 'unknown' : String(h);
  };

  const groups = new Map<string, SchedulableDivision[]>();
  for (const d of divisions) {
    const k = heightKey(d);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }

  const groupArr = [...groups.values()].map(ds => ({
    ds,
    vol: ds.reduce((s, d) => s + d.matches.length, 0),
  }));
  groupArr.sort((a, b) => b.vol - a.vol); // busiest cohort first

  const out: SchedulableDivision[] = [];
  for (const g of groupArr) {
    const sorted = [...g.ds].sort((a, b) => {
      const am = isMixed(a) ? 1 : 0;
      const bm = isMixed(b) ? 1 : 0;
      if (am !== bm) return am - bm;                 // gendered before Mixed
      return b.matches.length - a.matches.length;    // larger division first
    });
    out.push(...sorted);
  }
  return out;
}

interface CourtTrack {
  name: string;
  // Occupied spans (absolute minutes), kept sorted and non-overlapping. A court
  // has to be able to describe its gaps, not just when it was last used: team
  // and round constraints routinely push a match past the court's last booking,
  // and a single "next free minute" pointer would write off everything before it.
  busy: { s: number; e: number }[];
  until: number;              // end of the court's last booking (net changes follow it)
  height: number | null;      // net height currently set on this court
}

export function generateSchedule(
  divisions: SchedulableDivision[],
  config: ScheduleConfig,
  days = 1,
): ScheduleResult {
  const courtCount = Math.max(1, Math.trunc(config.courtCount) || 1);
  const block = Math.max(1, Math.trunc(config.blockMinutes) || 1);
  const netBuffer = Math.max(0, Math.trunc(config.netBufferMinutes) || 0);
  const dayStart = parseHHMM(config.startTime);
  const dayEnd = parseHHMM(config.endTime);
  const lunchStart = parseHHMM(config.lunchStart);
  const lunchEnd = parseHHMM(config.lunchEnd);
  const dayCount = Math.max(1, Math.trunc(days) || 1);
  const window: DayWindow = { dayStart, dayEnd, lunchStart, lunchEnd, days: dayCount };

  const matchMinutes = (m: SchedulableMatch | undefined) =>
    Math.max(1, Math.trunc(m?.durationMinutes ?? block) || block);

  // One slot's worth of slack. Placements starting within this of the earliest
  // one available count as equally timely, so the choice between them is made
  // on net changes and team rest rather than on a handful of minutes.
  const tolerance = divisions.reduce(
    (mn, d) => d.matches.reduce((acc, m) => Math.min(acc, matchMinutes(m)), mn),
    block,
  );

  // ── Step 1: how much court time the event actually has ──────────────────
  // Playable minutes per court per day = the day window minus the lunch break
  // (only when lunch really falls inside the window).
  const lunchInWindow = lunchEnd > lunchStart && lunchStart >= dayStart && lunchEnd <= dayEnd;
  const dayCapacityMinutes = Math.max(0, dayEnd - dayStart - (lunchInWindow ? lunchEnd - lunchStart : 0));
  const capacity: DayCapacity[] = Array.from({ length: dayCount }, (_, day) => ({
    day,
    playableMinutes: dayCapacityMinutes,
    courtMinutes: dayCapacityMinutes * courtCount,
    matchMinutes: 0,
    matches: 0,
  }));

  // ── Step 2: what has to be scheduled ────────────────────────────────────
  const demand: DivisionDemand[] = divisions.map(d => ({
    divisionId: d.id,
    label: d.label,
    matches: d.matches.length,
    minutes: d.matches.reduce((s, m) => s + matchMinutes(m), 0),
    netHeight: parseNetHeight(d.netHeight),
  }));

  // D_d per division (override or auto), clamped to the court count. Under the
  // slot-driven placement below this is an affinity rather than a reservation:
  // it decides which courts a division prefers, never which it may use, so a
  // division can no longer be starved by another division's allocation.
  const dedicatedCourts: Record<string, number> = {};
  let sumDd = 0;
  for (const div of divisions) {
    if (div.matches.length === 0) {
      dedicatedCourts[div.id] = 0;
      continue;
    }
    const dd = Math.max(1, Math.min(courtCount, Math.trunc(div.dedicatedCourts ?? autoDedicatedCourts(div.pools)) || 1));
    dedicatedCourts[div.id] = dd;
    sumDd += dd;
  }

  const mode: 'parallel' | 'wave' = sumDd <= courtCount ? 'parallel' : 'wave';
  const venueRatio = sumDd / courtCount;

  if (mode === 'parallel' && sumDd < courtCount) {
    let spare = courtCount - sumDd;
    while (spare > 0) {
      let best: SchedulableDivision | null = null;
      let bestLoad = -1;
      for (const div of divisions) {
        const dd = dedicatedCourts[div.id];
        if (dd >= courtCount || dd >= div.matches.length) continue;
        const load = div.matches.length / dd;
        if (load > bestLoad) { bestLoad = load; best = div; }
      }
      if (!best) break;
      dedicatedCourts[best.id] += 1;
      spare -= 1;
    }
  }

  const courts: CourtTrack[] = Array.from({ length: courtCount }, (_, i) => ({
    name: `Court ${i + 1}`,
    busy: [],
    until: dayStart,
    height: null,
  }));

  const assignments: ScheduleAssignment[] = [];
  const overflow: { matchId: string; divisionId: string }[] = [];
  let pivots = 0;
  let backToBack = 0;

  // ── Running state ───────────────────────────────────────────────────────
  const teamFree = new Map<string, number>();      // team -> end of its last match
  const teamDayCount = new Map<string, number>();  // "team|day" -> matches that day
  const roundEnd = new Map<string, number>();      // "divisionId|roundIndex" -> latest end
  const unplacedByRound = new Map<string, number>(); // "divisionId|roundIndex" -> still to place

  const maxPerTeamDay = Math.max(0, Math.trunc(config.maxMatchesPerTeamPerDay ?? 0) || 0);

  const atDailyCap = (m: SchedulableMatch, day: number): boolean => {
    if (maxPerTeamDay <= 0) return false;
    for (const t of [m.teamA, m.teamB]) {
      if (t && (teamDayCount.get(`${t}|${day}`) ?? 0) >= maxPerTeamDay) return true;
    }
    return false;
  };

  /** Earliest slot from `from` that also respects the per-team daily cap. A
   *  capped team cannot be helped by waiting later the same day, so each
   *  rejection skips a whole day rather than to the next free court time. */
  function nextOpenSlot(from: number, mBlock: number, m: SchedulableMatch): DaySlot | null {
    let cursor = from;
    for (;;) {
      const s = nextSlot(cursor, window, mBlock);
      if (!s || !atDailyCap(m, s.day)) return s;
      cursor = (s.day + 1) * DAY_SPAN + dayStart;
    }
  }

  /** First opening on court `c` at or after `from` — clears the day window,
   *  lunch, the daily cap and the court's own bookings. Searching the gaps and
   *  not just the tail is what keeps court time usable after a match has had to
   *  be pushed late by a team or round constraint. */
  function courtSlot(c: CourtTrack, from: number, mBlock: number, m: SchedulableMatch): DaySlot | null {
    let cursor = from;
    for (;;) {
      const s = nextOpenSlot(cursor, mBlock, m);
      if (!s) return null;
      const clash = c.busy.find(b => s.abs < b.e && s.abs + mBlock > b.s);
      if (!clash) return s;
      cursor = clash.e; // strictly greater than s.abs, so this terminates
    }
  }

  function book(c: CourtTrack, s: number, e: number): void {
    let i = c.busy.length;
    while (i > 0 && c.busy[i - 1].s > s) i--;
    c.busy.splice(i, 0, { s, e });
    c.until = Math.max(c.until, e);
  }

  interface Job {
    m: SchedulableMatch;
    div: SchedulableDivision;
    height: number | null;
    prefer: Set<string>;  // the division's preferred court names
    seq: number;          // play order within the division, for determinism
  }

  /** Earliest this match may start at all, whatever court it lands on: after
   *  both its teams' previous matches, and after every earlier round in its
   *  division — a round's teams aren't known until the round feeding it is
   *  complete, so a final cannot share a slot with its own semi-final and
   *  knockout cannot begin before pool play has decided the standings. */
  function floorFor(job: Job): number {
    let floor = 0;
    const { m } = job;
    if (m.teamA) floor = Math.max(floor, teamFree.get(m.teamA) ?? 0);
    if (m.teamB) floor = Math.max(floor, teamFree.get(m.teamB) ?? 0);
    const round = m.roundIndex ?? 0;
    for (let r = 0; r < round; r++) {
      floor = Math.max(floor, roundEnd.get(`${job.div.id}|${r}`) ?? 0);
    }
    return floor;
  }

  /** How long this match's teams have been waiting at time `at`. Infinity for a
   *  team that hasn't played yet; 0 means it would go straight back on court. */
  function restAt(job: Job, at: number): number {
    let rest = Infinity;
    for (const t of [job.m.teamA, job.m.teamB]) {
      if (!t) continue;
      const last = teamFree.get(t);
      if (last != null) rest = Math.min(rest, at - last);
    }
    return rest;
  }

  /**
   * Fill the courts with `jobs`, repeatedly asking "this court frees next —
   * which of the remaining matches is the best thing to put on it?".
   *
   * Candidates starting within one slot of the earliest possible start are
   * treated as equally good, and the choice inside that band is made on quality
   * rather than on a few minutes. Without the band the earliest start decides
   * almost every time — exact ties are rare — and the schedule packs tight at
   * the cost of churning nets and putting teams straight back on court.
   *
   * Inside the band, ranked by:
   *  1. No net change. A change is also charged its buffer as a real delay, so
   *     the net only moves when that clearly beats waiting for a court already
   *     at the right height.
   *  2. Longest-rested teams. This is what keeps a team off back-to-back
   *     matches, and unlike reserving a rest gap it costs no court time: the
   *     slot still gets filled, just by somebody who has been waiting.
   *  3. The division's preferred courts, so its matches stay clustered.
   *  4. Earliest start, then earlier rounds and declared play order.
   */
  function fill(jobs: Job[]): Job[] {
    const pending = new Set(jobs);
    const stranded: Job[] = [];

    /** A round is only open once every earlier round of its division is fully
     *  placed. Without this the greedy would interleave rounds and the round
     *  floor — which can only see matches already placed — would let a match
     *  start before a still-unplaced match of the round feeding it. */
    const isOpen = (job: Job): boolean => {
      const round = job.m.roundIndex ?? 0;
      for (let r = 0; r < round; r++) {
        if ((unplacedByRound.get(`${job.div.id}|${r}`) ?? 0) > 0) return false;
      }
      return true;
    };

    // Lexicographic: first differing rank decides.
    const beats = (a: number[], b: number[] | null): boolean => {
      if (!b) return true;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
      return false;
    };

    while (pending.size > 0) {
      // Every placement that is possible right now, with when it would start.
      const options: { job: Job; court: CourtTrack; slot: DaySlot; cost: number; eff: number }[] = [];
      let earliest = Infinity;

      for (const job of pending) {
        if (!isOpen(job)) continue;
        const mBlock = matchMinutes(job.m);
        const floor = floorFor(job);
        // No court can start this match before its own constraints allow, so
        // once the band is fixed a later floor cannot enter it.
        if (floor > earliest + tolerance) continue;

        for (const c of courts) {
          const cost = c.height != null && job.height != null && c.height !== job.height ? netBuffer : 0;
          const s = courtSlot(c, cost > 0 ? Math.max(c.until + cost, floor) : floor, mBlock, job.m);
          if (!s) continue;
          const eff = s.abs + cost;
          if (eff < earliest) earliest = eff;
          options.push({ job, court: c, slot: s, cost, eff });
        }
      }

      let best: { job: Job; court: CourtTrack; slot: DaySlot; cost: number } | null = null;
      let bestKey: number[] | null = null;
      for (const o of options) {
        if (o.eff > earliest + tolerance) continue; // outside the band
        const rest = restAt(o.job, o.slot.abs);
        const key = [
          rest <= 0 ? 1 : 0,                           // never send a team straight back on if anything else can go
          o.cost > 0 ? 1 : 0,                          // then avoid moving the net
          -rest,                                       // then prefer the longest-rested teams
          o.job.prefer.has(o.court.name) ? 0 : 1,      // then the division's own courts
          o.eff,                                       // then simply the earliest
          o.job.m.roundIndex ?? 0,
          o.job.seq,
        ];
        if (beats(key, bestKey)) {
          best = { job: o.job, court: o.court, slot: o.slot, cost: o.cost };
          bestKey = key;
        }
      }

      if (!best) { stranded.push(...pending); break; } // no room left in the event

      const { job, court, slot, cost } = best;
      const mBlock = matchMinutes(job.m);
      const end = slot.abs + mBlock;

      if (cost > 0) { book(court, slot.abs - cost, slot.abs); pivots++; } // reserve the net change
      if (job.height != null) court.height = job.height;
      if (restAt(job, slot.abs) <= 0) backToBack++;

      assignments.push({
        matchId: job.m.id, divisionId: job.div.id,
        court: court.name, day: slot.day, time: toHHMM(slot.min),
      });
      book(court, slot.abs, end);

      for (const t of [job.m.teamA, job.m.teamB]) {
        if (!t) continue;
        teamFree.set(t, end);
        const k = `${t}|${slot.day}`;
        teamDayCount.set(k, (teamDayCount.get(k) ?? 0) + 1);
      }
      const rk = `${job.div.id}|${job.m.roundIndex ?? 0}`;
      roundEnd.set(rk, Math.max(roundEnd.get(rk) ?? 0, end));

      capacity[slot.day].matchMinutes += mBlock;
      capacity[slot.day].matches += 1;

      const uk = `${job.div.id}|${job.m.roundIndex ?? 0}`;
      unplacedByRound.set(uk, (unplacedByRound.get(uk) ?? 1) - 1);
      pending.delete(job);
    }

    return stranded;
  }

  // ── Step 3: place the matches ───────────────────────────────────────────
  // Court preferences: consecutive tracks per division, in priority order, so
  // divisions cluster on distinct courts while Σ D_d fits the venue.
  let nextCourt = 0;
  const openingJobs: Job[] = [];
  const laterJobs: Job[] = [];

  // Multi-day events lead with every division's opening round so day one fills
  // with first-round matches before any division's later rounds take court
  // time. On a single day there is no next day to push to, so one pass is
  // enough and splitting would only reshuffle within the same day.
  const openingFirst = dayCount > 1;

  for (const div of prioritizeDivisions(divisions)) {
    const prefer = new Set<string>();
    for (let i = 0; i < dedicatedCourts[div.id]; i++) prefer.add(courts[nextCourt++ % courtCount].name);

    const height = parseNetHeight(div.netHeight);
    const byId = new Map(div.matches.map(m => [m.id, m]));

    // The opening round is the division's lowest setup round index, so a
    // division starting on pool play opens with pool play and a pure knockout
    // division opens with its first knockout round.
    let openIndex = Infinity;
    for (const m of div.matches) openIndex = Math.min(openIndex, m.roundIndex ?? 0);

    orderDivisionMatches(div).forEach((id, seq) => {
      const m = byId.get(id);
      if (!m) return;
      const job: Job = { m, div, height, prefer, seq };
      const uk = `${div.id}|${m.roundIndex ?? 0}`;
      unplacedByRound.set(uk, (unplacedByRound.get(uk) ?? 0) + 1);
      const isOpening = !openingFirst || (m.roundIndex ?? 0) === openIndex;
      (isOpening ? openingJobs : laterJobs).push(job);
    });
  }

  const stranded = [...fill(openingJobs), ...fill(laterJobs)];
  for (const job of stranded) overflow.push({ matchId: job.m.id, divisionId: job.div.id });

  // Opening-round matches that ended up past day one.
  let openingRoundSpill = 0;
  if (openingFirst) {
    const placedDay = new Map(assignments.map(a => [a.matchId, a.day]));
    for (const job of openingJobs) if ((placedDay.get(job.m.id) ?? 0) > 0) openingRoundSpill++;
  }

  return {
    assignments, overflow, dedicatedCourts, mode, venueRatio, pivots,
    dayCapacityMinutes, openingRoundSpill, capacity, demand, backToBack,
  };
}
