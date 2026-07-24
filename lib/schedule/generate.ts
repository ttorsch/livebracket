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
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  startTime: '09:00',
  endTime: '18:00',
  courtCount: 4,
  blockMinutes: 45,
  lunchStart: '12:00',
  lunchEnd: '13:00',
  netBufferMinutes: 15,
};

export interface SchedulableMatch {
  id: string;
  teamA: string | null; // team id (null for TBD / bye)
  teamB: string | null;
  isPool: boolean;      // true = pool-play (round-robin) match
}

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

export interface ScheduleResult {
  assignments: ScheduleAssignment[];
  overflow: { matchId: string; divisionId: string }[]; // didn't fit before endTime
  dedicatedCourts: Record<string, number>;             // divisionId -> D_d used
  mode: 'parallel' | 'wave';                           // V_R ≤ 1 vs > 1
  venueRatio: number;                                  // V_R = Σ D_d / courtCount
  pivots: number;                                      // net-height pivot blocks inserted
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
  block: number;
  dayStart: number;
  dayEnd: number;
  lunchStart: number;
  lunchEnd: number;
  days: number;
}

/** Earliest valid slot at or after absolute cursor `from`: clamps into the
 *  day window, skips the lunch block, and rolls to the next day's start when a
 *  block won't fit before `dayEnd`. Returns null once past the final day. */
function nextSlot(from: number, w: DayWindow): DaySlot | null {
  let day = Math.floor(from / DAY_SPAN);
  let min = from - day * DAY_SPAN;
  if (min < w.dayStart) min = w.dayStart;
  while (day < w.days) {
    let s = min;
    if (w.lunchEnd > w.lunchStart && s < w.lunchEnd && s + w.block > w.lunchStart) {
      s = w.lunchEnd; // would overlap lunch — push to just after it
    }
    if (s + w.block <= w.dayEnd) return { day, min: s, abs: day * DAY_SPAN + s };
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
  cursor: number;             // next free minute-of-day
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
  const window: DayWindow = { block, dayStart, dayEnd, lunchStart, lunchEnd, days: dayCount };

  // D_d per division (override or auto), clamped to the court count.
  const dedicatedCourts: Record<string, number> = {};
  let sumDd = 0;
  for (const div of divisions) {
    const dd = Math.max(1, Math.min(courtCount, Math.trunc(div.dedicatedCourts ?? autoDedicatedCourts(div.pools)) || 1));
    dedicatedCourts[div.id] = dd;
    sumDd += dd;
  }

  const mode: 'parallel' | 'wave' = sumDd <= courtCount ? 'parallel' : 'wave';
  const venueRatio = sumDd / courtCount;

  // Mode A optimisation: when everything fits with courts to spare, hand the
  // spare courts to the busiest divisions (most matches per court) so the whole
  // event finishes sooner and no court sits idle.
  if (mode === 'parallel' && sumDd < courtCount) {
    let spare = courtCount - sumDd;
    while (spare > 0) {
      let best: SchedulableDivision | null = null;
      let bestLoad = -1;
      for (const div of divisions) {
        const dd = dedicatedCourts[div.id];
        if (dd >= courtCount || dd >= div.matches.length) continue; // no point giving more courts than matches
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
    cursor: dayStart, // absolute timeline minute (day 0, dayStart)
    height: null,
  }));

  const assignments: ScheduleAssignment[] = [];
  const overflow: { matchId: string; divisionId: string }[] = [];
  let pivots = 0;

  for (const div of prioritizeDivisions(divisions)) {
    const dd = dedicatedCourts[div.id];
    const height = parseNetHeight(div.netHeight);

    // Claim the dd courts that free up earliest (fresh ones first, then reused).
    const chosen = [...courts].sort((a, b) => a.cursor - b.cursor).slice(0, dd);

    // Net-height pivot: a reused court set to a different height needs a buffer.
    for (const c of chosen) {
      if (c.height != null && height != null && c.height !== height) {
        c.cursor += netBuffer;
        pivots++;
      }
      if (height != null) c.height = height;
    }

    for (const matchId of orderDivisionMatches(div)) {
      const track = chosen.reduce((soonest, c) => (c.cursor < soonest.cursor ? c : soonest), chosen[0]);
      const slot = nextSlot(track.cursor, window);
      if (!slot) {
        overflow.push({ matchId, divisionId: div.id }); // past the final day
        continue;
      }
      assignments.push({ matchId, divisionId: div.id, court: track.name, day: slot.day, time: toHHMM(slot.min) });
      track.cursor = slot.abs + block;
    }
  }

  return { assignments, overflow, dedicatedCourts, mode, venueRatio, pivots };
}
