'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, QrCode, Trophy, Settings, Calendar, MapPin, History, Bell, ChevronDown, Home, Clock,
} from 'lucide-react';
import styles from './page.module.css';
import CreateTournamentModal from './CreateTournamentModal';
import ScorekeeperQrPanel from './ScorekeeperQrPanel';
import ScorekeeperQrCards, { useScorekeeperLinks, useQrPdfExport } from '../../components/ScorekeeperQrCards';
import { Button, SearchField } from '../../components/livebracket-ds';
import {
  getDashboardTournaments, getTournamentDetail, todayLocal,
  type DashboardTournament, type TournamentDetail, type DetailMatch, type DetailMatchPlayer,
} from '../../lib/data';
import { fetchLiveScores, applyLiveScores } from '../../lib/liveScores';
import { joinTeamName } from '../../lib/teamName';
import { elapsedSeconds, formatClock } from '../../lib/matchClock';
import { nextPerCourt } from '../../lib/scorekeeperLinks';

interface Organizer {
  name: string;
  club: string | null;
  avatar_url: string | null;
}

const TODAY = todayLocal();
const LIVE_POLL_MS = 15000;

function isLiveNow(t: CardTournament): boolean {
  return t.startDate <= TODAY && TODAY <= (t.endDate || t.startDate);
}

/* Map tournament phase → filter status */
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'announced', label: 'Announced' },
  { key: 'draft', label: 'Draft' },
] as const;

type StatusKey = (typeof STATUS_FILTERS)[number]['key'];

function phaseToStatus(phase: number): 'coming-up' | 'announced' | 'draft' {
  switch (phase) {
    case 3: return 'coming-up';
    case 4: return 'coming-up';
    case 2: return 'announced';
    default: return 'draft';
  }
}

function statusPill(t: CardTournament): { label: string; cls: string } {
  if (t.phase === 3) return { label: 'Open', cls: styles.pillOpen };
  if (t.phase === 4) return { label: 'Closed', cls: styles.pillClosed };
  if (t.phase === 2) return { label: 'Announced', cls: styles.pillAnnounced };
  return { label: 'Draft', cls: styles.pillDraft };
}

type CardTournament = DashboardTournament;

function isCompleted(t: CardTournament): boolean {
  return (t.endDate || t.startDate) < TODAY;
}

// Registration is open while live (phase 3); closed the day before (phase 4).
function matchesFilter(t: CardTournament, key: StatusKey | null): boolean {
  // Default (no filter selected): upcoming events only — completed
  // tournaments stay hidden until their filter is chosen. Drafts show, so a
  // freshly created tournament is visible immediately.
  if (key === null) return !isCompleted(t);
  if (key === 'all') return true;
  if (key === 'draft') return phaseToStatus(t.phase) === 'draft';
  if (isCompleted(t)) return false;
  if (key === 'open') return t.phase === 3;
  if (key === 'closed') return t.phase === 4;
  return phaseToStatus(t.phase) === key;
}

// Nearest upcoming event first; past events after, most recent first.
function byNearestEvent(a: CardTournament, b: CardTournament): number {
  const aDone = isCompleted(a);
  const bDone = isCompleted(b);
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (!aDone) return a.startDate.localeCompare(b.startDate);
  return (b.endDate || b.startDate).localeCompare(a.endDate || a.startDate);
}

// Row thumbnail initials — derived from the city (the part of the location
// after the last comma), e.g. "Nang Thong Beach, Khao Lak" → "KL".
function locationInitials(location: string): string {
  const city = location.split(',').pop()?.trim() ?? location;
  const words = city.split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
  return initials || '??';
}

function matchesQuery(t: CardTournament, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    t.title.toLowerCase().includes(needle) ||
    t.location.toLowerCase().includes(needle) ||
    t.divisions.some(d => d.name.toLowerCase().includes(needle))
  );
}

/* ── Live courts model ──────────────────────────────────────────── */

const SET_COLUMNS = 3;

interface SetScore {
  a: number;
  b: number;
}

interface CourtRow {
  court: string;
  division: string;
  teamA: string;
  teamB: string;
  scoreA: number | null;         // points in the set currently on court
  scoreB: number | null;
  lastScorer: 'a' | 'b' | null;  // side that won the most recent point
  startedAt: number | null;      // epoch ms the match clock runs from
  sets: (SetScore | null)[];     // finished sets, padded to SET_COLUMNS
  hasLive: boolean;
  upNext: string | null;
  upNextTime: string | null;
}

