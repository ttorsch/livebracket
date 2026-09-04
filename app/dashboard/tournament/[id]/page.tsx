'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { ArrowLeft, Calendar, ChevronDown, Lock, MapPin, Settings, Trophy, Unlock, Users, X, ImagePlus } from 'lucide-react';
import styles from './page.module.css';

const cardVariants: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 50 : dir < 0 ? -50 : 0,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: {
      x: { type: 'spring' as const, stiffness: 350, damping: 30 },
      opacity: { duration: 0.2 },
    },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -50 : dir < 0 ? 50 : 0,
    opacity: 0,
    transition: {
      x: { type: 'spring' as const, stiffness: 350, damping: 30 },
      opacity: { duration: 0.15 },
    },
  }),
};
import { Button, Card, Badge, Icon } from '../../../../components/livebracket-ds';
import { getTournamentDetail, type TournamentDetail, type DetailDivision, type DetailMatch } from '../../../../lib/data';
import { assignPools, divisionPrefix, isThirdPlaceRound, labelDivisionMatches, type MatchLabel } from '../../../../lib/divisionMatches';
import { isGroupFormat, isKnockoutFormat, roundFormatLabel } from '../../../../lib/roundFormat';
import { divisionRegistrationState, isPublic, type Phase, PHASE } from '../../../../lib/tournamentLifecycle';
import { describeDiscardCost, type DiscardCost } from '../../../../lib/schedule/discardCost';
import { formatTeamFirstName } from '../../../../lib/teamName';

const FALLBACK_HERO = '/images/livebracket/beach-volleyball.jpg';

interface SeedTeam {
  id: string;
  name: string;
}

interface DrawSettings {
  pools: number;
  advance: number;
  crossing: string;
  thirdPlace: boolean;
}

const DEFAULT_DRAW: DrawSettings = { pools: 4, advance: 2, crossing: 'fivb', thirdPlace: false };

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
  no: string; // division-numbered, e.g. "M25" — continues through pool play
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
  thirdPlaceMatch?: ViewMatch | null;
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

function roundName(fieldSize: number): string {
  if (fieldSize === 2) return 'Final';
  if (fieldSize === 4) return 'Semifinals';
  if (fieldSize === 8) return 'Quarterfinals';
  return `Round of ${fieldSize}`;
}

/* Projection: favorite (lower seed) advances everywhere; used until a
   real draw has been generated for the division. `startNo` continues the
   division's numbering past any pool matches already drawn. */
