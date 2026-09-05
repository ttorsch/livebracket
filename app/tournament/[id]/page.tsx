'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { MapPin, Calendar, Users, Clock, Share2, Check } from 'lucide-react';
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
import { roundFormatLabel, isGroupFormat, isKnockoutFormat, isForfeitMatch, STANDING_POINTS } from '@/lib/roundFormat';
import { calculatePoolStandings } from '@/lib/standings';
import {
  getTournamentDetail, type TournamentDetail, type DetailMatch,
  type DetailDivision,
} from '../../../lib/data';
import { isThirdPlaceRound, assignPools } from '../../../lib/divisionMatches';
import { fetchLiveScores, applyLiveScores, type LiveScoreMap } from '../../../lib/liveScores';
import { registrationState, nextOpening, isPublic, isTournamentLiveDate, hasTournamentStarted, type Phase } from '../../../lib/tournamentLifecycle';
import { tournamentStatus } from '../../../lib/tournamentStatus';
import { Badge } from '../../../components/livebracket-ds';
import { ageLimitLabel } from '../../../lib/divisionEligibility';
import { useSignInHref, saveScrollPosition, useRestoreScrollPosition } from '../../../components/auth/useSignInHref';
import { useSession } from '../../../components/auth/AuthProvider';
import AccountButton from '../../../components/auth/AccountButton';
import CourtScheduleView from '../../../components/schedule/CourtScheduleView';
import PlayerCardModal, { type PlayerCardTarget } from '../../../components/PlayerCardModal';
import { useTabSwipe } from '../../../hooks/useTabSwipe';

type NavMode = 'top' | 'shown' | 'hidden';
const NAV_SCROLL_DELTA = 10;
const NAV_IDLE_HIDE_MS = 2400;
const NAV_TOP_EPSILON = 8;

// Spectators are watching a match happen; the page has to keep up.
const LIVE_POLL_MS = 15000;

/* A bracket card plus the breathing room under it. Cards are a fixed two
   rows, so this holds unless a very long name wraps — then the column grows
   and takes its slots with it. */
const BRACKET_SLOT_H = 126;

/* Dates are read in UTC everywhere in this app — a browser west of Greenwich
   would otherwise show a deadline a day early. */
function formatDay(d: Date): string {
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatCloseDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return formatDay(new Date(Date.UTC(y, m - 1, d)));
}

/* Centre a chip inside its own horizontal rail.
 *
 * scrollIntoView would do this too, but `block: 'nearest'` also scrolls the
 * *page* to reveal the rail — on first load that drags the reader straight
 * past the hero to the tab bar. Scrolling the rail itself moves nothing
 * else. */
function centerInRail(el: HTMLElement | null) {
  const rail = el?.parentElement;
  if (!el || !rail) return;
  const railRect = rail.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const delta = (elRect.left + elRect.width / 2) - (railRect.left + railRect.width / 2);
  if (Math.abs(delta) < 1) return;
  rail.scrollBy({ left: delta, behavior: 'smooth' });
}

function getTitleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'T';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/* Labels and the group/knockout question both come from lib/roundFormat,
   which is keyed to the values rounds.format actually holds. The map that
   used to live here was keyed 'single-elim'/'double-elim' — values the
   schema does not allow — so every knockout round fell through to its raw
   column value and displayed as "single". */

/* ── Standings, tallied from the matches themselves ───────────────
 *
 * Nothing in the database stores a table: the rows below are counted off
 * the finished matches in the group rounds. Match points are 3 for a win,
 * which is the rule this app applies — the organizer's own scoring settings
 * cover sets and points within a match, not how a pool is ranked. */
interface StandingRow {
  teamId: string;
  team: string;
  wins: number;
  losses: number;
  byes: number;
  setsFor: number;
  setsAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
  points: number;
}

interface PoolStandingGroup {
  name: string;
  rows: StandingRow[];
}

function buildPoolStandings(division: DetailDivision): PoolStandingGroup[] {
  const poolsCount = Math.max(1, division.drawConfig?.pools ?? 1);
  const confirmedTeams = division.teamsList.filter(t => t.status !== 'waitlist');
  const pools = assignPools(confirmedTeams, poolsCount);

  // Collect all group matches
  const groupMatches: DetailMatch[] = [];
  for (const round of division.bracket) {
    if (!isGroupFormat(round.format)) continue;
    groupMatches.push(...round.matches);
  }

  return pools.map(p => {
    const poolTeamIds = new Set(p.items.map(t => t.id));
    const poolTeams = p.items.map((t, idx) => ({
      id: t.id,
      name: t.name,
      seed: t.seed,
      entryOrder: confirmedTeams.findIndex(ct => ct.id === t.id),
    }));

    const poolMatches = groupMatches.filter(
      m => m.teamAId && m.teamBId && poolTeamIds.has(m.teamAId) && poolTeamIds.has(m.teamBId),
    );

    const rows = calculatePoolStandings(poolTeams, poolMatches);
    return { name: p.name, rows };
  });
}

function buildStandings(division: DetailDivision): StandingRow[] {
  const groups = buildPoolStandings(division);
  return groups.flatMap(g => g.rows);
}

/* ── One round, as the Format & Rules panel presents it ───────────── */
const CROSSING_LABEL: Record<string, string> = {
  fivb: 'FIVB standard crossing',
  static: 'Static cross-bracket',
};

interface RoundView {
  key: string;
  n: number;
  eyebrow: string;
  name: string;
  /* One tile per set that can be played: the regular sets, then the decider,
     which is scored differently and so gets its own tile. */
  sets: { label: string; points: string; note: string }[];
  facts: { label: string; value: string }[];
}

function buildRoundViews(division: DetailDivision, advanceCount: number): RoundView[] {
  const rounds = division.configuredRounds;
  /* Same rule as the advance count: the organizer's setup value is the
     definition, and a draw that has actually produced matches overrides it. */
  const drawn = division.bracket.some(r => r.matches.length > 0);
  const crossingKey = drawn && division.drawConfig ? division.drawConfig.crossing : division.crossing;
  const crossing = CROSSING_LABEL[crossingKey];

  return rounds.map((round, i) => {
    const s = round.scoring;
    const note = s.hardCap > 0 ? `hard cap ${s.hardCap}` : 'no hard cap';
    const isLast = i === rounds.length - 1;

    const sets: RoundView['sets'] = [];
    if (s.setsBestOf > 1) {
      for (let n = 1; n < s.setsBestOf; n++) {
        sets.push({ label: `Set ${n}`, points: String(s.pointsPerSet), note });
      }
      sets.push({ label: 'Deciding', points: String(s.decidingSetPoints), note });
    } else {
      sets.push({ label: 'Set 1', points: String(s.pointsPerSet), note });
    }

    const facts: RoundView['facts'] = [
      { label: 'Match', value: s.setsBestOf > 1 ? `Best of ${s.setsBestOf}` : '1 set' },
      { label: 'Hard cap', value: s.hardCap > 0 ? String(s.hardCap) : 'None' },
    ];

    // Advancing only applies to group / pool play stages
    if (isGroupFormat(round.format) && advanceCount > 0) {
      facts.push({ label: 'Advancing', value: `Top ${advanceCount} / pool` });
    }

    // Crossing describes how teams advance from round robin / pool play into the draw.
    if (isGroupFormat(round.format) && crossing) {
      facts.push({ label: 'Crossing', value: crossing });
    }

    return {
      key: `${i}-${round.format}`,
      n: i + 1,
      eyebrow: `Round ${i + 1}`,
      name: roundFormatLabel(round.format),
      sets,
      facts,
    };
  });
}

