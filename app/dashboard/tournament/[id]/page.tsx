'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, ChevronDown, Lock, MapPin, Trophy, Unlock, Users, X } from 'lucide-react';
import styles from './page.module.css';
import { Button } from '../../../../components/livebracket-ds';
import { getTournamentDetail, type TournamentDetail, type DetailDivision } from '../../../../lib/data';

const FALLBACK_HERO = '/images/livebracket/beach-volleyball.jpg';

interface SeedTeam {
  id: string;
  name: string;
}

interface DrawSettings {
  pools: number;
  advance: number;
  crossing: string;
}

const DEFAULT_DRAW: DrawSettings = { pools: 4, advance: 2, crossing: 'fivb' };

const FORMAT_LABELS: Record<string, string> = {
  'round-robin': 'Round Robin',
  single: 'Single Elimination',
  double: 'Double Elimination',
};

/* ── Bracket view model ───────────────────────────────────────
   One shape whether the rounds come from the database (generated
   draw) or from the client-side projection used before a draw
   exists. */

interface ViewRow {
  seed: number | null;
  name: string;
  win: boolean;
  lost: boolean;
  live: boolean;
}

interface ViewMatch {
  live: boolean;
  hasRight: boolean;
  hasLeft: boolean;
  hasSpine: boolean;
  rowA: ViewRow;
  rowB: ViewRow;
}

interface ViewRound {
  name: string;
  matches: ViewMatch[];
}

interface BracketView {
  rounds: ViewRound[];
  champion: string | null; // null = undecided
  fromDb: boolean;
}

/* Standard bracket seed placement for a field of `size` (power of 2). */
function seedPlacement(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next: number[] = [];
    const m = order.length * 2;
    for (const s of order) next.push(s, m + 1 - s);
    order = next;
  }
  return order;
}

const POOL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* Mirrors the server's serpentine `assignPools`: seed-ordered teams are
   dealt into `poolsCount` pools, reversing direction every row so pool
   strength stays balanced. Named pools reproduce what was actually saved. */
function assignPools<T>(items: T[], poolsCount: number): { name: string; items: T[] }[] {
  const out: T[][] = Array.from({ length: poolsCount }, () => []);
  items.forEach((item, i) => {
    const row = Math.floor(i / poolsCount);
    const col = i % poolsCount;
    out[row % 2 === 0 ? col : poolsCount - 1 - col].push(item);
  });
  return out
    .map((teams, i) => ({ name: POOL_LETTERS[i] ?? String(i + 1), items: teams }))
    .filter(p => p.items.length > 0);
}

function roundName(fieldSize: number): string {
  if (fieldSize === 2) return 'Final';
  if (fieldSize === 4) return 'Semifinals';
  if (fieldSize === 8) return 'Quarterfinals';
  return `Round of ${fieldSize}`;
}

/* Projection: favorite (lower seed) advances everywhere; used until a
   real draw has been generated for the division. */
function projectBracket(teams: SeedTeam[]): BracketView | null {
  if (teams.length < 2) return null;
  let size = 2;
  while (size < teams.length) size *= 2;

  interface Entrant { seed: number; name: string | null }
  let field: Entrant[] = seedPlacement(size).map(seed => ({ seed, name: teams[seed - 1]?.name ?? null }));

  const totalRounds = Math.log2(size);
  const rounds: ViewRound[] = [];

  for (let r = 0; r < totalRounds; r++) {
    const isFinal = r === totalRounds - 1;
    const matches: ViewMatch[] = [];
    const winners: Entrant[] = [];

    for (let i = 0; i < field.length / 2; i++) {
      const a = field[2 * i];
      const b = field[2 * i + 1];
      const aWins = b.name === null || (a.name !== null && a.seed < b.seed);
      winners.push(aWins ? a : b);

      const mkRow = (e: Entrant): ViewRow => ({
        seed: e.name === null ? null : e.seed,
        name: e.name ?? 'BYE',
        win: false,
        lost: false,
        live: false,
      });

      matches.push({
        live: false,
        hasRight: !isFinal,
        hasLeft: r > 0,
        hasSpine: !isFinal && i % 2 === 0,
        rowA: mkRow(a),
        rowB: mkRow(b),
      });
    }

    rounds.push({ name: roundName(field.length), matches });
    field = winners;
  }

  return { rounds, champion: teams[0]?.name ?? null, fromDb: false };
}

/* Empty bracket sized to the confirmed-team count, shown before a pure
   single-elimination draw exists. The field is padded to the next power of
   two and every slot is left blank (no teams, no byes) — the skeleton just
   shows the match numbers and each later slot's "Winner of M#" feed, ready
   to be populated one name at a time when the organizer draws. */
function emptyBracket(teamCount: number): BracketView | null {
  if (teamCount < 2) return null;
  let size = 2;
  while (size < teamCount) size *= 2;

  const totalRounds = Math.log2(size);
  const rounds: ViewRound[] = [];
  let matchCount = size / 2;

  for (let r = 0; r < totalRounds; r++) {
    const isFinal = r === totalRounds - 1;
    const matches: ViewMatch[] = [];
    for (let i = 0; i < matchCount; i++) {
      const mkRow = (): ViewRow => ({ seed: null, name: 'TBD', win: false, lost: false, live: false });
      matches.push({
        live: false,
        hasRight: !isFinal,
        hasLeft: r > 0,
        hasSpine: !isFinal && i % 2 === 0,
        rowA: mkRow(),
        rowB: mkRow(),
      });
    }
    rounds.push({ name: roundName(matchCount * 2), matches });
    matchCount /= 2;
  }

  return { rounds, champion: null, fromDb: false };
}

/* Real bracket: the division's single-elimination rounds from the DB. */
function dbBracket(division: DetailDivision): BracketView | null {
  const knockout = division.bracket.filter(r => (r.format === 'single' || r.format === 'double') && r.matches.length > 0);
  if (knockout.length === 0) return null;

  const seedOf = new Map(division.teamsList.map(t => [t.id, t.seed]));
  const total = knockout.length;

  const rounds: ViewRound[] = knockout.map((r, ri) => ({
    name: r.round,
    matches: r.matches.map((m, mi) => {
      const bye = ri === 0 && m.status === 'done' && (m.teamAId === null) !== (m.teamBId === null);
      const mkRow = (id: string | null, name: string | null, winnerSide: boolean): ViewRow => ({
        seed: id ? seedOf.get(id) ?? null : null,
        name: name ?? (bye ? 'BYE' : 'TBD'),
        win: winnerSide,
        // A real team greys out once the match is decided against it.
        lost: !!id && m.status === 'done' && m.winner !== undefined && !winnerSide,
        live: m.status === 'live',
      });
      return {
        live: m.status === 'live',
        hasRight: ri < total - 1,
        hasLeft: ri > 0,
        hasSpine: ri < total - 1 && mi % 2 === 0,
        rowA: mkRow(m.teamAId, m.teamAName, m.status === 'done' && m.winner === 'A'),
        rowB: mkRow(m.teamBId, m.teamBName, m.status === 'done' && m.winner === 'B'),
      };
    }),
  }));

  const final = knockout[total - 1].matches[0];
  const champion = final?.winner === 'A' ? final.teamAName : final?.winner === 'B' ? final.teamBName : null;

  return { rounds, champion, fromDb: true };
}