function playerNames(players: DetailMatchPlayer[]): string {
  return joinTeamName(players.map(p => p.name)) || 'TBD';
}


function buildCourtRows(detail: TournamentDetail): CourtRow[] {
  type TaggedMatch = DetailMatch & { division: string };
  const all: TaggedMatch[] = [];
  detail.divisions.forEach(d =>
    d.bracket.forEach(r =>
      r.matches.forEach(m => all.push({ ...m, division: d.label }))
    )
  );

  const courts = new Map<string, { live?: TaggedMatch; upcoming: TaggedMatch[] }>();
  for (const m of all) {
    if (m.status === 'done') continue;
    const key = m.court || 'Unassigned';
    if (!courts.has(key)) courts.set(key, { upcoming: [] });
    const entry = courts.get(key)!;
    if (m.status === 'live') {
      if (!entry.live) entry.live = m;
    } else {
      entry.upcoming.push(m);
    }
  }

  const rows: CourtRow[] = [];
  for (const [court, entry] of courts) {
    entry.upcoming.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    // Skip the match currently shown as live from the queue
    const next = entry.upcoming[0];
    const upNext = next
      ? `${playerNames(next.teamA)} vs ${playerNames(next.teamB)}`
      : null;
    const upNextTime = next?.time || null;

    if (entry.live) {
      const m = entry.live;
      const a = m.scoreA ?? [];
      const b = m.scoreB ?? [];
      /* applyLiveScores appends the set on court to the finished ones, so
       * the last entry is the running score and everything before it is a
       * result. The card shows those separately — big numbers for the set
       * being played, chips for the ones already won. */
      const setCount = Math.max(a.length, b.length);
      const finished = Math.max(setCount - 1, 0);
      const sets: (SetScore | null)[] = [];
      for (let i = 0; i < SET_COLUMNS; i++) {
        sets.push(i < finished ? { a: a[i] ?? 0, b: b[i] ?? 0 } : null);
      }
      rows.push({
        court,
        division: m.division,
        teamA: playerNames(m.teamA),
        teamB: playerNames(m.teamB),
        scoreA: setCount ? a[setCount - 1] ?? 0 : 0,
        scoreB: setCount ? b[setCount - 1] ?? 0 : 0,
        lastScorer: m.lastScorer ?? null,
        startedAt: m.startedAt ?? null,
        sets,
        hasLive: true,
        upNext,
        upNextTime,
      });
    } else if (next) {
      rows.push({
        court,
        division: next.division,
        teamA: '',
        teamB: '',
        scoreA: null,
        scoreB: null,
        lastScorer: null,
        startedAt: null,
        sets: Array(SET_COLUMNS).fill(null),
        hasLive: false,
        upNext,
        upNextTime,
      });
    }
  }

  rows.sort((x, y) => Number(y.hasLive) - Number(x.hasLive) || x.court.localeCompare(y.court, undefined, { numeric: true }));
  return rows;
}