/* ── A court currently in play ───────────────────────────────────── */
interface LiveCourt {
  id: string;
  heading: string;      // "Open Men" — the card itself names the court
  setLabel: string;     // "Set 3"
  a: { name: string; sets: number[]; score: number; leading: boolean };
  b: { name: string; sets: number[]; score: number; leading: boolean };
  footnote: string;     // "Semifinal"
}

function toLiveCourt(divisionLabel: string, roundName: string, m: DetailMatch): LiveCourt {
  const setsA = m.scoreA ?? [];
  const setsB = m.scoreB ?? [];
  // applyLiveScores appends the set being played, so the last entry is the
  // score on court and everything before it is history.
  const currentA = setsA.length ? setsA[setsA.length - 1] : 0;
  const currentB = setsB.length ? setsB[setsB.length - 1] : 0;
  const doneA = setsA.slice(0, -1);
  const doneB = setsB.slice(0, -1);

  return {
    id: m.id,
    heading: divisionLabel,
    setLabel: `Set ${Math.max(1, setsA.length)}`,
    a: {
      name: m.teamAName ?? m.teamA.map(p => p.name).join(' / '),
      sets: doneA,
      score: currentA,
      leading: currentA >= currentB,
    },
    b: {
      name: m.teamBName ?? m.teamB.map(p => p.name).join(' / '),
      sets: doneB,
      score: currentB,
      leading: currentB > currentA,
    },
    footnote: roundName,
  };
}

/* ── One court on the day of the event ───────────────────────────── */
interface CourtCard {
  key: string;
  court: string;                       // "Court 1"
  live: LiveCourt | null;
  next: { time: string; where: string; teamA: string; teamB: string; match?: string } | null;
}

interface DivisionRoundTab {
  id: string;
  label: string;
  roundIndex: number;
  format: string;
  isGroup: boolean;
  isKnockout: boolean;
}