export default function OrganizerBracketPage() {
  const params = useParams<{ id: string }>();
  const slug = params.id;

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeDiv, setActiveDiv] = useState<string>('');
  const [teamsOpen, setTeamsOpen] = useState(true);
  const [poolPlayOpen, setPoolPlayOpen] = useState(true);
  const [drawConfigOpen, setDrawConfigOpen] = useState(true);
  const [poolResultsOpen, setPoolResultsOpen] = useState(true);
  const [standingsOpen, setStandingsOpen] = useState(true);
  const [round2Open, setRound2Open] = useState(true);
  const [bracketConfigOpen, setBracketConfigOpen] = useState(true);
  const [bracketOpen, setBracketOpen] = useState(true);
  const [seedsByDiv, setSeedsByDiv] = useState<Record<string, SeedTeam[]>>({});
  const [configByDiv, setConfigByDiv] = useState<Record<string, DrawSettings>>({});
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [animDiv, setAnimDiv] = useState<string | null>(null); // division whose draw reveal is playing
  const [drawTick, setDrawTick] = useState(0); // remounts the pools grid so the reveal replays on every draw

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    setSearchQuery('');
    setDropdownOpen(false);
  }, [activeDiv]);

  const [backHidden, setBackHidden] = useState(false);
  const lastScrollY = useRef(0);

  const load = useCallback(async (preferDiv?: string) => {
    const data = await getTournamentDetail(slug);
    setDetail(data);
    if (data) {
      const config: Record<string, DrawSettings> = {};
      data.divisions.forEach(d => {
        config[d.id] = d.drawConfig
          ? { pools: d.drawConfig.pools, advance: d.drawConfig.advance, crossing: d.drawConfig.crossing }
          : { ...DEFAULT_DRAW };
      });
      // Keep whatever top seeds were already picked for a division across a
      // reload (e.g. right after Draw Pool) instead of clearing them. On a
      // fresh mount (no client state yet — e.g. navigating back to this
      // page), hydrate from the persisted picks instead so they survive
      // leaving the page entirely.
      setSeedsByDiv(prev => {
        const next: Record<string, SeedTeam[]> = {};
        data.divisions.forEach(d => {
          const confirmedTeamsForDiv = d.teamsList.filter(t => t.status !== 'waitlist');
          const confirmedIds = new Set(confirmedTeamsForDiv.map(t => t.id));
          if (prev[d.id]) {
            next[d.id] = prev[d.id].filter(s => confirmedIds.has(s.id));
          } else {
            const savedIds = d.drawConfig?.topSeedIds ?? [];
            next[d.id] = savedIds
              .map(id => confirmedTeamsForDiv.find(t => t.id === id))
              .filter((t): t is (typeof confirmedTeamsForDiv)[number] => !!t)
              .map(t => ({ id: t.id, name: t.name }));
          }
        });
        return next;
      });
      setConfigByDiv(config);
      setActiveDiv(prev => (preferDiv && data.divisions.some(d => d.id === preferDiv) ? preferDiv : prev && data.divisions.some(d => d.id === prev) ? prev : data.divisions[0]?.id ?? ''));
    }
    return data;
  }, [slug]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setBackHidden(y > 80 && y > lastScrollY.current);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const division = useMemo(() => {
    if (!detail) return null;
    return detail.divisions.find(d => d.id === activeDiv) ?? detail.divisions[0] ?? null;
  }, [detail, activeDiv]);

  const [lockedByDiv, setLockedByDiv] = useState<Record<string, boolean>>({});

  const isDrawLocked = useMemo(() => {
    if (!activeDiv) return false;
    if (lockedByDiv[activeDiv] !== undefined) return lockedByDiv[activeDiv];
    return !!division?.drawConfig?.isLocked;
  }, [activeDiv, lockedByDiv, division]);

  const toggleLockDraw = async () => {
    if (!division) return;
    const nextLocked = !isDrawLocked;
    setLockedByDiv(prev => ({ ...prev, [activeDiv]: nextLocked }));
    if (nextLocked) {
      setDrawConfigOpen(false);
    }
    try {
      await fetch(`/api/tournaments/${slug}/divisions/${division.id}/draw`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: nextLocked }),
      });
      await load(division.id);
    } catch (err) {
      console.error(err);
    }
  };

  const seeds = seedsByDiv[activeDiv] ?? [];
  const config = configByDiv[activeDiv] ?? DEFAULT_DRAW;

  // Autosave the pending top-seed picks (debounced) so they survive leaving
  // the page entirely, not just an in-session redraw.
  useEffect(() => {
    if (loading || !activeDiv) return;
    const divisionId = activeDiv;
    const topSeedIds = seeds.map(t => t.id);
    const timer = setTimeout(() => {
      fetch(`/api/tournaments/${slug}/divisions/${divisionId}/draw`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topSeedIds }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds, activeDiv, slug, loading]);

  const confirmedTeams = useMemo(() => {
    return division?.teamsList.filter(t => t.status !== 'waitlist') ?? [];
  }, [division]);

  const unseededTeams = useMemo(() => {
    return confirmedTeams.filter(ct => !seeds.some(s => s.id === ct.id));
  }, [confirmedTeams, seeds]);

  const filteredTeams = useMemo(() => {
    return unseededTeams.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [unseededTeams, searchQuery]);

  const waitlistTeams = useMemo(() => {
    return division?.teamsList.filter(t => t.status === 'waitlist') ?? [];
  }, [division]);

  const bracket = useMemo<BracketView | null>(() => {
    if (!division) return null;
    const db = dbBracket(division);
    if (db) return db;
    // Before a draw exists: with a preceding round robin, project from the
    // seeds; for pure single elimination show the full empty bracket sized
    // to the confirmed-team count.
    const isRR = division.bracket.some(r => r.format === 'round-robin');
    return isRR ? projectBracket(seeds) : emptyBracket(confirmedTeams.length);
  }, [division, seeds, confirmedTeams]);

  const poolGroups = useMemo(() => {
    if (!division?.drawConfig) return [];
    const poolRound = division.bracket.find(r => r.format === 'round-robin');
    if (!poolRound || poolRound.matches.length === 0) return [];
    return assignPools(confirmedTeams, division.drawConfig.pools).map(pool => ({ name: pool.name, teams: pool.items }));
  }, [division, confirmedTeams]);

  /* Standings: pool matches carry no explicit pool id, so teams are
     attributed to a pool via poolGroups (which mirrors the server's
     serpentine assignment) and results are tallied from completed
     round-robin matches. */
  const poolStandings = useMemo(() => {
    if (poolGroups.length === 0) return [];
    const poolRound = division?.bracket.find(r => r.format === 'round-robin');
    const matches = poolRound?.matches ?? [];

    interface Standing {
      teamId: string;
      name: string;
      played: number;
      wins: number;
      losses: number;
      pointsFor: number;
      pointsAgainst: number;
    }
    const statsByTeam = new Map<string, Standing>();
    poolGroups.forEach(p => p.teams.forEach(t => {
      statsByTeam.set(t.id, { teamId: t.id, name: t.name, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 });
    }));

    matches.forEach(m => {
      if (m.status !== 'done' || !m.teamAId || !m.teamBId || !m.winner) return;
      const a = statsByTeam.get(m.teamAId);
      const b = statsByTeam.get(m.teamBId);
      if (!a || !b) return;
      a.played += 1; b.played += 1;
      if (m.winner === 'A') { a.wins += 1; b.losses += 1; } else { b.wins += 1; a.losses += 1; }
      (m.scoreA ?? []).forEach((points, i) => {
        const against = m.scoreB?.[i] ?? 0;
        a.pointsFor += points; a.pointsAgainst += against;
        b.pointsFor += against; b.pointsAgainst += points;
      });
    });

    return poolGroups.map(pool => ({
      name: pool.name,
      standings: pool.teams
        .map(t => statsByTeam.get(t.id)!)
        .sort((x, y) =>
          y.wins - x.wins ||
          (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) ||
          y.pointsFor - x.pointsFor
        ),
    }));
  }, [poolGroups, division]);

  const rankingPools = useMemo(() => {
    if (poolStandings.length > 0) {
      return poolStandings.map(p => ({
        name: p.name,
        teams: p.standings.map(s => ({ id: s.teamId, name: s.name })),
      }));
    }
    return poolGroups;
  }, [poolStandings, poolGroups]);

  // The Round 1 feature set (draw config, pool results) belongs to the
  // round-robin format; other formats get their own features later.
  const firstRoundFormat = division?.bracket[0]?.format ?? 'round-robin';
  const isRoundRobin = firstRoundFormat === 'round-robin';

  const hasRoundRobin = useMemo(() => {
    return division?.bracket.some(r => r.format === 'round-robin') ?? false;
  }, [division]);

  const hasKnockout = useMemo(() => {
    return division?.bracket.some(r => r.format === 'single' || r.format === 'double') ?? false;
  }, [division]);

  const knockoutFormat = useMemo(() => {
    const r = division?.bracket.find(r => r.format === 'single' || r.format === 'double');
    return r?.format ?? 'single';
  }, [division]);

  /* Draw-reveal choreography: pool cards morph in one by one (empty), then
     top seeds land in seed order, then the remaining teams fill pool by pool
     from A. Runs only for the division that was just drawn. */
  const poolAnim = useMemo(() => {
    if (animDiv !== activeDiv || poolGroups.length === 0) return null;
    const CARD_STAGGER = 0.3, CARD_DUR = 0.5;
    const SEED_STAGGER = 0.35, SEED_DUR = 0.4;
    const FILL_STAGGER = 1.05, FILL_DUR = 0.35;

    const cardDelay = new Map<string, number>();
    poolGroups.forEach((p, i) => cardDelay.set(p.name, i * CARD_STAGGER));
    const cardsEnd = (poolGroups.length - 1) * CARD_STAGGER + CARD_DUR;

    const teamDelay = new Map<string, number>();
    const drawnIds = new Set(poolGroups.flatMap(p => p.teams.map(t => t.id)));
    const topSeedIds = (division?.drawConfig?.topSeedIds ?? []).filter(id => drawnIds.has(id));
    topSeedIds.forEach((id, i) => teamDelay.set(id, cardsEnd + 0.2 + i * SEED_STAGGER));
    const seedsEnd = topSeedIds.length > 0
      ? cardsEnd + 0.2 + (topSeedIds.length - 1) * SEED_STAGGER + SEED_DUR
      : cardsEnd;

    let fillIdx = 0;
    poolGroups.forEach(p => p.teams.forEach(t => {
      if (!teamDelay.has(t.id)) teamDelay.set(t.id, seedsEnd + 0.2 + fillIdx++ * FILL_STAGGER);
    }));
    const total = seedsEnd + 0.2 + Math.max(0, fillIdx - 1) * FILL_STAGGER + FILL_DUR;

    return { cardDelay, teamDelay, total };
  }, [animDiv, activeDiv, poolGroups, division]);

  /* Re-draw reveal: on a re-draw the whole bracket starts empty and fills
     one slot at a time, keyed per slot ("ri-mi-A" / "ri-mi-B").
      • Round 1 first — with top seeds, team names reveal in seed order (top
        seeds first), each BYE landing with its match's team; with no top
        seeds, every BYE appears first, then the teams are drawn in.
      • Later rounds only start AFTER round 1 is fully filled, so the pre-
        advanced bye winners in round 2 don't spoil the draw. Each subsequent
        slot continues the same one-at-a-time cadence. */
  const bracketAnim = useMemo(() => {
    if (animDiv !== activeDiv || !bracket || !bracket.fromDb) return null;
    const rounds = bracket.rounds;
    if (rounds.length === 0) return null;

    const r1Matches = rounds[0]?.matches ?? [];
    if (r1Matches.length === 0) return null;

    const STAGGER = 3.0;
    const DUR = 2.4;
    const nameDelay = new Map<string, number>();
    const hasTopSeeds = (division?.drawConfig?.topSeedIds?.length ?? 0) > 0;

    let round1End: number;
    if (hasRoundRobin) {
      // Reveal single elimination bracket slots slowly one-by-one in match order
      const teamSlots: string[] = [];
      r1Matches.forEach((m, mi) => {
        teamSlots.push(`0-${mi}-A`);
        teamSlots.push(`0-${mi}-B`);
      });
      teamSlots.forEach((key, i) => nameDelay.set(key, i * STAGGER));
      round1End = Math.max(0, teamSlots.length - 1) * STAGGER + DUR;
    } else if (hasTopSeeds) {
      // Team slots ordered by seed (ascending = top seeds first).
      const teamSlots: { key: string; seed: number }[] = [];
      r1Matches.forEach((m, mi) => {
        if (m.rowA.name !== 'BYE') teamSlots.push({ key: `0-${mi}-A`, seed: m.rowA.seed ?? Infinity });
        if (m.rowB.name !== 'BYE') teamSlots.push({ key: `0-${mi}-B`, seed: m.rowB.seed ?? Infinity });
      });
      teamSlots.sort((a, b) => a.seed - b.seed);
      teamSlots.forEach((s, i) => nameDelay.set(s.key, i * STAGGER));
      // A bye's empty side reveals with its match's team.
      r1Matches.forEach((m, mi) => {
        if (m.rowA.name === 'BYE') nameDelay.set(`0-${mi}-A`, nameDelay.get(`0-${mi}-B`) ?? 0);
        if (m.rowB.name === 'BYE') nameDelay.set(`0-${mi}-B`, nameDelay.get(`0-${mi}-A`) ?? 0);
      });
      round1End = Math.max(0, teamSlots.length - 1) * STAGGER + DUR;
    } else {
      // No top seeds: reveal every BYE first (one-by-one), then the teams.
      const BYE_STAGGER = 3.0;
      const byeSlots: string[] = [];
      const teamSlots: string[] = [];
      r1Matches.forEach((m, mi) => {
        (m.rowA.name === 'BYE' ? byeSlots : teamSlots).push(`0-${mi}-A`);
        (m.rowB.name === 'BYE' ? byeSlots : teamSlots).push(`0-${mi}-B`);
      });
      byeSlots.forEach((key, i) => nameDelay.set(key, i * BYE_STAGGER));
      const byesEnd = byeSlots.length > 0 ? (byeSlots.length - 1) * BYE_STAGGER + DUR : 0;
      teamSlots.forEach((key, i) => nameDelay.set(key, byesEnd + i * STAGGER));
      round1End = byesEnd + Math.max(0, teamSlots.length - 1) * STAGGER + DUR;
    }

    // --- Later rounds: all reveal together, once round 1 has fully filled ---
    const laterDelay = round1End + 0.3; // small beat once round 1 is complete
    for (let ri = 1; ri < rounds.length; ri++) {
      rounds[ri].matches.forEach((_, mi) => {
        nameDelay.set(`${ri}-${mi}-A`, laterDelay);
        nameDelay.set(`${ri}-${mi}-B`, laterDelay);
      });
    }

    const total = rounds.length > 1 ? laterDelay + DUR : round1End;
    return { nameDelay, total };
  }, [animDiv, activeDiv, bracket, hasRoundRobin, division]);

  // Drop the animation classes once the sequence has fully played out, so
  // re-renders (division toggles, config edits) don't replay it.
  useEffect(() => {
    const totalSec = bracketAnim?.total ?? poolAnim?.total ?? 0;
    if (totalSec === 0) return;
    const t = setTimeout(() => setAnimDiv(null), (totalSec + 0.5) * 1000);
    return () => clearTimeout(t);
  }, [poolAnim, bracketAnim]);

  if (loading) {
    return <div className={styles.page}><div className={styles.centerState}>Loading tournament…</div></div>;
  }
  if (!detail) {
    return (
      <div className={styles.page}>
        <div className={styles.centerState}>
          Tournament not found.
          <Link href="/dashboard">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const totalTeams = detail.divisions.reduce((sum, d) => sum + d.filled, 0);
  const isLive = detail.date === 'Today';
  const heroImage = FALLBACK_HERO;

  // Master toggle for Round 1: showing opens every sub-section too, so the
  // chevron always means "show all / hide all" regardless of sub-toggle state.
  const togglePoolPlayAll = () => {
    const next = !poolPlayOpen;
    setPoolPlayOpen(next);
    setDrawConfigOpen(next);
    setPoolResultsOpen(next);
  };

  const toggleBracketAll = () => {
    const next = !round2Open;
    setRound2Open(next);
    setBracketConfigOpen(next);
    setBracketOpen(next);
  };

  const setConfig = (patch: Partial<DrawSettings>) => {
    setConfigByDiv({ ...configByDiv, [activeDiv]: { ...config, ...patch } });
  };

  const addSeed = (id: string) => {
    const team = confirmedTeams.find(t => t.id === id);
    if (!team) return;
    setSeedsByDiv({
      ...seedsByDiv,
      [activeDiv]: [...seeds, { id: team.id, name: team.name }]
    });
    setPendingSeed(null);
  };

  const removeSeed = (id: string) => {
    setSeedsByDiv({
      ...seedsByDiv,
      [activeDiv]: seeds.filter(t => t.id !== id)
    });
  };

  const reorder = (i: number) => {
    if (dragIndex === null || dragIndex === i) return;
    const list = [...seeds];
    const [m] = list.splice(dragIndex, 1);
    list.splice(i, 0, m);
    setSeedsByDiv({ ...seedsByDiv, [activeDiv]: list });
    setDragIndex(i);
  };

  const saveDraw = async () => {
    const totalConfirmed = seeds.length + unseededTeams.length;
    if (!division || totalConfirmed < 2 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const shuffledUnseeded = [...unseededTeams]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

      const fullSeedOrder = [
        ...seeds.map(t => t.id),
        ...shuffledUnseeded.map(t => t.id)
      ];

      const res = await fetch(`/api/tournaments/${slug}/divisions/${division.id}/draw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedOrder: fullSeedOrder,
          topSeedIds: seeds.map(t => t.id),
          pools: config.pools,
          advance: config.advance,
          crossing: config.crossing,
          generate: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      await load(division.id);
      setAnimDiv(division.id);
      setDrawTick(t => t + 1);
      setBracketOpen(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the draw');
    } finally {
      setSaving(false);
    }
  };

  const perPool = Math.max(1, Math.round(confirmedTeams.length / config.pools) || 1);
  const firstRoundMatches = bracket?.rounds[0]?.matches.length ?? 0;
  const colHeight = Math.max(firstRoundMatches * 95, 190);

  // Pure single-elimination summary (bracket padded to the next power of two).
  const seTeams = confirmedTeams.length;
  const seSize = seTeams >= 2 ? (() => { let s = 2; while (s < seTeams) s *= 2; return s; })() : 0;
  const seByes = seSize > 0 ? seSize - seTeams : 0;

  // Sequential match numbers across the whole bracket (round by round), so a
  // fed slot can point at the match it comes from ("Winner of M3").
  const matchNumbers: number[][] = [];
  if (bracket) {
    let counter = 1;
    bracket.rounds.forEach((round, r) => {
      matchNumbers[r] = round.matches.map(() => counter++);
    });
  }

  // Winners are emphasized only for real, completed matches (from the DB) —
  // never for projections. A fed slot with no team yet reads "Winner of M#"
  // (its feeding match); an undrawn round-1 slot is left blank.
  const rowClass = (row: ViewRow) => {
    const dimmed = row.name === 'BYE' || (row.lost && bracket?.fromDb);
    return `${styles.matchName} ${row.win && bracket?.fromDb ? styles.matchNameWin : ''} ${dimmed ? styles.matchNameLost : ''} ${row.live ? styles.matchNameLive : ''}`;
  };

  const rowDisplay = (row: ViewRow, roundIdx: number, feedNo: number | undefined) => {
    if (row.name === 'BYE') return 'BYE';
    if (row.name !== 'TBD') return row.name;
    return roundIdx > 0 && feedNo !== undefined ? `Winner of M${feedNo}` : '';
  };

  return (
    <div className={styles.page}>
      <Link
        href="/dashboard"
        className={`${styles.backLink} ${backHidden ? styles.backLinkHidden : ''}`}
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </Link>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section
        className={styles.hero}
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(20,24,30,0.12) 0%, rgba(20,24,30,0.30) 45%, rgba(20,24,30,0.62) 100%), url('${heroImage}')`,
        }}
      >
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            {isLive && (
              <div className={styles.heroTopRow}>
                <span className={styles.livePill}>
                  <span className={styles.livePillDot} aria-hidden="true" />
                  Live Now
                </span>
              </div>
            )}
            <h1 className={styles.heroTitle}>{detail.title}</h1>
            <div className={styles.heroMeta}>
              <span className={styles.heroMetaPill}><Calendar size={15} /> {detail.date}</span>
              <span className={styles.heroMetaPill}><MapPin size={15} /> {detail.location}</span>
              <span className={styles.heroMetaPill}>
                <Users size={15} /> {detail.divisions.length} Division{detail.divisions.length === 1 ? '' : 's'} · {totalTeams} Teams
              </span>
            </div>
            {detail.description && <p className={styles.heroDesc}>{detail.description}</p>}
          </div>
        </div>
      </section>

      {/* ── Sticky division bar ──────────────────────────────── */}
      <div className={styles.stickyBar}>
        <div className={styles.stickyInner}>
          <div className={styles.divisionsGroup}>
            <span className={styles.divisionsLabel}>
              <Trophy size={20} />
              <span>Divisions</span>
            </span>
            <div className={styles.segmented}>
              {detail.divisions.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`${styles.segBtn} ${d.id === activeDiv ? styles.segBtnActive : ''}`}
                  onClick={() => { setActiveDiv(d.id); setPendingSeed(null); setSaveError(null); }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.stickyActions}>
            <Link
              href={`/dashboard/tournament/${detail.slug}/schedule`}
              className={`${styles.teamsCountPill} ${styles.scheduleLink}`}
              style={{ textDecoration: 'none' }}
            >
              <Calendar size={15} /> Schedule
            </Link>
          </div>
        </div>
      </div>

      <main className={styles.main}>
        {/* ── Registered teams ───────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead} onClick={() => setTeamsOpen(v => !v)}>
            <div>
              <h2 className={styles.sectionTitle}>Registered Teams</h2>
              <p className={styles.sectionSub}>
                {division?.label ?? 'Division'} · {confirmedTeams.length} teams confirmed
              </p>
            </div>
            <button type="button" className={`${styles.toggleBtn} ${styles.toggleBtnIcon}`} aria-label="Toggle teams">
              <span className={`${styles.chevron} ${teamsOpen ? styles.chevronOpen : ''}`}>
                <ChevronDown size={18} />
              </span>
            </button>
          </div>
          <div className={`${styles.teamsWrap} ${teamsOpen ? styles.teamsWrapOpen : styles.teamsWrapClosed}`}>
            {confirmedTeams.length > 0 ? (
              <div className={styles.teamsGrid}>
                {confirmedTeams.map(team => (
                  <div key={team.id} className={styles.teamCard}>
                    <span className={styles.teamName}>{team.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyNote}>No teams registered in this division yet.</div>
            )}
          </div>
        </section>

        {/* ── Round 1: pool play ─────────────────────────────── */}
        {hasRoundRobin && (
          <section className={styles.section}>
            <div className={styles.sectionHead} onClick={togglePoolPlayAll}>
              <div>
                <h2 className={styles.sectionTitle}>
                  Round 1 <span style={{ color: 'var(--ink-500)' }}>· {FORMAT_LABELS[firstRoundFormat] ?? firstRoundFormat}</span>
                </h2>
                <p className={styles.sectionSub}>
                  {firstRoundFormat === 'round_robin'
                    ? 'Every team plays against all other teams in their pool to rank and advance to the knockout stage.'
                    : 'Initial round matches.'}
                </p>
              </div>
              <div className={styles.headBtns} onClick={e => e.stopPropagation()}>
                {isRoundRobin && !isDrawLocked && (
                  <button
                    type="button"
                    className={styles.toggleBtn}
                    aria-label="Toggle draw configuration"
                    onClick={() => setDrawConfigOpen(v => !v)}
                  >
                    <span>Draw Config</span>
                    <span className={`${styles.chevron} ${drawConfigOpen ? styles.chevronOpen : ''}`}>
                      <ChevronDown size={18} />
                    </span>
                  </button>
                )}
                {isRoundRobin && poolGroups.length > 0 && (
                  <button
                    type="button"
                    className={styles.toggleBtn}
                    aria-label="Toggle draw result"
                    onClick={() => setPoolResultsOpen(v => !v)}
                  >
                    <span>Draw Result</span>
                    <span className={`${styles.chevron} ${poolResultsOpen ? styles.chevronOpen : ''}`}>
                      <ChevronDown size={18} />
                    </span>
                  </button>
                )}
                {isRoundRobin && poolGroups.length > 0 && (
                  <button
                    type="button"
                    className={styles.toggleBtn}
                    aria-label="Toggle standing table"
                    onClick={() => setStandingsOpen(v => !v)}
                  >
                    <span>Standing Table</span>
                    <span className={`${styles.chevron} ${standingsOpen ? styles.chevronOpen : ''}`}>
                      <ChevronDown size={18} />
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.toggleBtn} ${styles.toggleBtnIcon}`}
                  aria-label={poolPlayOpen ? 'Hide all of pool play' : 'Show all of pool play'}
                  onClick={togglePoolPlayAll}
                >
                  <span className={`${styles.chevron} ${poolPlayOpen ? styles.chevronOpen : ''}`}>
                    <ChevronDown size={18} />
                  </span>
                </button>
              </div>
            </div>
            <div className={`${styles.roundWrap} ${poolPlayOpen ? styles.roundWrapOpen : styles.roundWrapClosed}`}>
            {isRoundRobin ? (
            <>
            {!isDrawLocked && (
              <div className={`${styles.roundWrap} ${drawConfigOpen ? styles.roundWrapOpen : styles.roundWrapClosed}`}>
            <div className={styles.poolRow}>
              <div className={styles.seedCard}>
                <h3 className={styles.cardTitle}>Top Seed</h3>
                <div className={styles.seedSelectRow}>
                  <div className={styles.selectWrap} ref={dropdownRef}>
                    <input
                      type="text"
                      className={`${styles.select} ${styles.selectAccent}`}
                      style={{ cursor: 'text' }}
                      placeholder={unseededTeams.length === 0 ? "All teams seeded" : "Select team..."}
                      value={dropdownOpen ? searchQuery : (confirmedTeams.find(t => t.id === pendingSeed)?.name ?? searchQuery)}
                      onChange={e => {
                        setSearchQuery(e.target.value);
                        setDropdownOpen(true);
                      }}
                      onFocus={() => {
                        setSearchQuery('');
                        setDropdownOpen(true);
                      }}
                      disabled={unseededTeams.length === 0}
                    />
                    <button
                      type="button"
                      className={styles.selectChevron}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      onClick={() => {
                        if (unseededTeams.length > 0) {
                          setDropdownOpen(!dropdownOpen);
                        }
                      }}
                      disabled={unseededTeams.length === 0}
                      aria-label="Toggle dropdown"
                    >
                      <ChevronDown size={18} />
                    </button>

                    {/* Dropdown list popover */}
                    {dropdownOpen && unseededTeams.length > 0 && (
                      <div className={styles.dropdownPopover}>
                        {filteredTeams.map(team => (
                          <div
                            key={team.id}
                            className={styles.dropdownOption}
                            onClick={() => {
                              setPendingSeed(team.id);
                              setSearchQuery('');
                              setDropdownOpen(false);
                            }}
                          >
                            {team.name}
                          </div>
                        ))}
                        {filteredTeams.length === 0 && (
                          <div className={styles.dropdownEmpty}>No teams match search</div>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    size="medium"
                    onClick={() => {
                      if (pendingSeed) {
                        addSeed(pendingSeed);
                        setSearchQuery('');
                        setDropdownOpen(false);
                      }
                    }}
                    disabled={unseededTeams.length === 0 || !pendingSeed}
                  >
                    Add Top Seed
                  </Button>
                </div>
                <div className={styles.seedList}>
                  {seeds.map((team, i) => (
                    <div
                      key={team.id}
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragEnter={() => reorder(i)}
                      onDragOver={e => e.preventDefault()}
                      onDragEnd={() => setDragIndex(null)}
                      className={`${styles.seedRow} ${dragIndex === i ? styles.seedRowDragging : ''}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className={styles.seedRowNum}>{i + 1}</span>
                        <span className={styles.seedRowName}>{team.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSeed(team.id)}
                        title="Remove from seeding"
                        style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  {seeds.length === 0 && (
                    <div className={styles.emptyNote}>No teams seeded yet. Use the dropdown above to add seeds.</div>
                  )}
                </div>
              </div>

              <div className={styles.configCard}>
                <h3 className={styles.cardTitle}>Draw Configuration</h3>
                <div>
                  <label className={styles.fieldLabel}>Number of Pools</label>
                  <div className={styles.fieldRow}>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        className={styles.stepperBtn}
                        onClick={() => setConfig({ pools: Math.max(2, config.pools - 1) })}
                        disabled={config.pools <= 2}
                        aria-label="Decrease number of pools"
                      >
                        −
                      </button>
                      <span className={styles.stepperValue}>{config.pools}</span>
                      <button
                        type="button"
                        className={styles.stepperBtn}
                        onClick={() => setConfig({ pools: Math.min(8, config.pools + 1) })}
                        disabled={config.pools >= 8}
                        aria-label="Increase number of pools"
                      >
                        +
                      </button>
                    </div>
                    <span className={styles.fieldSummary}>
                      {confirmedTeams.length} teams · ~{perPool} per pool
                    </span>
                  </div>
                </div>
                <div className={styles.drawBtnWrap}>
                  <Button
                    variant="primary"
                    size="medium"
                    fullWidth
                    loading={saving}
                    disabled={confirmedTeams.length < 2}
                    onClick={saveDraw}
                    style={{ height: 60, fontSize: 16 }}
                  >
                    Draw Pool
                  </Button>
                  {saveError && <p className={styles.saveError}>{saveError}</p>}
                </div>
              </div>
            </div>
            </div>
            )}

            {poolGroups.length > 0 && (
              <div className={`${styles.roundWrap} ${poolResultsOpen ? styles.roundWrapOpen : styles.roundWrapClosed}`}>
              <div className={styles.poolsWrap}>
                <div className={styles.poolsHead}>
                  <div className={styles.poolsHeadLeft}>
                    <h3 className={styles.cardTitle}>Draw Result</h3>
                    {!!division?.drawConfig?.attempts && (
                      <span className={styles.attemptNote}>
                        {division.drawConfig.attempts} attempt{division.drawConfig.attempts === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={isDrawLocked ? styles.lockBtnActive : styles.lockBtn}
                    onClick={toggleLockDraw}
                  >
                    {isDrawLocked ? (
                      <>
                        <Lock size={14} /> Draw Result Locked
                      </>
                    ) : (
                      <>
                        <Unlock size={14} /> Lock Draw Result
                      </>
                    )}
                  </button>
                </div>
                <div className={styles.poolsGrid} key={drawTick}>
                  {poolGroups.map(pool => (
                    <div
                      key={pool.name}
                      className={`${styles.poolCard} ${poolAnim ? styles.poolCardAnim : ''}`}
                      style={poolAnim ? { animationDelay: `${poolAnim.cardDelay.get(pool.name) ?? 0}s` } : undefined}
                    >
                      <div className={styles.poolCardHeader}>
                        <span className={styles.poolBadge}>{pool.name}</span>
                        <span className={styles.poolCardCount}>{pool.teams.length} teams</span>
                      </div>
                      <div className={styles.poolTeamList}>
                        {pool.teams.map(t => (
                          <div
                            key={t.id}
                            className={`${styles.poolTeamRow} ${poolAnim ? styles.poolTeamAnim : ''}`}
                            style={poolAnim ? { animationDelay: `${poolAnim.teamDelay.get(t.id) ?? 0}s` } : undefined}
                          >
                            {t.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </div>
            )}

            {poolGroups.length > 0 && (
              <div className={`${styles.roundWrap} ${standingsOpen ? styles.roundWrapOpen : styles.roundWrapClosed}`}>
              <div className={styles.poolsWrap}>
                <div className={styles.poolsHead}>
                  <div className={styles.poolsHeadLeft}>
                    <h3 className={styles.cardTitle}>Standing Table</h3>
                  </div>
                </div>
                <div className={styles.poolsGrid}>
                  {poolStandings.map(pool => (
                    <div key={pool.name} className={styles.poolCard}>
                      <div className={styles.poolCardHeader}>
                        <span className={styles.poolBadge}>{pool.name}</span>
                        <span className={styles.poolCardCount}>{pool.standings.length} teams</span>
                      </div>
                      <table className={styles.standingsTable}>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Team</th>
                            <th>W</th>
                            <th>L</th>
                            <th>Pts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pool.standings.map((s, i) => (
                            <tr key={s.teamId}>
                              <td>{i + 1}</td>
                              <td className={styles.standingsTeam}>{s.name}</td>
                              <td>{s.wins}</td>
                              <td>{s.losses}</td>
                              <td>{s.pointsFor - s.pointsAgainst > 0 ? '+' : ''}{s.pointsFor - s.pointsAgainst}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
              </div>
            )}
            </>
            ) : (
              <div className={styles.emptyNote}>
                {FORMAT_LABELS[firstRoundFormat] ?? firstRoundFormat} features for this round are coming soon.
              </div>
            )}
            </div>
          </section>
        )}

        {/* ── Round 2: single elimination ────────────────────── */}
        {hasKnockout && (
          <section className={styles.section}>
            <div className={styles.sectionHead} onClick={toggleBracketAll}>
              <div>
                <h2 className={styles.sectionTitle}>
                  {hasRoundRobin ? 'Round 2' : 'Round 1'}{' '}
                  <span style={{ color: 'var(--ink-500)' }}>
                    · {FORMAT_LABELS[knockoutFormat] ?? knockoutFormat ?? 'Single Elimination'}
                  </span>
                </h2>
                <p className={styles.sectionSub}>
                  {hasRoundRobin
                    ? 'Seed advancing teams from pool play into the single elimination knockout bracket.'
                    : 'Single elimination knockout bracket.'}
                </p>
              </div>
              <div className={styles.headBtns} onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  aria-label="Toggle bracket configuration"
                  onClick={() => setBracketConfigOpen(v => !v)}
                >
                  <span>Bracket Config</span>
                  <span className={`${styles.chevron} ${bracketConfigOpen ? styles.chevronOpen : ''}`}>
                    <ChevronDown size={18} />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  aria-label="Toggle bracket view"
                  onClick={() => setBracketOpen(v => !v)}
                >
                  <span>Bracket</span>
                  <span className={`${styles.chevron} ${bracketOpen ? styles.chevronOpen : ''}`}>
                    <ChevronDown size={18} />
                  </span>
                </button>
                <button
                  type="button"
                  className={`${styles.toggleBtn} ${styles.toggleBtnIcon}`}
                  aria-label={round2Open ? 'Hide all of bracket' : 'Show all of bracket'}
                  onClick={toggleBracketAll}
                >
                  <span className={`${styles.chevron} ${round2Open ? styles.chevronOpen : ''}`}>
                    <ChevronDown size={18} />
                  </span>
                </button>
              </div>
            </div>
            <div className={`${styles.roundWrap} ${round2Open ? styles.roundWrapOpen : styles.roundWrapClosed}`}>
            {bracketConfigOpen && (
              <>
                <p className={styles.sectionSubSpaced}>
                  {firstRoundMatches * 2 || 'No'}-team {knockoutFormat === 'double' ? 'double' : 'single'} elimination · {division?.label ?? '—'} ·{' '}
                  {bracket?.fromDb
                    ? 'generated draw'
                    : hasRoundRobin
                      ? 'projected from current seeding'
                      : `empty bracket · ${confirmedTeams.length} teams · draw to place`}
                </p>

                {/* Seed / Draw Configuration for pure Single Elimination (no pool play) */}
                {!hasRoundRobin && (
                  <div className={styles.poolRow} style={{ marginBottom: 24 }}>
                    {/* Left pane: bracket overview + draw action */}
                    <div className={styles.configCard} style={{ flex: 1 }}>
                      <h3 className={styles.cardTitle}>Bracket Overview</h3>
                      <div className={styles.statList}>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Teams</span>
                          <span className={styles.statValue}>{seTeams}</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Top seeds</span>
                          <span className={styles.statValue}>{seeds.length}</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Byes</span>
                          <span className={`${styles.statValue} ${seByes > 0 ? styles.statValueAccent : ''}`}>{seByes}</span>
                        </div>
                      </div>
                      <div className={styles.drawBtnWrap}>
                        <Button
                          variant="primary"
                          size="medium"
                          fullWidth
                          loading={saving}
                          disabled={confirmedTeams.length < 2}
                          onClick={saveDraw}
                          style={{ height: 60, fontSize: 16 }}
                        >
                          {saving ? 'Drawing Bracket…' : bracket?.fromDb ? 'Re-Draw Bracket' : 'Draw Bracket'}
                        </Button>
                        {saveError && <p className={styles.saveError}>{saveError}</p>}
                        {division?.drawConfig?.attempts ? (
                          <p className={styles.fieldNote} style={{ marginTop: 8, textAlign: 'center' }}>
                            Draw Attempt #{division.drawConfig.attempts}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {/* Right pane: top-seed selection */}
                    <div className={styles.seedCard} style={{ flex: 1 }}>
                      <h3 className={styles.cardTitle}>Top Seed</h3>
                      <div className={styles.seedSelectRow}>
                        <div className={styles.selectWrap} ref={dropdownRef}>
                          <input
                            type="text"
                            className={`${styles.select} ${styles.selectAccent}`}
                            style={{ cursor: 'text' }}
                            placeholder={unseededTeams.length === 0 ? "All teams seeded" : "Select team..."}
                            value={dropdownOpen ? searchQuery : (confirmedTeams.find(t => t.id === pendingSeed)?.name ?? searchQuery)}
                            onChange={e => {
                              setSearchQuery(e.target.value);
                              setDropdownOpen(true);
                            }}
                            onFocus={() => {
                              setSearchQuery('');
                              setDropdownOpen(true);
                            }}
                            disabled={unseededTeams.length === 0}
                          />
                          <button
                            type="button"
                            className={styles.selectChevron}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            onClick={() => {
                              if (unseededTeams.length > 0) {
                                setDropdownOpen(!dropdownOpen);
                              }
                            }}
                            disabled={unseededTeams.length === 0}
                            aria-label="Toggle dropdown"
                          >
                            <ChevronDown size={18} />
                          </button>

                          {/* Dropdown list popover */}
                          {dropdownOpen && unseededTeams.length > 0 && (
                            <div className={styles.dropdownPopover}>
                              {filteredTeams.map(team => (
                                <div
                                  key={team.id}
                                  className={styles.dropdownOption}
                                  onClick={() => {
                                    setPendingSeed(team.id);
                                    setSearchQuery('');
                                    setDropdownOpen(false);
                                  }}
                                >
                                  {team.name}
                                </div>
                              ))}
                              {filteredTeams.length === 0 && (
                                <div className={styles.dropdownEmpty}>No teams match search</div>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="primary"
                          size="medium"
                          onClick={() => {
                            if (pendingSeed) {
                              addSeed(pendingSeed);
                              setSearchQuery('');
                              setDropdownOpen(false);
                            }
                          }}
                          disabled={unseededTeams.length === 0 || !pendingSeed}
                        >
                          Add Top Seed
                        </Button>
                      </div>
                      <div className={styles.seedList}>
                        {seeds.map((team, i) => (
                          <div
                            key={team.id}
                            draggable={hasRoundRobin}
                            onDragStart={() => hasRoundRobin && setDragIndex(i)}
                            onDragEnter={() => hasRoundRobin && reorder(i)}
                            onDragOver={e => e.preventDefault()}
                            onDragEnd={() => setDragIndex(null)}
                            className={`${styles.seedRow} ${dragIndex === i ? styles.seedRowDragging : ''}`}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              {!hasRoundRobin ? (
                                <span className={styles.topSeedBadge}>Top Seed</span>
                              ) : (
                                <span className={styles.seedRowNum}>{i + 1}</span>
                              )}
                              <span className={styles.seedRowName}>{team.name}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeSeed(team.id)}
                              title="Remove top seed"
                              style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                        {seeds.length === 0 && (
                          <div className={styles.emptyNote}>
                            {!hasRoundRobin
                              ? 'No top seeds assigned. All teams will be randomly drawn into the bracket.'
                              : 'No teams seeded yet. Use the dropdown above to add seeds.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Pool rankings and Bracket Crossing Settings Card when there is a preceding round-robin round */}
                {hasRoundRobin && (
                  <div className={styles.poolRow} style={{ marginBottom: 24, gap: 24, display: 'flex', alignItems: 'flex-start' }}>
                    {/* Left Pane: Bracket Crossing Settings Card */}
                    <div className={styles.configCard} style={{ width: 340, flexShrink: 0 }}>
                      <h3 className={styles.cardTitle}>Bracket Crossing Settings</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                          <label className={styles.fieldLabel}>Teams Advancing per Pool</label>
                          <div className={styles.fieldRow}>
                            <input
                              type="number"
                              min={1}
                              max={4}
                              value={config.advance}
                              onChange={e => {
                                let v = parseInt(e.target.value, 10);
                                if (isNaN(v)) v = 1;
                                setConfig({ advance: Math.max(1, Math.min(4, v)) });
                              }}
                              className={styles.numInput}
                            />
                            <span className={styles.fieldSummary}>
                              {config.advance * poolGroups.length} teams advance
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className={styles.fieldLabel}>Bracket Crossing Logic <em>*</em></label>
                          <div className={styles.selectWrap}>
                            <select
                              className={styles.select}
                              value={config.crossing}
                              onChange={e => setConfig({ crossing: e.target.value })}
                            >
                              <option value="fivb">FIVB Standard Draw</option>
                              <option value="static">Static Cross-Bracket A1–D4</option>
                            </select>
                            <span className={styles.selectChevron}><ChevronDown size={18} /></span>
                          </div>
                          <p className={styles.fieldNote}>Determines how pool finishers are seeded into the knockout round.</p>
                        </div>
                        <div className={styles.drawBtnWrap}>
                          <Button
                            variant="primary"
                            size="medium"
                            fullWidth
                            loading={saving}
                            onClick={saveDraw}
                          >
                            Apply Crossing Config
                          </Button>
                          {saveError && <p className={styles.saveError}>{saveError}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Right Pane: Pool Rankings */}
                    <div className={styles.seedCard} style={{ flex: 1 }}>
                      <h3 className={styles.cardTitle}>Pool Rankings</h3>
                      <div className={styles.poolsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                        {rankingPools.map(pool => (
                          <div key={pool.name} className={styles.poolCard} style={{ border: '1px solid var(--sand-300, #EAE5DD)', borderRadius: 12, padding: 14, backgroundColor: 'var(--surface-card, #ffffff)' }}>
                            <div className={styles.poolCardHeader} style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className={styles.poolBadge} style={{ fontWeight: 800 }}>{pool.name}</span>
                              <span className={styles.poolCardCount} style={{ fontSize: 12, color: 'var(--ink-500)' }}>{pool.teams.length} teams</span>
                            </div>
                            <div className={styles.poolTeamList} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {pool.teams.map((t, idx) => {
                                const isAdvancing = idx < config.advance;
                                return (
                                  <div
                                    key={t.id}
                                    className={styles.poolTeamRow}
                                    style={{
                                      fontSize: 13,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      padding: '6px 10px',
                                      borderRadius: 8,
                                      backgroundColor: isAdvancing ? 'var(--surface-card, #ffffff)' : 'transparent',
                                      opacity: isAdvancing ? 1 : 0.45,
                                      border: isAdvancing ? '1px solid var(--sand-300, #EAE5DD)' : '1px transparent solid',
                                      transition: 'all 0.2s ease',
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 800,
                                        minWidth: 22,
                                        height: 22,
                                        borderRadius: 6,
                                        backgroundColor: isAdvancing ? 'var(--orange, #EE7A4C)' : 'rgba(0,0,0,0.06)',
                                        color: isAdvancing ? '#ffffff' : 'var(--ink-600)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                      }}
                                    >
                                      #{idx + 1}
                                    </span>
                                    <span
                                      style={{
                                        fontWeight: isAdvancing ? 700 : 500,
                                        color: isAdvancing ? 'var(--ink-900)' : 'var(--ink-500)',
                                        textOverflow: 'ellipsis',
                                        overflow: 'hidden',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {t.name}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {bracketOpen && (
              <>
                {bracket ? (
                  <div className={styles.bracketScroll}>
                    <div className={styles.bracketRow}>
                      {bracket.rounds.map((round, ri) => (
                        <div key={round.name} className={styles.roundCol}>
                          <div className={styles.roundName}>{round.name}</div>
                          <div className={styles.roundMatches} style={{ height: colHeight }}>
                            {round.matches.map((m, mi) => {
                              const feedA = ri > 0 ? matchNumbers[ri - 1]?.[mi * 2] : undefined;
                              const feedB = ri > 0 ? matchNumbers[ri - 1]?.[mi * 2 + 1] : undefined;
                              // Round-1 names reveal one at a time on a re-draw.
                              const revealA = bracketAnim?.nameDelay.get(`${ri}-${mi}-A`);
                              const revealB = bracketAnim?.nameDelay.get(`${ri}-${mi}-B`);
                              return (
                                <div key={mi} className={styles.matchSlot}>
                                  <div className={styles.matchCard}>
                                  <span className={styles.matchNo}>M{matchNumbers[ri]?.[mi]}</span>
                                  {m.live && (
                                    <div className={styles.matchLiveRow}>
                                      <span className={styles.liveTag}>
                                        <span className={styles.liveTagDot} aria-hidden="true" />
                                        Live
                                      </span>
                                    </div>
                                  )}
                                  <div className={styles.matchRow}>
                                    <span
                                      className={`${rowClass(m.rowA)} ${revealA !== undefined ? styles.nameReveal : ''}`}
                                      style={revealA !== undefined ? { animationDelay: `${revealA}s` } : undefined}
                                    >
                                      {rowDisplay(m.rowA, ri, feedA)}
                                    </span>
                                  </div>
                                  <div className={styles.matchDivider} />
                                  <div className={styles.matchRow}>
                                    <span
                                      className={`${rowClass(m.rowB)} ${revealB !== undefined ? styles.nameReveal : ''}`}
                                      style={revealB !== undefined ? { animationDelay: `${revealB}s` } : undefined}
                                    >
                                      {rowDisplay(m.rowB, ri, feedB)}
                                    </span>
                                  </div>
                                </div>
                                {m.hasRight && <div className={styles.connRight} />}
                                {m.hasSpine && <div className={styles.connSpine} />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <div className={styles.champCol}>
                        <div className={styles.champLabel}>Champion</div>
                        <div className={styles.champSlot} style={{ height: colHeight }}>
                          <div className={styles.champCard}>
                            <span className={styles.champTrophy}><Trophy size={30} /></span>
                            <span className={styles.champEyebrow}>
                              {bracket.fromDb
                                ? (bracket.champion ? 'Champion' : 'Awaiting Final')
                                : (bracket.champion ? 'Projected Winner' : 'Champion')}
                            </span>
                            <span className={styles.champName}>
                              {bracket.champion ?? 'TBD'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyNote}>
                    The bracket will appear here once at least two teams are registered.
                  </div>
                )}
              </>
            )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