export default function OrganizerDashboard() {
  const [activeTab, setActiveTab] = useState<'tournament' | 'history' | 'notifications'>('tournament');
  const [tournaments, setTournaments] = useState<DashboardTournament[]>([]);
  const [organizer, setOrganizer] = useState<Organizer | null>(null);
  const [qrOpen, setQrOpen] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveDetails, setLiveDetails] = useState<Record<string, TournamentDetail>>({});
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [filterMenuOpen]);

  // Mobile navbar morph, driven by scroll *events* rather than scroll
  // *distance*: --enter-t and --compact-t are always snapped straight to
  // 0 or 1, never a fraction. Tying them proportionally to scrollY used
  // to leave the bar visibly stuck mid-morph if the user scrolled a
  // little and stopped; flipping a flag and letting the existing 200ms
  // CSS transition run to completion means every scroll always ends in
  // a fully-settled state. --enter-t: 1 once scrolled away from the very
  // top, 0 back at the top. --compact-t: 1 the moment a downward scroll
  // is detected, 0 the moment an upward scroll is detected (regardless
  // of depth) — direction only, not position. Written straight to the
  // DOM (not React state) so it stays glued to scroll events without a
  // re-render per pixel.
  useEffect(() => {
    const topThreshold = 4;
    let lastY = window.scrollY;
    let wasScrolled = lastY > topThreshold;

    const handleScroll = () => {
      if (window.innerWidth >= 960) return;
      const y = window.scrollY;
      const nav = navRef.current;
      if (!nav) return;

      const isScrolled = y > topThreshold;
      // Returning all the way to the top gets a slower, more deliberate
      // morph back to the flush rectangle header; every other transition
      // (compacting, expanding mid-page) stays quick. Only touch --nav-dur
      // when the scrolled/not-scrolled state actually flips — html has
      // scroll-behavior: smooth, so a single scroll gesture fires many
      // scroll events, and re-evaluating on every one of them was
      // stomping the slow duration back to fast before it could finish.
      if (isScrolled !== wasScrolled) {
        const returningToTop = wasScrolled && !isScrolled;
        nav.style.setProperty('--nav-dur', returningToTop ? '550ms' : '200ms');
        wasScrolled = isScrolled;
      }

      nav.style.setProperty('--enter-t', isScrolled ? '1' : '0');
      if (y > lastY) {
        nav.style.setProperty('--compact-t', isScrolled ? '1' : '0');
      } else if (y < lastY) {
        nav.style.setProperty('--compact-t', '0');
      }
      lastY = y;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  useEffect(() => {
    getDashboardTournaments().then(setTournaments).catch(console.error);
    fetch('/api/organizer').then(r => r.json()).then(setOrganizer).catch(console.error);
  }, []);

  const liveTournaments = useMemo(
    () => tournaments.filter(isLiveNow),
    [tournaments]
  );

  const pastTournaments = useMemo(
    () => tournaments.filter(isCompleted).sort((a, b) => (b.endDate || b.startDate).localeCompare(a.endDate || a.startDate)),
    [tournaments]
  );

  // Poll live tournament details for court scores
  useEffect(() => {
    if (liveTournaments.length === 0) return;
    let cancelled = false;

    /* Postgres only carries finalized scores, so the court board would show
     * dashes for a match in progress. Pull the live numbers alongside the
     * detail and fold them in before the rows are built. */
    const load = () => {
      Promise.all(liveTournaments.map(async t => {
        const [detail, live] = await Promise.all([
          getTournamentDetail(t.id).catch(() => null),
          fetchLiveScores(t.id),
        ]);
        return detail ? applyLiveScores(detail, live) : null;
      }))
        .then(details => {
          if (cancelled) return;
          const map: Record<string, TournamentDetail> = {};
          details.forEach(d => { if (d) map[d.slug] = d; });
          setLiveDetails(map);
        });
    };

    load();
    const timer = setInterval(load, LIVE_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [liveTournaments]);

  const liveIds = new Set(liveTournaments.map(t => t.id));
  const visibleTournaments = tournaments
    .filter(t => !liveIds.has(t.id) && matchesFilter(t, statusFilter) && matchesQuery(t, query))
    .sort(byNearestEvent);

  return (
    <div className={styles.page}>
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside ref={navRef} className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label="Live Bracket home">
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
          <span className={styles.brandName}>Live Bracket</span>
          <Home size={22} className={styles.brandHomeIcon} aria-hidden="true" />
        </Link>

        <nav className={styles.sideNav}>
          <button
            type="button"
            onClick={() => setActiveTab('tournament')}
            className={`${styles.sideLink} ${activeTab === 'tournament' ? styles.sideLinkActive : ''}`}
          >
            <Trophy size={20} />
            <span>My Tournament</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`${styles.sideLink} ${activeTab === 'history' ? styles.sideLinkActive : ''}`}
          >
            <History size={20} />
            <span>History</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={`${styles.sideLink} ${activeTab === 'notifications' ? styles.sideLinkActive : ''}`}
          >
            <Bell size={20} />
            <span>Notifications</span>
          </button>
        </nav>

        <Link href="/profile" className={styles.sideProfile}>
          <span className={styles.sideAvatar}>
            {organizer?.avatar_url ? (
              <img src={organizer.avatar_url} alt="" />
            ) : '🏐'}
          </span>
          <span className={styles.sideProfileText}>
            <span className={styles.sideProfileName}>{organizer?.name ?? '—'}</span>
            <span className={styles.sideProfileClub}>{organizer?.club ?? ''}</span>
          </span>
        </Link>
      </aside>

      {/* ── Main area ─────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <p className={styles.headerEyebrow}>Organizer dashboard</p>
            <h1 className={styles.headerTitle}>Welcome back{organizer ? `, ${organizer.name.split(' ')[0]}` : ''}</h1>
          </div>
          <Button
            variant="primary"
            iconLeft={<Plus size={18} />}
            onClick={() => setCreateOpen(true)}
            className={styles.newTournamentBtn}
          >
            New Tournament
          </Button>
        </div>

        {activeTab === 'tournament' && (
          <>
            {/* Featured live hero + courts table */}
            {liveTournaments.map(t => {
              const detail = liveDetails[t.id] ?? null;
              return (
                <section key={t.id} className={styles.liveSection}>
                  <div className={styles.hero}>
                    <div className={styles.heroBg} aria-hidden="true">
                      {t.imageUrl && <img src={t.imageUrl} alt="" />}
                    </div>
                    <div className={styles.heroScrim} aria-hidden="true" />
                    <div className={styles.heroContent}>
                      {/* The hero identifies the tournament and nothing more —
                          what's actually on court is the board's job, right
                          below, where it isn't competing with the artwork. */}
                      <div className={styles.heroTopRow}>
                        <span className={styles.livePill}>
                          <span className={styles.livePillDot} aria-hidden="true" />
                          Live now
                        </span>
                      </div>
                      <h2 className={styles.heroTitle}>{t.title}</h2>
                      <div className={styles.heroMeta}>
                        <span><Calendar size={16} /> {t.date}</span>
                        <span><MapPin size={16} /> {t.location}</span>
                      </div>
                      <div className={styles.heroActions}>
                        <Link href={`/dashboard/tournament/${t.id}`} className={styles.heroPrimaryBtn}>
                          <Trophy size={16} /> Open Bracket
                        </Link>
                        <Link href={`/dashboard/tournament/${t.id}/schedule`} className={styles.heroGhostBtn}>
                          <Calendar size={16} /> Schedule
                        </Link>
                        <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.heroGhostBtn}>
                          <Settings size={16} /> Manage Setup
                        </Link>
                      </div>
                    </div>
                  </div>

                  <CourtCards detail={detail} />
                  <CourtQrCard slug={t.id} />
                </section>
              );
            })}

            {/* Tournament list */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>All Tournaments</h2>
              </div>

              <SearchField
                placeholder="Search tournaments, locations, divisions"
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ marginBottom: 18, background: 'var(--sand-200)' }}
              />

              <div className={styles.filterTabs}>
                {STATUS_FILTERS.map(f => {
                  const count = tournaments.filter(t => !liveIds.has(t.id) && matchesFilter(t, f.key)).length;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      className={`${styles.filterTab} ${statusFilter === f.key ? styles.filterTabActive : ''}`}
                      onClick={() => setStatusFilter(statusFilter === f.key ? null : f.key)}
                    >
                      {f.label}
                      <span className={styles.filterCount}>{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className={styles.filterDropdown} ref={filterMenuRef}>
                <motion.button
                  type="button"
                  className={styles.filterDropdownTrigger}
                  aria-haspopup="listbox"
                  aria-expanded={filterMenuOpen}
                  onClick={() => setFilterMenuOpen(o => !o)}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                >
                  <span>
                    {STATUS_FILTERS.find(f => f.key === statusFilter)?.label || 'All'}
                    <span className={styles.filterCount}>
                      {tournaments.filter(t => !liveIds.has(t.id) && matchesFilter(t, statusFilter)).length}
                    </span>
                  </span>
                  <ChevronDown size={18} className={filterMenuOpen ? styles.filterChevronOpen : ''} />
                </motion.button>
                <AnimatePresence>
                  {filterMenuOpen && (
                    <motion.ul
                      className={styles.filterDropdownMenu}
                      role="listbox"
                      style={{ transformOrigin: 'top left' }}
                      initial={{ opacity: 0, scale: 0.3, borderRadius: 999 }}
                      animate={{ opacity: 1, scale: 1, borderRadius: 16 }}
                      exit={{ opacity: 0, scale: 0.3, borderRadius: 999, transition: { duration: 0.28, ease: 'easeIn' } }}
                      transition={{ type: 'spring', stiffness: 105, damping: 11 }}
                    >
                      {STATUS_FILTERS.map(f => {
                        const count = tournaments.filter(t => !liveIds.has(t.id) && matchesFilter(t, f.key)).length;
                        const active = statusFilter === f.key;
                        return (
                          <li key={f.key} role="option" aria-selected={active}>
                            <button
                              type="button"
                              className={`${styles.filterDropdownItem} ${active ? styles.filterDropdownItemActive : ''}`}
                              onClick={() => {
                                setStatusFilter(active ? null : f.key);
                                setFilterMenuOpen(false);
                              }}
                            >
                              {f.label}
                              <span className={styles.filterCount}>{count}</span>
                            </button>
                          </li>
                        );
                      })}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              <div className={styles.rowList}>
                {visibleTournaments.length === 0 && (
                  <p className={styles.filterEmpty}>No tournaments match.</p>
                )}
                {visibleTournaments.map(t => (
                  <TournamentRow
                    key={t.id}
                    t={t}
                    expanded={expandedId === t.id}
                    onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    qrOpen={qrOpen}
                    setQrOpen={setQrOpen}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'history' && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Past Tournaments</h2>
            </div>
            <div className={styles.rowList}>
              {pastTournaments.length === 0 && (
                <p className={styles.filterEmpty}>No past tournaments found.</p>
              )}
              {pastTournaments.map(t => (
                <TournamentRow
                  key={t.id}
                  t={t}
                  expanded={expandedId === t.id}
                  onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  qrOpen={null}
                  setQrOpen={() => {}}
                  hideQr
                />
              ))}
            </div>
          </section>
        )}

        {activeTab === 'notifications' && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Notifications</h2>
            </div>
            <p className={styles.filterEmpty}>No new notifications.</p>
          </section>
        )}
      </main>

      <CreateTournamentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/* ── Live courts table ──────────────────────────────────────────── */

function CourtCards({ detail }: { detail: TournamentDetail | null }) {
  const rows = useMemo(() => (detail ? buildCourtRows(detail) : []), [detail]);
  const liveCount = rows.filter(r => r.hasLive).length;

  /* The board polls every 15s, but a duration has to move every second to
   * read as running. Ticking `now` is enough — the origin is fixed. */
  const anyRunning = rows.some(r => r.startedAt !== null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  if (!detail) {
    return <div className={styles.courtsEmpty}>Loading court activity…</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.courtsEmpty}>No matches on court right now.</div>;
  }

  return (
    <>
      <div className={styles.courtsHeader}>
        <h2 className={styles.courtsHeading}>Court Activity</h2>
        {liveCount > 0 && (
          <span className={styles.courtsLiveCount}>
            <span className={styles.courtsLiveCountDot} aria-hidden="true" />
            {liveCount} {liveCount === 1 ? 'Match' : 'Matches'} Live
          </span>
        )}
      </div>

      <div className={styles.courtsGrid}>
        {rows.map(r => {
          /* The accent marks whoever won the last point rather than whoever
           * leads — on a board that refreshes every few seconds, where the
           * score just moved is the thing worth spotting. */
          const scoredA = r.lastScorer === 'a';
          const scoredB = r.lastScorer === 'b';
          return (
            <article key={r.court} className={styles.courtCard}>
              <div className={styles.courtCardHead}>
                <span className={`${styles.courtCardName} ${r.hasLive ? '' : styles.courtCardNameIdle}`}>
                  {r.court}
                </span>
                {r.hasLive ? (
                  <span className={styles.courtBadgeLive}>
                    <span className={styles.courtBadgeLiveDot} aria-hidden="true" />
                    Live
                  </span>
                ) : (
                  <span className={styles.courtBadgeFree}>Free</span>
                )}
              </div>

              {r.hasLive ? (
                <div className={styles.courtBoard}>
                  <div className={styles.courtBoardHead}>
                    <span className={styles.courtBoardClock}>
                      <Clock size={12} aria-hidden="true" />
                      {/* Null until the first point — the clock starts when
                          play does, not when the match was scheduled. */}
                      {(() => {
                        const secs = elapsedSeconds(r.startedAt, now);
                        return secs === null ? '--:--' : formatClock(secs);
                      })()}
                    </span>
                    <span className={styles.courtBoardDivision}>{r.division}</span>
                  </div>

                  <div className={styles.courtTeamRow}>
                    <span className={`${styles.courtTeamName} ${scoredA ? styles.courtTeamScored : ''}`}>
                      {r.teamA}
                    </span>
                    <span className={`${styles.courtTeamScore} ${scoredA ? styles.courtTeamScored : ''}`}>
                      {r.scoreA}
                    </span>
                  </div>
                  <div className={styles.courtBoardDivider} aria-hidden="true" />
                  <div className={styles.courtTeamRow}>
                    <span className={`${styles.courtTeamName} ${scoredB ? styles.courtTeamScored : ''}`}>
                      {r.teamB}
                    </span>
                    <span className={`${styles.courtTeamScore} ${scoredB ? styles.courtTeamScored : ''}`}>
                      {r.scoreB}
                    </span>
                  </div>

                  <div className={styles.courtSetRow}>
                    {r.sets.map((set, i) => (
                      <div key={i} className={`${styles.courtSetChip} ${set ? '' : styles.courtSetChipEmpty}`}>
                        <span className={styles.courtSetLabel}>Set {i + 1}</span>
                        <span className={`${styles.courtSetValue} ${set ? '' : styles.courtSetValueEmpty}`}>
                          {set ? `${set.a}–${set.b}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={styles.courtFree}>
                  <span className={styles.courtFreeTitle}>Court free</span>
                  <span className={styles.courtFreeNext}>
                    {r.upNextTime ? `Next match at ${r.upNextTime}` : 'Nothing scheduled yet'}
                  </span>
                </div>
              )}

              <div className={styles.courtNext}>
                <span className={styles.courtNextLabel}>
                  Up next{r.upNextTime ? ` · ${r.upNextTime}` : ''}
                </span>
                <span className={styles.courtNextValue}>{r.upNext ?? 'Nothing queued'}</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ── Scorekeeper codes for the live tournament ──────────────────── */

/* Sits under the court board, keyed by the same thing the board is keyed
 * by: the court. The board says what's happening on each court; this says
 * how to score it. Kept as its own card rather than a column on the board
 * so the board stays a scannable text table.
 *
 * Renders nothing at all when there's no code to show — an empty card
 * under a live board would just read as something broken. */
function CourtQrCard({ slug }: { slug: string }) {
  const { matches, loading, error } = useScorekeeperLinks(slug);
  const { exportAll, exporting, error: exportError } = useQrPdfExport(slug);
  // Starts collapsed: the court board above is what an organizer came to
  // read, and the codes are a thing you go and get when you need one.
  const [open, setOpen] = useState(false);

  if (loading) return <div className={styles.courtsEmpty}>Loading scorekeeper QR…</div>;
  if (error || matches.length === 0) return null;

  // Rows are one per court, not one per match — count what's actually shown.
  const courtCount = nextPerCourt(matches).length;

  return (
    <section className={styles.courtQrCard}>
      <div className={styles.courtQrHead}>
        <div className={styles.courtQrHeadText}>
          <h3 className={styles.courtQrTitle}>Scorekeeper QR</h3>
          <p className={styles.courtQrNote}>
            Next match on each court. Anyone with the link can enter scores — share it only
            with your scorekeeper.
          </p>
        </div>
        <div className={styles.courtQrActions}>
          {/* The live tournament is filtered out of the list below, so this is
              the only place its printable sheet can be reached. */}
          <Button variant="primary" size="small" onClick={exportAll} disabled={exporting}>
            {exporting ? 'Building PDF…' : 'Export all (PDF)'}
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={open ? 'Collapse scorekeeper QR' : 'Expand scorekeeper QR'}
            style={{ width: 36, height: 36, padding: 0 }}
          >
            <span className={`${styles.courtQrChevron} ${open ? styles.courtQrChevronOpen : ''}`}>
              <ChevronDown size={18} />
            </span>
          </Button>
        </div>
      </div>

      {!open && (
        <div className={styles.courtQrSummary}>
          <span className={styles.courtQrCount}>
            {courtCount} {courtCount === 1 ? 'court' : 'courts'}
          </span>
          <span className={styles.courtQrDot} aria-hidden="true" />
          <span>One code per match — regenerated for each new pairing.</span>
        </div>
      )}

      {open && (
        <>
          {exportError && <p className={styles.qrExportError}>{exportError}</p>}
          <div className={styles.courtQrRows}>
            <ScorekeeperQrCards matches={matches} />
          </div>
          <div className={styles.courtQrFoot}>
            <Bell size={16} aria-hidden="true" />
            <span>
              Each code is unique to one match. Codes rotate when a match ends — reprint
              after the round.
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/* ── Compact tournament row (expandable) ────────────────────────── */

function TournamentRow({
  t,
  expanded,
  onToggle,
  qrOpen,
  setQrOpen,
  hideQr = false,
}: {
  t: CardTournament;
  expanded: boolean;
  onToggle: () => void;
  qrOpen: string | null;
  setQrOpen: (v: string | null) => void;
  hideQr?: boolean;
}) {
  const pill = statusPill(t);
  const isLive = isLiveNow(t);

  return (
    <div className={`${styles.row} ${expanded ? styles.rowExpanded : ''}`}>
      <div
        role="button"
        tabIndex={0}
        className={styles.rowMain}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
      >
        <span className={styles.rowThumb} aria-hidden="true">
          {t.imageUrl ? (
            <img src={t.imageUrl} alt="" className={styles.rowThumbImg} />
          ) : (
            <span className={styles.rowThumbInitials}>{locationInitials(t.location)}</span>
          )}
        </span>

        <span className={styles.rowInfo}>
          <span className={styles.rowPills}>
            <span className={`${styles.pill} ${pill.cls}`}>{pill.label}</span>
            {isLive && (
              <span className={styles.rowLive}>
                <span className={styles.rowLiveDot} aria-hidden="true" /> Live
              </span>
            )}
            <span className={styles.rowDate}>{t.date}</span>
          </span>
          <span className={styles.rowTitle}>{t.title}</span>
          <span className={styles.rowMeta}>
            <span>{t.location}</span>
            <span className={styles.rowMetaDot} aria-hidden="true">•</span>
            <span>{t.divisions.length} division{t.divisions.length === 1 ? '' : 's'}</span>
          </span>
        </span>

        <span className={styles.rowActions} onClick={e => e.stopPropagation()}>
          {!hideQr && (
            <button
              type="button"
              className={styles.iconBtn}
              title="Generate scorekeeper QR"
              onClick={() => setQrOpen(qrOpen === t.id ? null : t.id)}
            >
              <QrCode size={18} />
            </button>
          )}
          <Link href={`/dashboard/tournament/${t.id}`} className={styles.rowBracketBtn}>
            <Trophy size={15} /> Bracket
          </Link>
          <Link href={`/dashboard/tournament/${t.id}/schedule`} className={styles.rowBracketBtn}>
            <Calendar size={15} /> Schedule
          </Link>
          <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.iconBtn} title="Manage setup" aria-label="Manage setup">
            <Settings size={18} />
          </Link>
        </span>

        <ChevronDown size={18} className={styles.rowChevron} aria-hidden="true" />
      </div>

      {qrOpen === t.id && (
        <ScorekeeperQrPanel slug={t.id} onClose={() => setQrOpen(null)} />
      )}

      {expanded && (
        <div className={styles.rowExpand}>
          {t.divisions.length === 0 ? (
            <p className={styles.divEmpty}>No divisions added yet.</p>
          ) : (
            <div className={styles.divStatGrid}>
              {t.divisions.map(d => {
                const pct = d.cap > 0 ? Math.min(100, Math.round((d.filled / d.cap) * 100)) : 0;
                const spotsLeft = Math.max(0, d.cap - d.filled);
                const full = d.cap > 0 && d.filled >= d.cap;
                return (
                  <div key={d.name} className={styles.divStat}>
                    <div className={styles.divStatTop}>
                      <span className={styles.divStatName}>{d.name}</span>
                      <span className={`${styles.divStatBadge} ${full ? styles.divStatBadgeFull : ''}`}>
                        {full ? 'Full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
                      </span>
                    </div>
                    <div className={styles.divStatValue}>
                      {d.filled}<span className={styles.divStatCap}>/{d.cap} teams</span>
                    </div>
                    <div className={styles.divStatBar}>
                      <span
                        className={`${styles.divStatFill} ${full ? styles.divStatFillFull : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