export default function TournamentPage() {
  const params = useParams();
  const slug = String(params.id);

  const [baseTournament, setBaseTournament] = useState<TournamentDetail | null>(null);
  const [liveScores, setLiveScores] = useState<LiveScoreMap>({});
  const [activeDiv, setActiveDiv] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('');

  const handleRestoreState = useCallback((state: { activeDiv?: string; activeTab?: string }) => {
    if (state.activeDiv) setActiveDiv(state.activeDiv);
    if (state.activeTab) setActiveTab(state.activeTab);
  }, []);

  /* The tab and division come back; the scroll position does not. This page
     opens on its hero every time, so the reader always gets the event's name
     and dates before anything else. */
  useRestoreScrollPosition(Boolean(baseTournament), handleRestoreState, { restoreScroll: false });

  useEffect(() => {
    getTournamentDetail(slug).then((data) => {
      setBaseTournament(data);
      if (data && data.divisions.length > 0) {
        setActiveDiv((prev) => prev || data.divisions[0].id);
      }
    }).catch(console.error);
  }, [slug]);

  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});
  /* The player whose card is open. Null closes it. */
  const [playerCard, setPlayerCard] = useState<PlayerCardTarget | null>(null);

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
    let cancelled = false;
    const load = () => {
      fetchLiveScores(slug).then(scores => { if (!cancelled) setLiveScores(scores); });
    };
    load();
    const timer = setInterval(load, LIVE_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [slug]);

  const tournament = useMemo(
    () => (baseTournament ? applyLiveScores(baseTournament, liveScores) : null),
    [baseTournament, liveScores],
  );

  const activeDivision = tournament?.divisions.find(d => d.id === activeDiv) ?? null;

  const [slideDirection, setSlideDirection] = useState<number>(0);

  const handleSelectDivision = (newId: string) => {
    if (newId === activeDiv || !tournament) return;
    const currentIndex = tournament.divisions.findIndex(d => d.id === activeDiv);
    const newIndex = tournament.divisions.findIndex(d => d.id === newId);
    if (currentIndex !== -1 && newIndex !== -1) {
      setSlideDirection(newIndex > currentIndex ? 1 : -1);
    }
    setActiveDiv(newId);
  };

  const handleSelectTab = (t: string) => {
    if (t === currentTab) return;
    const currentIndex = tabs.indexOf(currentTab);
    const newIndex = tabs.indexOf(t);
    if (currentIndex !== -1 && newIndex !== -1) {
      setSlideDirection(newIndex > currentIndex ? 1 : -1);
    }
    setActiveTab(t);
  };

  const regState = tournament ? registrationState(tournament.divisions) : null;

  /* Where this tournament is up to, from the one place that decides it. */
  const status = useMemo(
    () => tournamentStatus({
      cancelled: tournament?.cancelled,
      startDate: tournament?.startDate,
      endDate: tournament?.endDate,
      divisions: (tournament?.divisions ?? []).map(d => ({
        registrationOpens: d.registrationOpens,
        registrationCloses: d.registrationCloses,
        cap: d.teams,
        filled: d.filled,
      })),
    }),
    [tournament],
  );
  const opensAt = tournament ? nextOpening(tournament.divisions) : null;

  /* The soonest close date still ahead — what "open until" refers to when
     divisions close on different days. */
  const closesOn = useMemo(() => {
    const dates = (tournament?.divisions ?? [])
      .map(d => d.registrationCloses)
      .filter(Boolean)
      .sort();
    return dates[0] ?? '';
  }, [tournament]);

  const courtCount = useMemo(() => new Set(
    (tournament?.divisions ?? [])
      .flatMap(d => d.bracket.flatMap(r => r.matches.map(m => m.court)))
      .filter(Boolean),
  ).size, [tournament]);

  const poolStandings = useMemo(
    () => (activeDivision ? buildPoolStandings(activeDivision) : []),
    [activeDivision],
  );

  const divisionRounds = useMemo<DivisionRoundTab[]>(() => {
    if (!activeDivision) return [];
    if (activeDivision.configuredRounds && activeDivision.configuredRounds.length > 0) {
      return activeDivision.configuredRounds.map((r, i) => {
        const isGroup = isGroupFormat(r.format);
        const isKnockout = isKnockoutFormat(r.format);
        const label = `Round ${i + 1}`;
        return {
          id: label,
          label,
          roundIndex: i,
          format: r.format,
          isGroup,
          isKnockout,
        };
      });
    }

    const formats: string[] = [];
    for (const round of activeDivision.bracket) {
      if (formats.length === 0 || formats[formats.length - 1] !== round.format) {
        formats.push(round.format);
      }
    }
    if (formats.length === 0) {
      return [
        {
          id: 'Round 1',
          label: 'Round 1',
          roundIndex: 0,
          format: 'round-robin',
          isGroup: true,
          isKnockout: false,
        },
      ];
    }
    return formats.map((fmt, i) => ({
      id: `Round ${i + 1}`,
      label: `Round ${i + 1}`,
      roundIndex: i,
      format: fmt,
      isGroup: isGroupFormat(fmt),
      isKnockout: isKnockoutFormat(fmt),
    }));
  }, [activeDivision]);

  /* A configured elimination round exists in the rounds table before the draw
     has run, with no matches hanging off it — that is "not drawn yet", not a
     bracket, so it must not produce an empty column. */
  /* The organizer's setup value is the definition; a draw that has actually
     been run overrides it, because that is what the bracket was built from.
     "Run" is tested by the presence of matches, not by settings.draw existing
     — that key can be a stub with no advance recorded, whose defaulted 2
     would otherwise mask a real setup value. */
  const advanceCount = useMemo(() => {
    if (!activeDivision) return 2;
    const drawn = activeDivision.bracket.some(r => r.matches.length > 0);
    const draw = activeDivision.drawConfig;
    return drawn && draw && draw.advance > 0 ? draw.advance : activeDivision.advancePerPool;
  }, [activeDivision]);

  const roundViews = useMemo(
    () => (activeDivision ? buildRoundViews(activeDivision, advanceCount) : []),
    [activeDivision, advanceCount],
  );

  const knockoutRounds = useMemo(
    () => (activeDivision?.bracket ?? [])
      .filter(r => !isGroupFormat(r.format) && !(activeDivision && isThirdPlaceRound(activeDivision, r)) && r.matches.length > 0),
    [activeDivision],
  );

  const thirdPlaceRound = useMemo(
    () => (activeDivision ? (activeDivision.bracket ?? []).find(r => isThirdPlaceRound(activeDivision, r) && r.matches.length > 0) : undefined),
    [activeDivision],
  );

  /* One slot per match in the widest round, tall enough for a card and the
     gap under it. The tree is sized from that so every column divides into
     the same slots and the rounds line up with each other. */
  const bracketTreeHeight = useMemo(
    () => Math.max(1, ...knockoutRounds.map(r => r.matches.length)) * BRACKET_SLOT_H,
    [knockoutRounds],
  );

  /* From the first day on — a finished tournament counts as started, so the
     page keeps leading with play rather than falling back to the pre-event
     order once there are results to read. */
  const hasStarted = useMemo(
    () => hasTournamentStarted(tournament?.startDate),
    [tournament?.startDate],
  );

  const isLive = useMemo(
    () => isTournamentLiveDate(tournament?.startDate, tournament?.endDate),
    [tournament?.startDate, tournament?.endDate],
  );

  /* Every court in the schedule, on the day of the event: what is on it
     right now, or what is due on it next. The rail is about the tournament,
     not the selected division, and its length holds steady through the day
     so courts don't reshuffle under a reader mid-scroll. */
  const courtCards = useMemo<CourtCard[]>(() => {
    if (!isLive || !tournament) return [];

    const byCourt = new Map<string, CourtCard>();
    const soonest = new Map<string, string>();

    for (const d of tournament.divisions) {
      for (const round of d.bracket) {
        for (const m of round.matches) {
          const court = m.court?.trim();
          // A match with no court has no card to live in.
          if (!court) continue;

          let entry = byCourt.get(court);
          if (!entry) {
            entry = { key: court, court, live: null, next: null };
            byCourt.set(court, entry);
          }

          if (m.status === 'live') {
            // Two matches live on one court shouldn't happen; the first wins.
            entry.live = entry.live ?? toLiveCourt(d.label, round.round, m);
          } else if (m.status === 'upcoming') {
            const sortKey = `${m.scheduledDate ?? '9999-99-99'} ${m.time || '99:99'}`;
            const prev = soonest.get(court);
            if (prev === undefined || sortKey < prev) {
              soonest.set(court, sortKey);
              const teamAName = m.teamAName ?? (m.teamA && m.teamA.length > 0 ? m.teamA.map(p => p.name).join(' / ') : 'TBD');
              const teamBName = m.teamBName ?? (m.teamB && m.teamB.length > 0 ? m.teamB.map(p => p.name).join(' / ') : 'TBD');
              entry.next = {
                time: m.time,
                where: [d.label, round.round].filter(Boolean).join(' · '),
                teamA: teamAName,
                teamB: teamBName,
                match: `${teamAName} vs ${teamBName}`,
              };
            }
          }
        }
      }
    }

    // Numeric so Court 2 lands before Court 10.
    return [...byCourt.values()].sort((a, b) =>
      a.court.localeCompare(b.court, undefined, { numeric: true }),
    );
  }, [isLive, tournament]);

  const hasSchedule = useMemo(() => {
    return (tournament?.divisions ?? []).some(d =>
      d.bracket.some(r => r.matches.some(m => Boolean(m.court || m.time))),
    );
  }, [tournament]);

  /* Tab order across mobile and desktop:
     1. Schedule (first tab when schedule exists)
     2. Round tabs (Round 1, Round 2, ...)
     3. Supporting tabs (Teams, Format & Rules, Prize, Vouchers) */
  /* Two orders, and the start date picks between them.
     Before the first day there is nothing being played, so the page leads
     with what the event is — the rules, who is in, what is on offer — and
     a published schedule or draw sits behind that rather than in front of
     it. From the first day on the order flips: what is happening now comes
     first, and the reference material moves behind it. */
  const tabs = useMemo(() => {
    const play = [
      ...(hasSchedule ? ['Schedule'] : []),
      ...divisionRounds.map(r => r.label),
    ];
    const t = hasStarted
      ? [...play, 'Teams', 'Format & Rules', 'Prize']
      : ['Format & Rules', 'Teams', 'Prize', ...play];
    if ((tournament?.vouchers.length ?? 0) > 0) t.push('Vouchers');
    return t;
  }, [hasStarted, hasSchedule, divisionRounds, tournament]);

  const defaultTab = hasStarted
    ? (hasSchedule ? 'Schedule' : (divisionRounds[0]?.label ?? 'Format & Rules'))
    : 'Format & Rules';

  const normalizedActiveTab = useMemo(() => {
    if (activeTab === 'Standings') {
      const groupRound = divisionRounds.find(r => r.isGroup);
      return groupRound ? groupRound.label : (divisionRounds[0]?.label ?? activeTab);
    }
    if (activeTab === 'Bracket') {
      const koRound = divisionRounds.find(r => r.isKnockout);
      return koRound ? koRound.label : (divisionRounds[1]?.label ?? divisionRounds[0]?.label ?? activeTab);
    }
    return activeTab;
  }, [activeTab, divisionRounds]);

  const currentTab = tabs.includes(normalizedActiveTab)
    ? normalizedActiveTab
    : (tabs.includes(defaultTab) ? defaultTab : tabs[0]);

  const activeRoundTab = useMemo(
    () => divisionRounds.find(r => r.label === currentTab),
    [divisionRounds, currentTab],
  );

  const tabSwipeHandlers = useTabSwipe({
    tabs,
    activeTab: currentTab,
    onTabChange: handleSelectTab,
  });

  const tabBarInnerRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const snapBackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchingRef = useRef<boolean>(false);

  const scheduleSnapBack = useCallback((delay = 1200) => {
    if (snapBackTimerRef.current) clearTimeout(snapBackTimerRef.current);
    snapBackTimerRef.current = setTimeout(() => {
      if (isTouchingRef.current) return;
      const tabElem = activeTabRef.current;
      const container = tabBarInnerRef.current;
      if (!tabElem || !container) return;
      const elemRect = tabElem.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const isVisible = elemRect.left >= containerRect.left - 4 && elemRect.right <= containerRect.right + 4;
      if (!isVisible) {
        centerInRail(tabElem);
      }
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (snapBackTimerRef.current) clearTimeout(snapBackTimerRef.current);
    };
  }, []);

  // Centre the active tab in its strip — horizontally only, so the load
  // that picks a default tab doesn't scroll the page down to the tab bar.
  useEffect(() => {
    centerInRail(activeTabRef.current);
  }, [currentTab]);

  useEffect(() => {
    const handleSave = () => {
      if (typeof window !== 'undefined' && window.scrollY > 0) {
        saveScrollPosition(undefined, { activeDiv, activeTab: currentTab });
      }
    };
    window.addEventListener('scroll', handleSave, { passive: true });
    window.addEventListener('pagehide', handleSave);
    return () => {
      window.removeEventListener('scroll', handleSave);
      window.removeEventListener('pagehide', handleSave);
    };
  }, [activeDiv, currentTab]);

  const [navMode, setNavMode] = useState<NavMode>('top');
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let mode: NavMode = 'top';
    let navHeight = headerRef.current?.offsetHeight || 62;
    let lastY = window.scrollY;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const apply = (next: NavMode, offset?: number) => {
      const el = headerRef.current;
      if (el) el.style.transform = offset === undefined ? '' : `translateY(${-offset}px)`;
      if (next !== mode) {
        mode = next;
        setNavMode(next);
      }
    };

    const armIdle = () => {
      clearIdle();
      idleTimer = setTimeout(() => {
        const el = headerRef.current;
        if (el && (el.matches(':hover') || el.contains(document.activeElement))) {
          armIdle();
          return;
        }
        if (mode === 'shown') apply('hidden');
      }, NAV_IDLE_HIDE_MS);
    };

    const handleScroll = () => {
      const y = window.scrollY;

      if (mode === 'top' && y <= navHeight) {
        apply('top', y);
      } else if (y <= NAV_TOP_EPSILON) {
        clearIdle();
        apply('top', y);
      } else if (y < lastY - NAV_SCROLL_DELTA) {
        apply('shown');
        armIdle();
      } else if (y > lastY + NAV_SCROLL_DELTA) {
        clearIdle();
        apply('hidden');
      }

      lastY = y;
    };

    const handleResize = () => {
      if (mode === 'top') navHeight = headerRef.current?.offsetHeight || navHeight;
      handleScroll();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    handleScroll();

    return () => {
      clearIdle();
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (headerRef.current) headerRef.current.style.transform = '';
    };
  }, []);

  if (!tournament) {
    return (
      <div className={styles.page} style={{ ['--nav-offset' as any]: navMode === 'shown' ? '62px' : '0px' }}>
        <SiteHeader headerRef={headerRef} navMode={navMode} />
        <div className={styles.headerSpacer} aria-hidden="true" />
        <div className={styles.stateWrap}>Loading tournament…</div>
      </div>
    );
  }

  /* Draft means nobody but the organizer sees it, and archived means it has
     been taken off the board. Cancelled is deliberately not here: a cancelled
     event stays up so the teams who registered find out. */
  if (!isPublic(tournament.phase as Phase) || tournament.archived) {
    return (
      <div className={styles.page} style={{ ['--nav-offset' as any]: navMode === 'shown' ? '62px' : '0px' }}>
        <SiteHeader headerRef={headerRef} navMode={navMode} />
        <div className={styles.headerSpacer} aria-hidden="true" />
        <div className={styles.stateWrap}>
          <h1 className={styles.stateTitle}>This tournament isn&apos;t published</h1>
          <p className={styles.stateBody}>The organizer hasn&apos;t made it public yet. Check back soon.</p>
        </div>
      </div>
    );
  }

  const canRegister = regState === 'open';

  return (
    <div
      className={styles.page}
      style={{ ['--nav-offset' as any]: navMode === 'shown' ? '62px' : '0px' }}
    >
      <SiteHeader
        headerRef={headerRef}
        navMode={navMode}
        onSignInClick={() => saveScrollPosition(undefined, { activeDiv, activeTab: currentTab })}
      />
      <div className={styles.headerSpacer} aria-hidden="true" />

      {/* ── Event head ────────────────────────────────────────── */}
      <section className={styles.headSection}>
        <Link href="/" className={styles.backLink}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All events
        </Link>

        <div className={styles.heroCard}>
          <div className={styles.heroPosterWrap}>
            {tournament.imageUrl ? (
              <img
                src={tournament.imageUrl}
                alt={tournament.title}
                className={styles.heroPoster}
              />
            ) : (
              <div className={styles.heroPosterFallback} aria-hidden="true">
                <span className={styles.heroPosterInitials}>{getTitleInitials(tournament.title)}</span>
              </div>
            )}
          </div>

          <div className={styles.headMain}>
            {/* The same status, in the same colours, as the card this page
                was opened from. A date is more use than the word "announced"
                when there is one to give, so that copy stays. */}
            <div className={styles.pillRow}>
              <Badge status={status.key}>
                {status.key === 'announced' && opensAt
                  ? `Opens ${formatDay(opensAt)}`
                  : status.label}
              </Badge>
            </div>

            <h1 className={styles.title}>{tournament.title}</h1>

            <div className={styles.metaRow}>
              <div className={styles.metaLine}>
                <span className={styles.metaItem}>
                  <Calendar size={15} />
                  {tournament.date}
                </span>
                <span className={styles.metaItem}>
                  <MapPin size={15} />
                  {tournament.location}
                </span>
              </div>
              <div className={styles.metaLine}>
                <span className={styles.metaItem}>
                  <Users size={15} />
                  {courtCount > 0 ? `${courtCount} courts · ` : ''}
                  {tournament.divisions.length} division{tournament.divisions.length === 1 ? '' : 's'}
                </span>
                {regState === 'open' && closesOn && (
                  <span className={styles.metaItem}>
                    <Clock size={15} />
                    Registration closes {formatCloseDate(closesOn)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.headActions}>
            {canRegister ? (
              <Link href={`/tournament/${slug}/register`} className={styles.btnPrimary}>Register team</Link>
            ) : (
              <button className={styles.btnPrimary} disabled>
                {regState === 'opens-soon' && opensAt ? `Opens ${formatDay(opensAt)}` : 'Registration closed'}
              </button>
            )}
            <ShareButton />
          </div>
        </div>
      </section>

      {/* ── Courts today ──────────────────────────────────────────
           On the day of the event every court rides in one horizontal rail
           above the division picker — live score if the court is in play,
           what's due on it next if it isn't. */}
      {courtCards.length > 0 && <CourtRail courts={courtCards} />}

      {/* ── Division picker + tabs ───────────────────────────────
           On mobile these two ride together in one sticky rail under the
           header; on desktop the wrapper is display:contents so the tab bar
           keeps its own sticky behaviour. */}
      <div className={styles.controlRail}>
      {tournament.divisions.length > 0 && (
        <section className={styles.divisionSection}>
          <div className={styles.segmented}>
            {tournament.divisions.map(d => {
              const isActive = activeDiv === d.id;
              return (
                <button
                  key={d.id}
                  id={`division-tab-${d.id}`}
                  type="button"
                  className={`${styles.segment} ${isActive ? styles.segmentActive : ''}`}
                  onClick={(e) => {
                    handleSelectDivision(d.id);
                    centerInRail(e.currentTarget);
                  }}
                  aria-pressed={isActive}
                >
                  {isActive && (
                    <motion.span
                      layoutId="tournament-division-pill"
                      className={styles.activePill}
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className={styles.segmentLabel}>{d.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className={styles.tabBar}>
        <div
          ref={tabBarInnerRef}
          className={styles.tabBarInner}
          onTouchStart={() => {
            isTouchingRef.current = true;
            if (snapBackTimerRef.current) clearTimeout(snapBackTimerRef.current);
          }}
          onTouchEnd={() => {
            isTouchingRef.current = false;
            scheduleSnapBack(1200);
          }}
          onScroll={() => {
            if (isTouchingRef.current) {
              if (snapBackTimerRef.current) clearTimeout(snapBackTimerRef.current);
            } else {
              scheduleSnapBack(1200);
            }
          }}
        >
          {tabs.map(t => {
            const isActive = currentTab === t;
            return (
              <button
                key={t}
                ref={isActive ? activeTabRef : null}
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                onClick={(e) => {
                  if (snapBackTimerRef.current) clearTimeout(snapBackTimerRef.current);
                  handleSelectTab(t);
                  centerInRail(e.currentTarget);
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="tournament-tab-underline"
                    className={styles.tabUnderlineIndicator}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span>{t}</span>
              </button>
            );
          })}
        </div>
      </div>
      </div>

      <main className={styles.main} {...tabSwipeHandlers}>
        <div className={styles.sliderOverflowWrap}>
          <AnimatePresence mode="wait" initial={false} custom={slideDirection}>
            <motion.div
              key={`${activeDiv}-${currentTab}`}
              custom={slideDirection}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className={styles.animatedContentWrap}
            >

        {/* ── Format & rules ──────────────────────────────────── */}
        {currentTab === 'Format & Rules' && activeDivision && (
          <div className={styles.formatWrap}>

            {/* ── What the division is ─────────────────────────── */}
            <div className={styles.divisionCard}>
              <div className={styles.divisionCardMain}>
                <div className={styles.divisionCardHead}>
                  <p className={styles.microLabel}>Division</p>
                  <h2 className={styles.divisionName}>{activeDivision.label}</h2>
                  {activeDivision.formatTypeOnSand && (
                    <span className={styles.badgeStatus}>
                      {activeDivision.formatTypeOnSand}
                    </span>
                  )}
                </div>

                <div className={styles.divisionStats}>
                  {[
                    { label: 'Team cap', value: `${activeDivision.teams} teams` },
                    { label: 'Roster', value: `${activeDivision.rosterSize} players` },
                    { label: 'Gender', value: activeDivision.gender },
                    { label: 'Age limit', value: ageLimitLabel(activeDivision.ageLimit) },
                    ...(activeDivision.netHeight ? [{ label: 'Net height', value: activeDivision.netHeight }] : []),
                  ].map(st => (
                    <div key={st.label} className={styles.stat}>
                      <p className={styles.microLabel}>{st.label}</p>
                      <p className={styles.statValue}>{st.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Entry fee owns the full-height rail on the right of the card. */}
              <div className={styles.feeRail}>
                <p className={styles.microLabel}>Entry fee</p>
                <p className={styles.feeValue}>
                  {activeDivision.registrationFee > 0
                    ? `${activeDivision.registrationFee.toLocaleString()} THB`
                    : 'Free'}
                </p>
              </div>
            </div>

            {/* ── How the draw runs ────────────────────────────── */}
            {roundViews.length > 0 ? (
              <section className={styles.drawSection}>
                <div className={styles.drawHead}>
                  <h2 className={styles.drawTitle}>How the draw runs</h2>
                </div>

                <div className={styles.roundGrid}>
                  {roundViews.map(r => (
                    <article key={r.key} className={styles.roundCard}>
                      <div className={styles.roundBody}>
                        <div className={styles.roundHead}>
                          <span className={styles.roundNum}>{r.n}</span>
                          <div className={styles.roundHeadText}>
                            <p className={styles.microLabel}>{r.eyebrow}</p>
                            <h3 className={styles.roundName}>{r.name}</h3>
                          </div>
                        </div>

                        <div className={styles.setGrid}>
                          {r.sets.map(t => (
                            <div key={t.label} className={styles.setTile}>
                              <p className={styles.microLabel}>{t.label}</p>
                              <p className={styles.setPoints}>{t.points}</p>
                              <p className={styles.setNote}>{t.note}</p>
                            </div>
                          ))}
                        </div>

                        <div className={styles.factRow}>
                          {r.facts.map(f => (
                            <span key={f.label} className={styles.factPill}>
                              <span className={styles.factLabel}>{f.label}</span>
                              <span className={styles.factValue}>{f.value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <EmptyCard
                title="Format not set yet"
                body="The organizer hasn't configured this division's rounds."
              />
            )}

            {/* ── Note section ──────────────────────────────────── */}
            {activeDivision.rules.trim() && (
              <section className={styles.noteCard}>
                <p className={styles.microLabel}>Note</p>
                <p className={styles.noteText}>{activeDivision.rules.trim()}</p>
              </section>
            )}

            {tournament.description && (
              <section className={styles.aboutCard}>
                <p className={styles.microLabel}>About</p>
                <h2 className={styles.drawTitle}>This tournament</h2>
                <p className={styles.aboutText}>{tournament.description}</p>
              </section>
            )}
          </div>
        )}

        {/* ── Prize ───────────────────────────────────────────── */}
        {currentTab === 'Prize' && activeDivision && (
          <div className={styles.prizeWrap}>
            <div className={styles.prizeCard}>
              <div className={styles.prizeCardHead}>
                <div>
                  <p className={styles.microLabel}>Awards & Payout</p>
                  <h2 className={styles.drawTitle}>{activeDivision.label} Prizes</h2>
                </div>
                {activeDivision.registrationFee > 0 && (
                  <div className={styles.prizeFeeBadge}>
                    <span className={styles.microLabel}>Entry Fee</span>
                    <span className={styles.prizeFeeValue}>{activeDivision.registrationFee.toLocaleString()} THB</span>
                  </div>
                )}
              </div>

              {activeDivision.prizePool && activeDivision.prizePool.trim() ? (
                <div className={styles.prizeBody}>
                  <div className={styles.prizeText}>
                    {activeDivision.prizePool.trim()}
                  </div>
                </div>
              ) : (
                <EmptyCard
                  title="Prizes to be announced"
                  body="The organizer hasn't published the prize breakdown for this division yet. Check back closer to tournament start."
                />
              )}
            </div>
          </div>
        )}

        {/* ── Teams ───────────────────────────────────────────── */}
        {currentTab === 'Teams' && activeDivision && (
          <div className={styles.teamsWrap}>
            <FillCard division={activeDivision} />
            <div className={styles.teamsGrid}>
              {activeDivision.teamsList.map(team => {
                const parsedNames = parseTeamPlayers(team.name);
                const playerItems = team.players && team.players.length > 0
                  ? team.players
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
                        {playerItems.map((player, idx) => {
                          /* The same key the avatar is resolved by: the
                             player's own account, or — for the first name on
                             the team — the account that registered it. */
                          const avatarKey = player.userId || (idx === 0 && team.registeredBy ? team.registeredBy : undefined);
                          const avatarUrl = avatarKey ? playerAvatars[avatarKey] : undefined;
                          const hasAccount = Boolean(avatarKey);

                          if (hasAccount) {
                            return (
                              <button
                                type="button"
                                key={player.id || idx}
                                className={`${styles.teamPlayerRow} ${styles.teamPlayerRowBtn}`}
                                onClick={() => setPlayerCard({
                                  userId: avatarKey ?? null,
                                  name: player.name,
                                  avatarUrl,
                                })}
                                title={`About ${player.name}`}
                              >
                                <PlayerAvatar name={player.name} avatarUrl={avatarUrl} />
                                <span className={styles.teamPlayerName}>{player.name}</span>
                              </button>
                            );
                          }

                          return (
                            <div
                              key={player.id || idx}
                              className={styles.teamPlayerRow}
                            >
                              <PlayerAvatar name={player.name} avatarUrl={avatarUrl} />
                              <span className={styles.teamPlayerName}>{player.name}</span>
                            </div>
                          );
                        })}
                      </div>

                      {team.status === 'waitlist' && (
                        <span className={styles.teamTag}>
                          Waitlist
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {activeDivision.teamsList.length === 0 && (
                <EmptyCard title="No teams yet" body="Registered teams appear here as they sign up." />
              )}
            </div>
          </div>
        )}

        {/* ── Round content (Standings or Bracket) ─────────────── */}
        {(activeRoundTab || currentTab === 'Standings' || currentTab === 'Bracket') && (
          (activeRoundTab?.isKnockout || currentTab === 'Bracket') ? (
            knockoutRounds.length > 0 ? (
              <div className={styles.bracketScroll}>
                <div className={styles.bracketGrid}>
                  {knockoutRounds.map((round, ri) => {
                    const feedsAnother = ri < knockoutRounds.length - 1;
                    return (
                      <div key={round.round} className={styles.bracketColumn}>
                        <div className={styles.bracketRoundLabel}>{round.round}</div>

                        {/* Every round's tree is the same height, so each slot in
                            it is the same height, so a match sits exactly halfway
                            between the two it is fed by. */}
                        <div className={styles.bracketMatches} style={{ minHeight: bracketTreeHeight }}>
                          {round.matches.map((m, mi) => (
                            <div key={m.id} className={styles.bracketSlot}>
                              <BracketCard match={m} />
                              {feedsAnother && <span className={styles.connRight} aria-hidden="true" />}
                              {/* One spine per pair, drawn from the upper match
                                  down to the lower one's middle. */}
                              {feedsAnother && mi % 2 === 0 && (
                                <span className={styles.connSpine} aria-hidden="true" />
                              )}
                            </div>
                          ))}
                        </div>

                        {/* The play-off for 3rd hangs off the semifinals, not off
                            the round before the final, so it sits under the final
                            rather than inside the tree. */}
                        {ri === knockoutRounds.length - 1 && thirdPlaceRound?.matches[0] && (
                          <div className={styles.thirdPlaceBlock}>
                            <div className={styles.thirdPlaceLabel}>3rd Place</div>
                            <BracketCard match={thirdPlaceRound.matches[0]} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyCard
                title="Bracket not drawn yet"
                body="This division is still in pool play. The draw appears here once pools finish."
              />
            )
          ) : (
            poolStandings.length > 0 ? (
              <div className={styles.poolsContainer}>
                {poolStandings.map((pool) => {
                  const isSingle = poolStandings.length === 1;
                  const displayName = pool.name.startsWith('Pool ') ? pool.name : `Pool ${pool.name}`;
                  return (
                    <div
                      key={pool.name}
                      className={`${styles.poolCard} ${isSingle ? styles.poolCardSingle : ''}`}
                    >
                      <div className={styles.poolHeader}>
                        <h3 className={styles.poolTitle}>{displayName}</h3>
                        <span className={styles.poolTeamCount}>
                          {pool.rows.length} {pool.rows.length === 1 ? 'team' : 'teams'}
                        </span>
                      </div>
                    <div className={styles.tableCard}>
                      <div className={styles.tableHead}>
                        <span>#</span>
                        <span>Players</span>
                        <span className={styles.center}>W</span>
                        <span className={styles.center}>L</span>
                        <span className={styles.center}>Bye</span>
                        <span className={styles.right}>Pts</span>
                      </div>
                      {pool.rows.map((r, i) => (
                        <div key={r.teamId} className={styles.tableRow}>
                          <span className={styles.rank}>{i + 1}</span>
                          <span className={styles.tableTeam}>{r.team}</span>
                          <span className={`${styles.center} ${styles.num}`}>{r.wins}</span>
                          <span className={`${styles.center} ${styles.numMuted}`}>{r.losses}</span>
                          <span className={`${styles.center} ${styles.numMuted}`}>{r.byes}</span>
                          <span className={`${styles.right} ${styles.numBold}`}>{r.points}</span>
                        </div>
                      ))}
                      {pool.rows.length === 0 && (
                        <div className={styles.poolEmpty}>No teams assigned yet</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            ) : (
              <EmptyCard
                title="No standings yet"
                body="Registered teams and standings will appear here once entries are received."
              />
            )
          )
        )}

        {/* ── Schedule ────────────────────────────────────────── */}
        {currentTab === 'Schedule' && tournament && (
          <CourtScheduleView
            tournament={tournament}
            activeDivisionId={activeDiv}
            onSelectDivision={handleSelectDivision}
          />
        )}

        {/* ── Vouchers ────────────────────────────────────────── */}
        {currentTab === 'Vouchers' && (
          <div className={styles.voucherGrid}>
            {tournament.vouchers.map(v => (
              <div key={v.id} className={styles.voucherCard}>
                <h3 className={styles.voucherTitle}>{v.title}</h3>
                <p className={styles.voucherDesc}>{v.description}</p>
                <span className={styles.voucherCode}>{v.code}</span>
              </div>
            ))}
          </div>
        )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <PlayerCardModal target={playerCard} onClose={() => setPlayerCard(null)} />
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────── */

function SiteHeader({
  headerRef,
  navMode = 'top',
  onSignInClick,
}: {
  headerRef?: React.RefObject<HTMLElement | null>;
  navMode?: NavMode;
  onSignInClick?: () => void;
}) {
  const signInHref = useSignInHref();
  const { signedIn } = useSession();
  return (
    <header
      ref={headerRef}
      className={[
        styles.siteHeader,
        navMode !== 'top' ? styles.headerFloat : '',
        navMode === 'shown' ? styles.headerRevealed : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={styles.siteHeaderInner}>
        {/* Narrow screens fold the way back into the header row, so the
            back link, the wordmark and the account control share one
            line. The copy below the head section (.backLink) is the
            wide-screen one and is hidden there instead. */}
        <Link href="/" className={styles.headerBack}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All events
        </Link>

        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>
            <svg viewBox="296 73 687 687" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="639.5" cy="416.5" r="343.5" fill="#EB6F43" />
              <rect x="428" y="234" width="165.327" height="35.9406" rx="15" fill="white" />
              <rect x="428" y="561.059" width="165.327" height="35.9406" rx="15" fill="white" />
              <rect x="593.327" y="308.277" width="165.327" height="35.9406" rx="15" fill="white" />
              <rect x="722.713" y="462.822" width="129.386" height="35.9406" rx="15" fill="white" />
              <rect x="593.327" y="489.178" width="129.386" height="35.9406" rx="15" fill="white" />
              <rect x="557.386" y="416.099" width="182.099" height="35.9406" rx="15" transform="rotate(-90 557.386 416.099)" fill="white" />
              <rect x="722.713" y="498.762" width="190.485" height="35.9406" rx="15.5" transform="rotate(-90 722.713 498.762)" fill="white" />
              <rect x="557.386" y="597" width="180.901" height="35.9406" rx="15" transform="rotate(-90 557.386 597)" fill="white" />
            </svg>
          </span>
          <span className={styles.brandWord}>LIVE BRACKET</span>
        </Link>

        <nav className={styles.headerNav}>
          {signedIn ? (
            <AccountButton
              onNavigate={() => {
                if (onSignInClick) {
                  onSignInClick();
                } else {
                  saveScrollPosition();
                }
              }}
            />
          ) : (
            <Link
              href={signInHref}
              onClick={() => {
                if (onSignInClick) {
                  onSignInClick();
                } else {
                  saveScrollPosition();
                }
              }}
              className={styles.btnGeneral}
            >
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/* Uses the platform share sheet where there is one, and falls back to the
   clipboard — with the label reporting which happened. */
/* Pointer capture throws if the pointer has already ended — a cancelled
   drag, a mouse released outside the window — and neither end of a drag is
   worth an exception. */
function capture(el: Element, pointerId: number, on: boolean) {
  try {
    if (on) el.setPointerCapture(pointerId);
    else el.releasePointerCapture(pointerId);
  } catch { /* the pointer is already gone */ }
}

/* ── The courts rail ──────────────────────────────────────────────
   Horizontal, one card per court. Touch scrolls it natively and snaps to
   each court; a mouse drags it anywhere in the rail, because a 3.5-card
   viewport gives a pointer user nothing obvious to grab otherwise. The
   slim bar above is that drag made visible, and is itself draggable. */
function CourtRail({ courts }: { courts: CourtCard[] }) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null);
  const barDragRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [thumb, setThumb] = useState({ width: 0, left: 0 });

  const syncThumb = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const ratio = el.clientWidth / el.scrollWidth;
    // Nothing overflows — no bar to draw.
    if (!Number.isFinite(ratio) || ratio >= 0.999) {
      setThumb({ width: 0, left: 0 });
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    setThumb({
      width: ratio * 100,
      left: max > 0 ? (el.scrollLeft / max) * (1 - ratio) * 100 : 0,
    });
  }, []);

  useEffect(() => {
    syncThumb();
    const el = railRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncThumb);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncThumb, courts.length]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    // Touch keeps the browser's own momentum and snapping.
    if (e.pointerType === 'touch') return;
    const el = railRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    dragRef.current = { startX: e.clientX, startScroll: el.scrollLeft };
    setDragging(true);
    capture(el, e.pointerId, true);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = railRef.current;
    if (!d || !el) return;
    el.scrollLeft = d.startScroll - (e.clientX - d.startX);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (railRef.current) capture(railRef.current, e.pointerId, false);
  };

  /* Put the middle of the thumb under the pointer, so a click on the bar
     jumps there and a drag along it tracks the finger. */
  const scrollFromBar = (clientX: number) => {
    const bar = barRef.current;
    const el = railRef.current;
    if (!bar || !el) return;
    const rect = bar.getBoundingClientRect();
    const ratio = el.clientWidth / el.scrollWidth;
    const usable = rect.width * (1 - ratio);
    if (usable <= 0) return;
    const offset = clientX - rect.left - (rect.width * ratio) / 2;
    const pct = Math.max(0, Math.min(1, offset / usable));
    el.scrollLeft = pct * (el.scrollWidth - el.clientWidth);
  };

  return (
    <section className={styles.courtsSection} aria-label="Courts">
      {thumb.width > 0 && (
        <div className={styles.courtsBar}>
          <div
            ref={barRef}
            className={styles.courtsBarTrack}
            onPointerDown={e => {
              barDragRef.current = true;
              scrollFromBar(e.clientX);
              capture(e.currentTarget, e.pointerId, true);
            }}
            onPointerMove={e => { if (barDragRef.current) scrollFromBar(e.clientX); }}
            onPointerUp={e => {
              barDragRef.current = false;
              capture(e.currentTarget, e.pointerId, false);
            }}
            onPointerCancel={() => { barDragRef.current = false; }}
          >
            <div
              className={styles.courtsBarThumb}
              style={{ width: `${thumb.width}%`, left: `${thumb.left}%` }}
            />
          </div>
        </div>
      )}

      <div
        ref={railRef}
        className={`${styles.courtsRail} ${dragging ? styles.courtsRailDragging : ''}`}
        tabIndex={0}
        onScroll={syncThumb}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {courts.map(c => (
          <article key={c.key} className={c.live ? styles.courtCardLive : styles.courtCard}>
            <div className={styles.courtCardHead}>
              <span className={c.live ? styles.courtName : styles.courtNameIdle}>{c.court}</span>
              {c.live ? (
                <span className={styles.liveSet}>
                  <span className={styles.livePulse} />
                  {c.live.setLabel}
                </span>
              ) : (
                <span className={styles.idleLabel}>{c.next ? 'Next up' : 'Open'}</span>
              )}
            </div>

            {c.live ? (
              <>
                {[c.live.a, c.live.b].map((side, i) => (
                  <div key={i}>
                    {i === 1 && <div className={styles.liveDivider} />}
                    <div className={styles.liveTeamRow}>
                      <span className={side.leading ? styles.liveTeamLead : styles.liveTeam}>{side.name}</span>
                      <span className={styles.liveScoreGroup}>
                        <SetHistory sets={side.sets} className={styles.liveHistory} />
                        <span className={side.leading ? styles.liveScoreLead : styles.liveScore}>{side.score}</span>
                      </span>
                    </div>
                  </div>
                ))}
                <div className={styles.liveFootnote}>
                  {[c.live.heading, c.live.footnote].filter(Boolean).join(' · ')}
                </div>
              </>
            ) : c.next ? (
              <>
                <div className={styles.nextTimeRow}>
                  <span className={styles.nextTime}>{c.next.time || '—'}</span>
                  <span className={styles.nextWhere}>{c.next.where}</span>
                </div>
                <div className={styles.nextTeamsWrap}>
                  <div className={styles.nextTeamName}>{c.next.teamA}</div>
                  <div className={styles.nextDivider} />
                  <div className={styles.nextTeamName}>{c.next.teamB}</div>
                </div>
              </>
            ) : (
              <div className={styles.idleEmpty}>No match scheduled</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // Dismissed, or unavailable — fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button 
      className={`${styles.btnGeneral} ${styles.shareBtn}`} 
      onClick={share}
      aria-label={copied ? "Link copied" : "Share event"}
      title={copied ? "Link copied" : "Share event"}
    >
      {copied ? <Check size={17} className={styles.shareIcon} /> : <Share2 size={17} className={styles.shareIcon} />}
      <span className={styles.shareBtnText}>{copied ? 'Link copied' : 'Share event'}</span>
    </button>
  );
}

function FillCard({ division }: { division: DetailDivision }) {
  const cap = Math.max(1, division.teams);
  const pct = Math.min(100, Math.round((division.filled / cap) * 100));
  const waitlist = division.teamsList.filter(t => t.status === 'waitlist').length;

  return (
    <div className={styles.fillCard}>
      <div className={styles.fillTop}>
        <div>
          <p className={styles.fillEyebrow}>Spots filled</p>
          <p className={styles.fillCount}>{division.filled} / {division.teams} teams</p>
        </div>
        <div className={styles.fillStats}>
          <div>
            <p className={styles.fillStatLabel}>Spots left</p>
            <p className={styles.fillStatValue}>{Math.max(0, division.teams - division.filled)}</p>
          </div>
          <div>
            <p className={styles.fillStatLabel}>Waitlist</p>
            <p className={styles.fillStatValue}>{waitlist}</p>
          </div>
          <div>
            <p className={styles.fillStatLabel}>Full</p>
            <p className={styles.fillStatValue}>{pct}%</p>
          </div>
        </div>
      </div>
      <div className={styles.fillTrack}>
        <div
          className={pct >= 100 ? styles.fillBarFull : styles.fillBar}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BracketCard({ match }: { match: DetailMatch }) {
  const live = match.status === 'live';
  const scoreA = match.scoreA ?? [];
  const scoreB = match.scoreB ?? [];

  return (
    <div className={`${styles.matchCard} ${live ? styles.matchCardLive : ''}`}>
      <div className={styles.matchMeta}>
        <span>{[match.court, match.time].filter(Boolean).join(' · ') || 'Time TBD'}</span>
        {live && <span className={styles.matchLive}>Live</span>}
        {match.status === 'done' && <span className={styles.matchDone}>Final</span>}
      </div>

      {([['A', match.teamAName, scoreA], ['B', match.teamBName, scoreB]] as const).map(([side, name, sets], i) => (
        <div key={side}>
          {i === 1 && <div className={styles.matchDivider} />}
          <div className={styles.matchRow}>
            <span className={match.winner === side ? styles.matchTeamWin : styles.matchTeam}>
              {name ?? 'TBD'}
            </span>
            <SetHistory sets={sets} className={styles.matchSets} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* Set scores, one column per set. Sharing a column is what makes set 2 sit
   under set 2 when "15" is above "9" — numbers run together with dots do not
   line up between the two rows. */
function SetHistory({ sets, className }: { sets: readonly number[]; className: string }) {
  return (
    <span className={className}>
      {sets.length === 0 ? (
        <span className={styles.setCell}>—</span>
      ) : (
        sets.map((v, i) => <span key={i} className={styles.setCell}>{v}</span>)
      )}
    </span>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.emptyCard}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
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