function projectBracket(teams: SeedTeam[], prefix: string, startNo: number): BracketView | null {
  if (teams.length < 2) return null;
  let size = 2;
  while (size < teams.length) size *= 2;

  interface Entrant { seed: number; name: string | null }
  let field: Entrant[] = seedPlacement(size).map(seed => ({ seed, name: teams[seed - 1]?.name ?? null }));

  const totalRounds = Math.log2(size);
  const rounds: ViewRound[] = [];
  let matchNo = startNo;

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
        no: `${prefix}${matchNo++}`,
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
function emptyBracket(teamCount: number, prefix: string, startNo: number): BracketView | null {
  if (teamCount < 2) return null;
  let size = 2;
  while (size < teamCount) size *= 2;

  const totalRounds = Math.log2(size);
  const rounds: ViewRound[] = [];
  let matchCount = size / 2;
  let cumulativeMatchNo = startNo;

  for (let r = 0; r < totalRounds; r++) {
    const isFinal = r === totalRounds - 1;
    const matches: ViewMatch[] = [];
    const prevStartMatchNo = r > 0 ? cumulativeMatchNo - (matchCount * 2) : startNo;

    for (let i = 0; i < matchCount; i++) {
      const feedA = r === 0 ? startNo + 2 * i : prevStartMatchNo + 2 * i;
      const feedB = feedA + 1;

      const mkRow = (name: string): ViewRow => ({ seed: null, name, win: false, lost: false, live: false });
      matches.push({
        no: `${prefix}${cumulativeMatchNo + i}`,
        live: false,
        hasRight: !isFinal,
        hasLeft: r > 0,
        hasSpine: !isFinal && i % 2 === 0,
        rowA: mkRow(`Winner of ${prefix}${feedA}`),
        rowB: mkRow(`Winner of ${prefix}${feedB}`),
      });
    }
    rounds.push({ name: roundName(matchCount * 2), matches });
    cumulativeMatchNo += matchCount;
    matchCount /= 2;
  }

  return { rounds, champion: null, fromDb: false };
}

/* Real bracket: the division's single-elimination rounds from the DB. Numbers
   and slot names come from the shared division labelling, so the bracket, the
   schedule and the match list all call a match the same thing. */
function dbBracket(division: DetailDivision, labels: Map<string, MatchLabel>): BracketView | null {
  const allKnockout = division.bracket.filter(r => isKnockoutFormat(r.format) && r.matches.length > 0);
  // The play-off for 3rd hangs off the semifinals, not off the round before it,
  // so it is not part of the halving tree and is positioned below the final.
  const knockout = allKnockout.filter(r => !isThirdPlaceRound(division, r));
  const thirdPlace = allKnockout.filter(r => isThirdPlaceRound(division, r));
  if (knockout.length === 0) return null;

  const seedOf = new Map(division.teamsList.map(t => [t.id, t.seed]));
  const total = knockout.length;

  const mkRow = (id: string | null, name: string, winnerSide: boolean, m: DetailMatch): ViewRow => ({
    seed: id ? seedOf.get(id) ?? null : null,
    name,
    win: winnerSide,
    lost: !!id && m.status === 'done' && m.winner !== undefined && !winnerSide,
    live: m.status === 'live',
  });

  const rounds: ViewRound[] = knockout.map((r, ri) => {
    const isTree = ri < total;
    const matches = r.matches.map((m, mi) => {
      const label = labels.get(m.id);

      return {
        no: label?.no ?? '',
        live: m.status === 'live',
        hasRight: isTree && ri < total - 1,
        hasLeft: isTree && ri > 0,
        hasSpine: isTree && ri < total - 1 && mi % 2 === 0,
        rowA: mkRow(m.teamAId, label?.teamA ?? 'TBD', m.status === 'done' && m.winner === 'A', m),
        rowB: mkRow(m.teamBId, label?.teamB ?? 'TBD', m.status === 'done' && m.winner === 'B', m),
      };
    });

    return { name: r.round, matches };
  });

  let thirdPlaceMatch: ViewMatch | null = null;
  const tpRound = thirdPlace[0];
  if (tpRound && tpRound.matches.length > 0) {
    const m = tpRound.matches[0];
    const label = labels.get(m.id);
    thirdPlaceMatch = {
      no: label?.no ?? '',
      live: m.status === 'live',
      hasRight: false,
      hasLeft: false,
      hasSpine: false,
      rowA: mkRow(m.teamAId, label?.teamA ?? 'TBD', m.status === 'done' && m.winner === 'A', m),
      rowB: mkRow(m.teamBId, label?.teamB ?? 'TBD', m.status === 'done' && m.winner === 'B', m),
    };
  }

  const final = knockout[total - 1].matches[0];
  const champion = final?.winner === 'A' ? final.teamAName : final?.winner === 'B' ? final.teamBName : null;

  return { rounds, thirdPlaceMatch, champion, fromDb: true };
}

/* A 409 from the draw route means "well formed, but it would cost you this".
   Anything else is a plain failure and is thrown as one. */
function readDiscardRefusal(status: number, body: unknown): DiscardCost | null {
  if (status !== 409) return null;
  const b = body as { needsDiscardConfirm?: boolean; cost?: DiscardCost } | null;
  if (!b?.needsDiscardConfirm || !b.cost) return null;
  return b.cost;
}

export default function OrganizerBracketPage() {
  const params = useParams<{ id: string }>();
  const slug = params.id;

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeDiv, setActiveDiv] = useState<string>('');
  const [divDirection, setDivDirection] = useState<number>(0);

  const handleSelectDivision = useCallback((newId: string) => {
    if (newId === activeDiv || !detail) return;
    const currentIndex = detail.divisions.findIndex(d => d.id === activeDiv);
    const newIndex = detail.divisions.findIndex(d => d.id === newId);
    if (currentIndex !== -1 && newIndex !== -1) {
      setDivDirection(newIndex > currentIndex ? 1 : -1);
    }
    setActiveDiv(newId);
  }, [activeDiv, detail]);
  const [round1Tab, setRound1Tab] = useState<'config' | 'result' | 'standings'>('config');
  const [r1TabDirection, setR1TabDirection] = useState<number>(0);
  const handleSelectRound1Tab = (t: 'config' | 'result' | 'standings') => {
    if (t === round1Tab) return;
    const order: ('config' | 'result' | 'standings')[] = ['config', 'result', 'standings'];
    const curIdx = order.indexOf(round1Tab);
    const newIdx = order.indexOf(t);
    if (curIdx !== -1 && newIdx !== -1) {
      setR1TabDirection(newIdx > curIdx ? 1 : -1);
    }
    setRound1Tab(t);
  };

  const [round2Tab, setRound2Tab] = useState<'config' | 'bracket'>('bracket');
  const [r2TabDirection, setR2TabDirection] = useState<number>(0);
  const handleSelectRound2Tab = (t: 'config' | 'bracket') => {
    if (t === round2Tab) return;
    const order: ('config' | 'bracket')[] = ['config', 'bracket'];
    const curIdx = order.indexOf(round2Tab);
    const newIdx = order.indexOf(t);
    if (curIdx !== -1 && newIdx !== -1) {
      setR2TabDirection(newIdx > curIdx ? 1 : -1);
    }
    setRound2Tab(t);
  };
  const [seedsByDiv, setSeedsByDiv] = useState<Record<string, SeedTeam[]>>({});
  const [configByDiv, setConfigByDiv] = useState<Record<string, DrawSettings>>({});
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false); // crossing config only
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyingThird, setApplyingThird] = useState(false); // 3rd-place play-off only
  const [thirdError, setThirdError] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  /* Set when the server refuses a rebuild because it would discard a saved
     schedule. Holds the server's own count, never a client guess. */
  const [discard, setDiscard] = useState<{ kind: 'draw' | 'crossing' | 'thirdPlace'; cost: DiscardCost } | null>(null);
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
  const drawResultRef = useRef<HTMLDivElement | null>(null);

  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tournaments/${slug}/player-avatars`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data?.avatars) {
          setPlayerAvatars(data.avatars);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setBackHidden(y > 80 && y > lastScrollY.current);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const load = useCallback(async (preferDiv?: string) => {
    const data = await getTournamentDetail(slug);
    setDetail(data);
    if (data) {
      const config: Record<string, DrawSettings> = {};
      data.divisions.forEach(d => {
        /* settings.draw can exist as a stub before any draw has run, and its
           advance is defaulted on read — so the presence of the key proves
           nothing. Matches do: until they exist, the count the organizer set
           at division setup is the truth. */
        const drawn = d.bracket.some(r => r.matches.length > 0);
        config[d.id] = d.drawConfig
          ? {
              pools: d.drawConfig.pools,
              advance: d.drawConfig.advance ?? d.advancePerPool ?? 2,
              crossing: d.drawConfig.crossing ?? d.crossing ?? 'fivb',
              thirdPlace: !!d.drawConfig.thirdPlace,
            }
          : { ...DEFAULT_DRAW, advance: d.advancePerPool ?? 2, crossing: d.crossing ?? 'fivb' };
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

  const prevActiveDivRef = useRef<string>('');

  useEffect(() => {
    if (!activeDiv) return;
    if (prevActiveDivRef.current !== activeDiv) {
      prevActiveDivRef.current = activeDiv;
      const div = detail?.divisions.find(d => d.id === activeDiv);
      const isLocked = lockedByDiv[activeDiv] !== undefined
        ? lockedByDiv[activeDiv]
        : !!div?.drawConfig?.isLocked;
      setRound1Tab(isLocked ? 'standings' : 'config');
      // Carrying a 'config' tab across into a locked division would land on a
      // tab that division does not offer.
      if (isLocked) setRound2Tab('bracket');
    }
  }, [activeDiv, detail, lockedByDiv]);

  /* The lock is shown optimistically and then *put back* if the server refuses.
     It used to be shown optimistically and never put back: the response was
     not checked at all and a failure went to console.error, so a rejected lock
     still read "Draw Result Locked" until the next reload. That is a bad way
     for any control to behave and a particularly bad one for this control —
     locking the draw is what `scheduleGate` requires before a schedule can be
     saved, so an organizer who believes they have locked it is sent back to
     the schedule page to be told, again, that they have not. */
  const toggleLockDraw = async () => {
    if (!division) return;
    const nextLocked = !isDrawLocked;
    const wasLocked = isDrawLocked;
    const wasRound2Tab = round2Tab;
    setLockError(null);
    setLockedByDiv(prev => ({ ...prev, [activeDiv]: nextLocked }));
    setRound1Tab(nextLocked ? 'standings' : 'config');
    /* The knockout's config tab is about to disappear, so anyone standing on
       it is moved to the bracket. Only on the way in: unlocking puts the tab
       back and the organizer can choose it, where jumping them there would
       move a pool-play division's view for a reason that has nothing to do
       with its own crossing settings. */
    if (nextLocked) setRound2Tab('bracket');
    try {
      const res = await fetch(`/api/tournaments/${slug}/divisions/${division.id}/draw`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: nextLocked }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Could not ${nextLocked ? 'lock' : 'unlock'} the draw (${res.status})`);
      }
      await load(division.id);
    } catch (err) {
      setLockedByDiv(prev => ({ ...prev, [activeDiv]: wasLocked }));
      setRound1Tab(wasLocked ? 'standings' : 'config');
      // The config tab is coming back, so put the organizer back on it if that
      // is where the lock took them from. A refused lock should leave no trace.
      setRound2Tab(wasRound2Tab);
      setLockError(err instanceof Error ? err.message : 'Could not change the draw lock');
    }
  };

  /* Does this division have a schedule to lose? Counted from the bracket the
     page already holds, so unlocking can say so before anything is at risk —
     the exact, authoritative numbers come from the server at the confirm. */
  const placedMatchCount = useMemo(() => {
    if (!division) return 0;
    return division.bracket.reduce(
      (n, r) => n + r.matches.filter(m => m.court && m.time).length,
      0,
    );
  }, [division]);

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
    const db = dbBracket(division, labelDivisionMatches(division));
    if (db) return db;
    // Before a draw exists: with a preceding round robin, project from the
    // seeds; for pure single elimination show the full empty bracket sized
    // to the confirmed-team count. Either way the numbering carries on from
    // whatever pool matches are already drawn.
    const prefix = divisionPrefix(division.label);
    const poolMatches = division.bracket
      .filter(r => isGroupFormat(r.format))
      .reduce((sum, r) => sum + r.matches.length, 0);
    const isRR = division.bracket.some(r => isGroupFormat(r.format));
    return isRR
      ? projectBracket(seeds, prefix, poolMatches + 1)
      : emptyBracket(confirmedTeams.length, prefix, 1);
  }, [division, seeds, confirmedTeams]);

  const poolGroups = useMemo(() => {
    if (!division?.drawConfig) return [];
    const poolRound = division.bracket.find(r => isGroupFormat(r.format));
    if (!poolRound || poolRound.matches.length === 0) return [];
    return assignPools(confirmedTeams, division.drawConfig.pools).map(pool => ({ name: pool.name, teams: pool.items }));
  }, [division, confirmedTeams]);

  /* Standings: pool matches carry no explicit pool id, so teams are
     attributed to a pool via poolGroups (which mirrors the server's
     serpentine assignment) and results are tallied from completed
     round-robin matches. */
  const poolStandings = useMemo(() => {
    if (poolGroups.length === 0) return [];
    const poolRound = division?.bracket.find(r => isGroupFormat(r.format));
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

  /* A ranking has to come from results. Until a pool's matches are played every
     team in it sits on zero, so the standings sort is a no-op and the order
     left behind is the serpentine draw — which would render as a finishing
     order, #1 and #2 marked as advancing, purely from seeding. Each pool
     therefore reports whether it has anything real to rank yet. */
  const rankingPools = useMemo(
    () =>
      poolStandings.map(p => ({
        name: p.name,
        played: p.standings.some(s => s.played > 0),
        teams: p.standings.map(s => ({ id: s.teamId, name: s.name })),
      })),
    [poolStandings],
  );

  const hasPoolResults = rankingPools.some(p => p.played);

  /* What the advance count actually produces: a pool shorter than the count
     sends fewer, and a field that isn't a power of two is padded with byes —
     which go to the pool winners, as in a pure elimination draw. */
  const advancing = useMemo(() => {
    const teams = poolGroups.reduce((sum, p) => sum + Math.min(config.advance, p.teams.length), 0);
    let bracketSize = 2;
    while (bracketSize < teams) bracketSize *= 2;
    return { teams, bracketSize, byes: teams >= 2 ? bracketSize - teams : 0 };
  }, [poolGroups, config.advance]);

  // The Round 1 feature set (draw config, pool results) belongs to the
  // round-robin format; other formats get their own features later.
  const firstRoundFormat = division?.bracket[0]?.format ?? 'round-robin';
  const isRoundRobin = isGroupFormat(firstRoundFormat);

  const hasRoundRobin = useMemo(() => {
    return division?.bracket.some(r => isGroupFormat(r.format)) ?? false;
  }, [division]);

  const hasKnockout = useMemo(() => {
    return division?.bracket.some(r => isKnockoutFormat(r.format)) ?? false;
  }, [division]);

  const knockoutFormat = useMemo(() => {
    const r = division?.bracket.find(r => isKnockoutFormat(r.format));
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
  const totalCap = detail.divisions.reduce((sum, d) => sum + d.teams, 0);
  const isLive = detail.date === 'Today';

  const computeSingleStatus = (): { label: string; variant: 'live' | 'open' | 'highlight' | 'status' | 'outline' } => {
    if (!detail || detail.phase === PHASE.draft || !isPublic(detail.phase as Phase)) {
      return { label: 'Draft', variant: 'status' };
    }
    if (detail.phase === 3 || isLive) {
      return { label: 'Live', variant: 'live' };
    }
    if (detail.phase === 4) {
      return { label: 'Completed', variant: 'status' };
    }
    if (!division) {
      return { label: 'Announced', variant: 'highlight' };
    }
    const regState = divisionRegistrationState(
      {
        registrationOpens: division.registrationOpens || '',
        registrationCloses: division.registrationCloses || '',
      },
      new Date(),
    );
    if (regState === 'opens-soon') {
      return { label: 'Announced', variant: 'highlight' };
    }
    if (regState === 'closed') {
      return { label: 'Registration Closed', variant: 'status' };
    }
    if (division.teams > 0 && division.filled >= division.teams) {
      return { label: 'Waitlist Open', variant: 'highlight' };
    }
    return { label: 'Registration Open', variant: 'open' };
  };

  const statusBadge = computeSingleStatus();

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

  /* confirmDiscard is passed only by the confirm dialog, after the organizer
     has been shown what the rebuild costs. Every other caller runs without it
     and lets the server refuse. */
  const saveDraw = async (confirmDiscard = false) => {
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
          thirdPlace: config.thirdPlace,
          generate: true,
          ...(confirmDiscard ? { confirmDiscard: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const cost = readDiscardRefusal(res.status, body);
        if (cost) {
          // Nothing was written: ask, then come back through with the answer.
          setDiscard({ kind: 'draw', cost });
          return;
        }
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setDiscard(null);
      await load(division.id);
      setAnimDiv(division.id);
      setDrawTick(t => t + 1);
      setRound1Tab('result');
      setRound2Tab('bracket');
      setTimeout(() => {
        drawResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the draw');
    } finally {
      setSaving(false);
    }
  };

  /* Crossing config is its own action: the pools have already been drawn and
     stay untouched (no reseeding, no re-draw) — only the knockout bracket
     that hangs off them is rebuilt for the new advance/crossing settings. */
  const applyCrossing = async (confirmDiscard = false) => {
    if (!division || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/tournaments/${slug}/divisions/${division.id}/draw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'crossing',
          pools: config.pools,
          advance: config.advance,
          crossing: config.crossing,
          thirdPlace: config.thirdPlace,
          ...(confirmDiscard ? { confirmDiscard: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const cost = readDiscardRefusal(res.status, body);
        if (cost) {
          setDiscard({ kind: 'crossing', cost });
          return;
        }
        throw new Error(body?.error ?? `Apply failed (${res.status})`);
      }
      setDiscard(null);
      await load(division.id);
      setRound2Tab('bracket');
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply the crossing config');
    } finally {
      setApplying(false);
    }
  };

  /* The play-off for 3rd, added to or taken off a bracket that already exists.
     Its own action for the reason crossing is: the bracket has been drawn, and
     a division should not have to be redrawn — losing its seeding and every
     result on it — to change its mind about one match. The play-off is fed by
     the two beaten semifinalists and feeds nothing, so the server can add or
     drop it without touching a single other pairing.

     Before the draw there is nothing to apply to: the checkbox simply rides
     along with `saveDraw` and the round is built with the rest. */
  const applyThirdPlace = async (confirmDiscard = false) => {
    if (!division || applyingThird) return;
    setApplyingThird(true);
    setThirdError(null);
    try {
      const res = await fetch(`/api/tournaments/${slug}/divisions/${division.id}/draw`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'thirdPlace',
          thirdPlace: config.thirdPlace,
          ...(confirmDiscard ? { confirmDiscard: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const cost = readDiscardRefusal(res.status, body);
        if (cost) {
          setDiscard({ kind: 'thirdPlace', cost });
          return;
        }
        throw new Error(body?.error ?? `Apply failed (${res.status})`);
      }
      setDiscard(null);
      await load(division.id);
      setRound2Tab('bracket');
    } catch (err) {
      setThirdError(err instanceof Error ? err.message : 'Failed to apply the play-off setting');
    } finally {
      setApplyingThird(false);
    }
  };

  const perPool = Math.max(1, Math.round(confirmedTeams.length / config.pools) || 1);
  const firstRoundMatches = bracket?.rounds[0]?.matches.length ?? 0;
  const colHeight = Math.max(firstRoundMatches * 95, bracket?.thirdPlaceMatch ? 240 : 190);

  // Pure single-elimination summary (bracket padded to the next power of two).
  const seTeams = confirmedTeams.length;
  const seSize = seTeams >= 2 ? (() => { let s = 2; while (s < seTeams) s *= 2; return s; })() : 0;
  const seByes = seSize > 0 ? seSize - seTeams : 0;
  /* Four teams is the smallest draw with a play-off for 3rd in it. Three pads
     to a four-team bracket too, but one of its semifinals is then a bye — and
     a bye has no loser, so the play-off would be drawn from one team and an
     empty seat. */
  const seCanThirdPlace = seTeams >= 4;
  /* Whether the checkbox has moved away from what the drawn bracket actually
     has. Read off the division rather than tracked, so it cannot drift: after
     an apply the reload brings the new value back and this goes quiet again. */
  const seThirdPlaceDirty =
    !!bracket?.fromDb && seCanThirdPlace && config.thirdPlace !== !!division?.drawConfig?.thirdPlace;

  // Winners are emphasized only for real, completed matches (from the DB) —
  // never for projections.
  const rowClass = (row: ViewRow) => {
    const dimmed = row.name === 'BYE' || (row.lost && bracket?.fromDb);
    return `${styles.matchName} ${row.win && bracket?.fromDb ? styles.matchNameWin : ''} ${dimmed ? styles.matchNameLost : ''} ${row.live ? styles.matchNameLive : ''}`;
  };

  // A slot with nothing to say yet is left blank rather than reading "TBD".
  const rowDisplay = (row: ViewRow) => (row.name === 'TBD' ? '' : row.name);

  return (
    <div className={styles.page}>
      <Link
        href="/dashboard"
        className={`${styles.backLink} ${backHidden ? styles.backLinkHidden : ''}`}
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </Link>

      {/* ── Top Header & Tournament Header Card ──────────────────── */}
      <div className={styles.headerContainer}>
        {/* Mobile View (Header & Event Card) */}
        <div className={styles.mobileOnly}>
          <div className={styles.headerArea}>
            <Link href="/dashboard" className={styles.mobileBackBtn} aria-label="Back to Dashboard">
              <ArrowLeft size={18} />
            </Link>
            <h1 className={styles.title}>Bracket Generator</h1>
          </div>
          <div className={styles.mobileEventCard}>
            <div className={styles.mobileEventBody}>
              <div className={styles.mobileEventTitle}>{detail.title || 'Untitled tournament'}</div>
              <div className={styles.mobileEventMeta}>
                <Calendar size={13} />
                <span>{detail.date}</span>
              </div>
              {detail.location && (
                <div className={styles.mobileEventMeta}>
                  <MapPin size={13} />
                  <span>{detail.location}</span>
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop View (Header, Card, Division Cards) */}
        <div className={styles.desktopOnly}>
          <div className={styles.setupHeaderRow}>
            <div>
              <p className={styles.setupEyebrow}>ORGANIZER</p>
              <h1 className={styles.desktop2aTitle}>Bracket Generator</h1>
            </div>
          </div>

          <Card padding={0} radius="xl" className={styles.desktop2aHeaderCard}>
            <div className={styles.desktop2aHeaderCardBody}>
              {detail.imageUrl ? (
                <img src={detail.imageUrl} alt="" className={styles.desktop2aPoster} />
              ) : (
                <div className={styles.desktop2aPosterPlaceholder}>
                  <ImagePlus size={28} opacity={0.6} />
                </div>
              )}

              <div className={styles.desktop2aHeaderTextCol}>
                <div className={styles.desktop2aBadgeRow}>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>

                <h2 className={styles.desktop2aEventTitle}>{detail.title || 'Untitled tournament'}</h2>

                <div className={styles.desktop2aMetaCol}>
                  <div className={styles.desktop2aMetaItem}>
                    <Icon name="calendar" size={16} />
                    <span>{detail.date}</span>
                  </div>
                  {detail.location && (
                    <div className={styles.desktop2aMetaItem}>
                      <Icon name="location" size={16} />
                      <span>{detail.location}</span>
                    </div>
                  )}
                </div>
              </div>

              {totalCap > 0 && (
                <div className={styles.headerSeats}>
                  <p className={styles.headerSeatsValue}>{totalTeams}/{totalCap}</p>
                  <p className={styles.headerSeatsLabel}>
                    seats filled across {detail.divisions.length} division{detail.divisions.length === 1 ? '' : 's'}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Sticky Division Bar (Desktop & Mobile) ──────────────────── */}
      {detail.divisions.length > 0 && (
        <div className={styles.stickyDivisionBar}>
          <div className={styles.stickyDivisionInner}>
            <div className={styles.segmentedControl}>
              {detail.divisions.map(d => {
                const isActive = d.id === activeDiv;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`${styles.segBtn} ${isActive ? styles.segBtnActive : ''}`}
                    onClick={(e) => {
                      handleSelectDivision(d.id);
                      setPendingSeed(null);
                      setSaveError(null);
                      const btn = e.currentTarget;
                      const container = btn.parentElement;
                      if (container) {
                        const btnLeft = btn.offsetLeft;
                        const btnWidth = btn.offsetWidth;
                        const containerWidth = container.offsetWidth;
                        container.scrollTo({
                          left: btnLeft - containerWidth / 2 + btnWidth / 2,
                          behavior: 'smooth',
                        });
                      }
                    }}
                    aria-pressed={isActive}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="dashboard-division-pill"
                        className={styles.segBtnActivePill}
                        transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                      />
                    )}
                    <span className={styles.segBtnLabel}>{d.label}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.stickyDivisionActions}>
              <Link
                href={`/dashboard/tournament/${detail.slug}/setup`}
                className={styles.setupLinkBtn}
                style={{ textDecoration: 'none' }}
                aria-label="Tournament setup"
                title="Tournament setup"
              >
                <Settings size={16} />
                <span className={styles.setupBtnText}>Setup</span>
              </Link>
              <Link
                href={`/dashboard/tournament/${detail.slug}/schedule`}
                className={styles.scheduleLinkBtn}
                style={{ textDecoration: 'none' }}
                aria-label="Schedule"
              >
                <Calendar size={16} />
                <span className={styles.scheduleBtnText}>Schedule</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      <main className={styles.main}>
        <div className={styles.sliderOverflowWrap}>
          <AnimatePresence mode="wait" initial={false} custom={divDirection}>
            <motion.div
              key={activeDiv}
              custom={divDirection}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className={styles.animatedContentWrap}
            >
        {/* ── Registered teams ───────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.iconHeader}>
                <Users size={22} />
              </div>
              <div>
                <h2 className={styles.sectionTitle}>Registered Teams</h2>
                <p className={styles.sectionSub}>
                  {division?.label ?? 'Division'} · {confirmedTeams.length} teams confirmed
                </p>
              </div>
            </div>
          </div>
          <div className={styles.teamsWrap}>
            {confirmedTeams.length > 0 ? (
              <div className={styles.teamsGrid}>
                {confirmedTeams.map(team => {
                  const parsedNames = parseTeamPlayers(team.name);
                  const playerItems = (team as any).players && (team as any).players.length > 0
                    ? (team as any).players
                    : parsedNames.map((n, idx) => ({
                        id: `${team.id}-${idx}`,
                        name: n,
                        userId: null,
                      }));

                  return (
                    <div
                      key={team.id}
                      className={`${styles.teamCard} ${team.status === 'waitlist' ? styles.teamCardMuted : ''}`}
                    >
                      <div className={styles.teamCardHeader}>
                        <div className={styles.teamPlayersList}>
                          {playerItems.map((player: { id: string; name: string; userId?: string | null }, idx: number) => {
                            const avatarKey = player.userId || (idx === 0 && team.registeredBy ? team.registeredBy : undefined);
                            const avatarUrl = avatarKey ? playerAvatars[avatarKey] : undefined;
                            return (
                              <div key={player.id || idx} className={styles.teamPlayerRow}>
                                <PlayerAvatar name={player.name} avatarUrl={avatarUrl} />
                                <span className={styles.teamPlayerName}>{player.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyNote}>No teams registered in this division yet.</div>
            )}
          </div>
        </section>

        {/* ── Round 1: pool play ─────────────────────────────── */}
        {hasRoundRobin && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitleRow}>
                <div className={styles.roundBadge}>R1</div>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <span className={styles.roundPrefix}>Round 1</span>
                    <span className={styles.roundDot}>·</span>
                    <span className={styles.roundFormat}>
                      {roundFormatLabel(firstRoundFormat)}
                    </span>
                  </h2>
                </div>
              </div>
              <div className={styles.headBtns}>
                <div className={styles.tabUnderlineGroup}>
                  {isRoundRobin && !isDrawLocked && (
                    <button
                      type="button"
                      className={`${styles.tabUnderlineBtn} ${round1Tab === 'config' ? styles.tabUnderlineBtnActive : ''}`}
                      onClick={() => handleSelectRound1Tab('config')}
                    >
                      {round1Tab === 'config' && (
                        <motion.span
                          layoutId="r1-tab-underline"
                          className={styles.tabUnderlineIndicator}
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span>Draw Config</span>
                    </button>
                  )}
                  {isRoundRobin && (
                    <button
                      type="button"
                      className={`${styles.tabUnderlineBtn} ${round1Tab === 'result' ? styles.tabUnderlineBtnActive : ''}`}
                      onClick={() => handleSelectRound1Tab('result')}
                    >
                      {round1Tab === 'result' && (
                        <motion.span
                          layoutId="r1-tab-underline"
                          className={styles.tabUnderlineIndicator}
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span>Draw Result</span>
                    </button>
                  )}
                  {isRoundRobin && (
                    <button
                      type="button"
                      className={`${styles.tabUnderlineBtn} ${round1Tab === 'standings' ? styles.tabUnderlineBtnActive : ''}`}
                      onClick={() => handleSelectRound1Tab('standings')}
                    >
                      {round1Tab === 'standings' && (
                        <motion.span
                          layoutId="r1-tab-underline"
                          className={styles.tabUnderlineIndicator}
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span>Standing Table</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className={styles.roundWrap}>
            {isRoundRobin ? (
              <div className={styles.sliderOverflowWrap}>
                <AnimatePresence mode="wait" initial={false} custom={r1TabDirection}>
                  <motion.div
                    key={round1Tab}
                    custom={r1TabDirection}
                    variants={cardVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className={styles.animatedContentWrap}
                  >
            <>
            {round1Tab === 'config' && !isDrawLocked && (
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
                      aria-label="Toggle seed dropdown"
                      disabled={unseededTeams.length === 0}
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
                    onClick={() => saveDraw()}
                    style={{ height: 60, fontSize: 16 }}
                  >
                    Draw Pool
                  </Button>
                  {saveError && <p className={styles.saveError}>{saveError}</p>}
                </div>
              </div>
            </div>
            )}

            {round1Tab === 'result' && (
              <div ref={drawResultRef} className={styles.poolsWrap}>
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
                {lockError && <p className={styles.saveError}>{lockError}</p>}
                {/* Unlocking destroys nothing by itself — it only opens the
                    Draw Config tab, from which redrawing does. Said once, here,
                    rather than as a second dialog nobody reads. */}
                {!isDrawLocked && placedMatchCount > 0 && (
                  <p className={styles.scheduleAtRiskNote}>
                    This division has a saved schedule ({placedMatchCount} match
                    {placedMatchCount === 1 ? '' : 'es'} placed). Redrawing discards it.
                  </p>
                )}
                {poolGroups.length === 0 ? (
                  <div className={styles.emptyNote}>
                    No pool draw generated yet. Use the Draw Config tab to create your pool draw.
                  </div>
                ) : (
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
                        {pool.teams.map(t => {
                          const display = formatTeamFirstName(t.name);
                          const parts = display.split('/');
                          return (
                            <div
                              key={t.id}
                              className={`${styles.poolTeamRow} ${poolAnim ? styles.poolTeamAnim : ''}`}
                              style={poolAnim ? { animationDelay: `${poolAnim.teamDelay.get(t.id) ?? 0}s` } : undefined}
                              title={t.name}
                            >
                              {parts.length > 1 ? (
                                <div className={styles.stackedTeamNames}>
                                  <span className={styles.stackedPlayer}>{parts[0]}</span>
                                  <span className={styles.stackedPlayer}>{parts[1]}</span>
                                </div>
                              ) : (
                                <span className={styles.singleTeamName}>{display}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {round1Tab === 'standings' && (
              <div className={styles.poolsWrap}>
                <div className={styles.poolsHead}>
                  <div className={styles.poolsHeadLeft}>
                    <h3 className={styles.cardTitle}>Standing Table</h3>
                  </div>
                </div>
                {poolStandings.length === 0 ? (
                  <div className={styles.emptyNote}>
                    No standing tables yet. Rankings and tables appear once pools are drawn and matches are scored.
                  </div>
                ) : (
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
                          {pool.standings.map((s, i) => {
                            const display = formatTeamFirstName(s.name);
                            const parts = display.split('/');
                            return (
                              <tr key={s.teamId}>
                                <td>{i + 1}</td>
                                <td className={styles.standingsTeam} title={s.name}>
                                  {parts.length > 1 ? (
                                    <div className={styles.stackedTeamNames}>
                                      <span className={styles.stackedPlayer}>{parts[0]}</span>
                                      <span className={styles.stackedPlayer}>{parts[1]}</span>
                                    </div>
                                  ) : (
                                    <span className={styles.singleTeamName}>{display}</span>
                                  )}
                                </td>
                                <td>{s.wins}</td>
                                <td>{s.losses}</td>
                                <td>{s.pointsFor - s.pointsAgainst > 0 ? '+' : ''}{s.pointsFor - s.pointsAgainst}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}
            </>
                  </motion.div>
                </AnimatePresence>
              </div>
            ) : (
              <div className={styles.emptyNote}>
                {roundFormatLabel(firstRoundFormat)} features for this round are coming soon.
              </div>
            )}
            </div>
          </section>
        )}

        {/* ── Round 2: single elimination ────────────────────── */}
        {hasKnockout && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitleRow}>
                <div className={styles.roundBadge}>{hasRoundRobin ? 'R2' : 'R1'}</div>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <span className={styles.roundPrefix}>{hasRoundRobin ? 'Round 2' : 'Round 1'}</span>
                    <span className={styles.roundDot}>·</span>
                    <span className={styles.roundFormat}>
                      {roundFormatLabel(knockoutFormat)}
                    </span>
                  </h2>
                </div>
              </div>
              <div className={styles.headBtns}>
                <div className={styles.tabUnderlineGroup}>
                  {!isDrawLocked && (
                    <button
                      type="button"
                      className={`${styles.tabUnderlineBtn} ${round2Tab === 'config' ? styles.tabUnderlineBtnActive : ''}`}
                      onClick={() => handleSelectRound2Tab('config')}
                    >
                      {round2Tab === 'config' && (
                        <motion.span
                          layoutId="r2-tab-underline"
                          className={styles.tabUnderlineIndicator}
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span>Bracket Config</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${styles.tabUnderlineBtn} ${round2Tab === 'bracket' ? styles.tabUnderlineBtnActive : ''}`}
                    onClick={() => handleSelectRound2Tab('bracket')}
                  >
                    {round2Tab === 'bracket' && (
                      <motion.span
                        layoutId="r2-tab-underline"
                        className={styles.tabUnderlineIndicator}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span>Bracket</span>
                  </button>
                </div>
              </div>
            </div>
            <div className={styles.roundWrap}>
              <div className={styles.sliderOverflowWrap}>
                <AnimatePresence mode="wait" initial={false} custom={r2TabDirection}>
                  <motion.div
                    key={round2Tab}
                    custom={r2TabDirection}
                    variants={cardVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className={styles.animatedContentWrap}
                  >
            {round2Tab === 'config' && !isDrawLocked && (
              <>
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

                      {/* The play-off for 3rd. Pool-play divisions have always
                          had this, on the crossing card; a pure knockout had
                          nowhere to ask for it, so the flag `saveDraw` already
                          sends was permanently false.

                          Disabled rather than hidden below four teams: the
                          option existing and saying why it cannot be used yet
                          is more use to an organizer mid-registration than an
                          option that quietly appears later. */}
                      <label
                        className={styles.checkboxCard}
                        style={{
                          marginTop: 16,
                          ...(seCanThirdPlace ? {} : { opacity: 0.55, cursor: 'not-allowed' }),
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={config.thirdPlace && seCanThirdPlace}
                          disabled={!seCanThirdPlace}
                          onChange={e => setConfig({ thirdPlace: e.target.checked })}
                          className={styles.checkboxInput}
                        />
                        <div className={styles.checkboxTextCol}>
                          <span className={styles.checkboxTitle}>Play off for 3rd place</span>
                          <span className={styles.checkboxSubtitle}>
                            {seCanThirdPlace
                              ? 'Adds a match between the two beaten semifinalists.'
                              : 'Needs at least 4 teams — a smaller draw has no semifinal to take the two beaten teams from.'}
                          </span>
                        </div>
                      </label>

                      {/* Only once there is a bracket to change. Before the
                          draw the checkbox rides along with it and this would
                          be a second button for the same thing. */}
                      {seThirdPlaceDirty && (
                        <div className={styles.drawBtnWrap} style={{ marginTop: 12 }}>
                          <Button
                            variant="secondary"
                            size="medium"
                            fullWidth
                            loading={applyingThird}
                            onClick={() => applyThirdPlace()}
                            style={{ height: 44, borderRadius: 999 }}
                          >
                            {config.thirdPlace ? 'Add 3rd-place play-off' : 'Remove 3rd-place play-off'}
                          </Button>
                          <p className={styles.fieldNote} style={{ marginTop: 8, textAlign: 'center' }}>
                            Changes only this match. The rest of the bracket, and any results on it, stay as they are.
                          </p>
                          {thirdError && <p className={styles.saveError}>{thirdError}</p>}
                        </div>
                      )}

                      <div className={styles.drawBtnWrap}>
                        <Button
                          variant="primary"
                          size="medium"
                          fullWidth
                          loading={saving}
                          disabled={confirmedTeams.length < 2}
                          onClick={() => saveDraw()}
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
                    <div className={styles.crossingCard}>
                      <h3 className={styles.cardTitle}>Bracket Crossing Settings</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                          <label className={styles.fieldLabel}>Teams Advancing per Pool</label>
                          <div className={styles.infoSpecBox}>
                            <div className={styles.infoSpecRow}>
                              <span className={styles.infoSpecTitle}>Top {config.advance} from each pool</span>
                              <span className={styles.infoSpecPill}>{advancing.teams} teams advance</span>
                            </div>
                            <span className={styles.infoSpecDesc}>
                              {advancing.bracketSize}-team bracket{advancing.byes > 0 ? ` · ${advancing.byes} ${advancing.byes === 1 ? 'bye' : 'byes'}` : ''}
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className={styles.fieldLabel}>Bracket Crossing Logic</label>
                          <div className={styles.infoSpecBox}>
                            <span className={styles.infoSpecTitle}>
                              {config.crossing === 'static' ? 'Static Cross-Bracket (A1–D4)' : 'FIVB Standard Crossing'}
                            </span>
                            <span className={styles.infoSpecDesc}>
                              Determines how pool winners &amp; runners-up seed into the knockout round.
                            </span>
                          </div>
                        </div>

                        <label className={styles.checkboxCard}>
                          <input
                            type="checkbox"
                            checked={config.thirdPlace}
                            onChange={e => setConfig({ thirdPlace: e.target.checked })}
                            className={styles.checkboxInput}
                          />
                          <div className={styles.checkboxTextCol}>
                            <span className={styles.checkboxTitle}>Play off for 3rd place</span>
                            <span className={styles.checkboxSubtitle}>
                              Adds a match between the two beaten semifinalists before the final.
                            </span>
                          </div>
                        </label>

                        <div className={styles.drawBtnWrap} style={{ marginTop: 4 }}>
                          <Button
                            variant="primary"
                            size="medium"
                            fullWidth
                            loading={applying}
                            onClick={() => applyCrossing()}
                            style={{ height: 48, borderRadius: 999 }}
                          >
                            Apply Crossing Config
                          </Button>
                          {applyError && <p className={styles.saveError}>{applyError}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Right Pane: Pool Rankings */}
                    <div className={styles.poolRankingsCard}>
                      <h3 className={styles.cardTitle}>Pool Rankings</h3>
                      {!hasPoolResults ? (
                        <div className={styles.emptyDashedNote}>
                          No pool results yet. Rankings appear here once matches have been played — until then
                          there is nothing to rank, only the draw.
                        </div>
                      ) : (
                      <div className={styles.poolsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                        {rankingPools.map(pool => (
                          <div key={pool.name} className={styles.poolCard} style={{ border: '1px solid var(--sand-300, #EAE5DD)', borderRadius: 12, padding: 14, backgroundColor: 'var(--surface-card, #ffffff)' }}>
                            <div className={styles.poolCardHeader} style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className={styles.poolBadge} style={{ fontWeight: 800 }}>{pool.name}</span>
                              <span className={styles.poolCardCount} style={{ fontSize: 12, color: 'var(--ink-500)' }}>{pool.teams.length} teams</span>
                            </div>
                            <div className={styles.poolTeamList} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {pool.teams.map((t, idx) => {
                                // This pool has played nothing yet, so it has no order to show —
                                // list its teams flat rather than implying a finishing position.
                                const isAdvancing = pool.played && idx < config.advance;
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
                                      {pool.played ? `#${idx + 1}` : '–'}
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
                                      {formatTeamFirstName(t.name)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {!pool.played && (
                              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--ink-500)' }}>
                                Awaiting results
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {round2Tab === 'bracket' && (
              <>
                {/* Locking the draw, for a division that has no pool round.
                    The flag is one per division and pool play already offers it
                    on its Draw Result panel — but that panel lives inside the
                    Round 1 section, which a pure knockout does not have. So the
                    only control was unreachable for exactly the divisions that
                    still need it: `scheduleGate` refuses to save a schedule
                    until every division's draw is locked, and the schedule page
                    sends the organizer to "the bracket page", which had no
                    button. A single-elimination tournament could not save a
                    schedule at all.

                    Only when there is a drawn bracket to lock: locking a
                    projection would satisfy the schedule gate for a division
                    that has no matches in it yet. */}
                {!hasRoundRobin && bracket?.fromDb && (
                  <div className={styles.poolsHead} style={{ marginBottom: 16 }}>
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
                )}
                {!hasRoundRobin && lockError && (
                  <p className={styles.saveError} style={{ marginBottom: 16 }}>{lockError}</p>
                )}
                {/* The same warning pool play gives: unlocking destroys nothing
                    by itself, redrawing from the config tab does. */}
                {!hasRoundRobin && bracket?.fromDb && !isDrawLocked && placedMatchCount > 0 && (
                  <p className={styles.scheduleAtRiskNote} style={{ marginBottom: 16 }}>
                    This division has a saved schedule ({placedMatchCount} match
                    {placedMatchCount === 1 ? '' : 'es'} placed). Redrawing discards it.
                  </p>
                )}
                {bracket ? (
                  <div className={styles.bracketScroll}>
                    <div className={styles.bracketRow}>
                      {bracket.rounds.map((round, ri) => (
                        <div key={round.name} className={styles.roundCol}>
                          <div className={styles.roundName}>{round.name}</div>
                          <div className={styles.roundMatches} style={{ height: colHeight }}>
                            {round.matches.map((m, mi) => {
                              // Round-1 names reveal one at a time on a re-draw.
                              const revealA = bracketAnim?.nameDelay.get(`${ri}-${mi}-A`);
                              const revealB = bracketAnim?.nameDelay.get(`${ri}-${mi}-B`);
                              return (
                                <div key={mi} className={styles.matchSlot}>
                                  <div className={styles.matchCard}>
                                  <span className={styles.matchNo}>{m.no}</span>
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
                                      {rowDisplay(m.rowA)}
                                    </span>
                                  </div>
                                  <div className={styles.matchDivider} />
                                  <div className={styles.matchRow}>
                                    <span
                                      className={`${rowClass(m.rowB)} ${revealB !== undefined ? styles.nameReveal : ''}`}
                                      style={revealB !== undefined ? { animationDelay: `${revealB}s` } : undefined}
                                    >
                                      {rowDisplay(m.rowB)}
                                    </span>
                                  </div>
                                </div>
                                {m.hasRight && <div className={styles.connRight} />}
                                {m.hasSpine && <div className={styles.connSpine} />}
                                </div>
                              );
                            })}

                            {ri === bracket.rounds.length - 1 && bracket.thirdPlaceMatch && (
                              <div className={styles.thirdPlaceBlock}>
                                <div className={styles.thirdPlaceLabel}>3rd Place</div>
                                <div className={styles.matchCard}>
                                  <span className={styles.matchNo}>{bracket.thirdPlaceMatch.no}</span>
                                  {bracket.thirdPlaceMatch.live && (
                                    <div className={styles.matchLiveRow}>
                                      <span className={styles.liveTag}>
                                        <span className={styles.liveTagDot} aria-hidden="true" />
                                        Live
                                      </span>
                                    </div>
                                  )}
                                  <div className={styles.matchRow}>
                                    <span className={rowClass(bracket.thirdPlaceMatch.rowA)}>
                                      {rowDisplay(bracket.thirdPlaceMatch.rowA)}
                                    </span>
                                  </div>
                                  <div className={styles.matchDivider} />
                                  <div className={styles.matchRow}>
                                    <span className={rowClass(bracket.thirdPlaceMatch.rowB)}>
                                      {rowDisplay(bracket.thirdPlaceMatch.rowB)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyNote}>
                    The bracket will appear here once at least two teams are registered.
                  </div>
                )}
              </>
            )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </section>
        )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ── DISCARD-A-SCHEDULE CONFIRM ─────────────────────────────────
          The draw route refuses a rebuild that would destroy placements and
          hands back what it counted; this is where that count is spent. The
          organizer is never refused outright — only never allowed to destroy
          work without being told, in numbers, what the work was.

          There is no undo behind this: a placement is columns on the match
          row, and rebuilding the rounds deletes the rows. Saying so plainly
          is the honest thing, and it is what earns the one click. */}
      {discard && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Discard saved schedule">
          <div className={styles.confirmDialog}>
            <h3 className={styles.confirmTitle}>
              {discard.kind === 'draw'
                ? 'Redraw and discard the schedule?'
                : discard.kind === 'thirdPlace'
                  ? 'Remove the play-off and discard its schedule?'
                  : 'Rebuild the bracket and discard its schedule?'}
            </h3>
            <p className={styles.confirmBody}>
              {discard.kind === 'draw' ? (
                <>
                  Redrawing <strong>{division?.label}</strong> rebuilds every match in it from
                  scratch, so its saved schedule goes with them —{' '}
                  <strong>{describeDiscardCost(discard.cost)}</strong>.
                </>
              ) : discard.kind === 'thirdPlace' ? (
                <>
                  Taking the play-off for 3rd off <strong>{division?.label}</strong> deletes that
                  match, so what was scheduled on it goes too —{' '}
                  <strong>{describeDiscardCost(discard.cost)}</strong>. The rest of the bracket
                  keeps its times and courts.
                </>
              ) : (
                <>
                  Applying a new crossing rebuilds <strong>{division?.label}</strong>&rsquo;s knockout
                  matches, so their saved schedule goes with them —{' '}
                  <strong>{describeDiscardCost(discard.cost)}</strong>. Pool play keeps its times and courts.
                </>
              )}{' '}
              This cannot be undone.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.btnGhost} onClick={() => setDiscard(null)}>
                Keep the schedule
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={saving || applying || applyingThird}
                onClick={() => {
                  const kind = discard.kind;
                  setDiscard(null);
                  if (kind === 'draw') saveDraw(true);
                  else if (kind === 'thirdPlace') applyThirdPlace(true);
                  else applyCrossing(true);
                }}
              >
                {saving || applying || applyingThird
                  ? 'Working…'
                  : discard.kind === 'draw'
                    ? 'Redraw anyway'
                    : discard.kind === 'thirdPlace'
                      ? 'Remove anyway'
                      : 'Rebuild anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function parseTeamPlayers(name: string): string[] {
  const parts = name.split('/').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [name];
}

function PlayerAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  const words = name.trim().split(/\s+/).filter(Boolean);
  const initial = words.length > 1
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (name.trim()[0]?.toUpperCase() || '?');

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={styles.playerAvatarImg}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={styles.playerAvatar} aria-hidden="true">
      <span>{initial}</span>
    </div>
  );
}
