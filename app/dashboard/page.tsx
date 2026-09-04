'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Plus, QrCode, Trophy, Settings, Calendar, MapPin, Bell, ChevronDown, Home, Clock,
  LayoutList, Menu, Users, Globe,
} from 'lucide-react';
import styles from './page.module.css';
import CreateTournamentModal from './CreateTournamentModal';
import OrganizerProfileModal from './OrganizerProfileModal';
import ScorekeeperQrPanel from './ScorekeeperQrPanel';
import ScorekeeperQrModal from './ScorekeeperQrModal';
import PublishTournamentModal from '@/components/PublishTournamentModal';
import QrCodeImage from '@/components/QrCodeImage';
import { useScorekeeperLinks, ScorekeeperQrZoom, type ZoomedCode } from '@/components/ScorekeeperQrCards';
import { nextPerCourt } from '../../lib/scorekeeperLinks';
import { Button, SearchField, Icon, Badge, BracketIcon } from '../../components/livebracket-ds';
import {
  getDashboardTournaments, getTournamentDetail, todayLocal,
  type DashboardTournament, type TournamentDetail,
} from '../../lib/data';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../components/auth/AuthProvider';
import { fetchLiveScores, applyLiveScores } from '../../lib/liveScores';
import { buildCourtRows } from '../../lib/courtRows';
import { elapsedSeconds, formatClock } from '../../lib/matchClock';
import { isPublic, type Phase, registrationState } from '../../lib/tournamentLifecycle';

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
/* The More menu's destinations. The first three still lead nowhere and stay
 * disabled; "Log out" is real now that there is a session to end, and is the
 * organizer's only way out of the dashboard. */
const MORE_ITEMS = ['Settings', 'Saved brackets', 'Switch club'];

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'announced', label: 'Announced' },
  { key: 'open', label: 'Registration open' },
  { key: 'closed', label: 'Registration closed' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
] as const;

type StatusKey = (typeof STATUS_FILTERS)[number]['key'];

type CardTournament = DashboardTournament;

function isCompleted(t: CardTournament): boolean {
  return (t.endDate || t.startDate) < TODAY;
}

function getTournamentStatus(t: CardTournament): {
  key: 'draft' | 'announced' | 'open' | 'waitlist' | 'closed' | 'completed' | 'archived';
  label: string;
  variant: 'status' | 'highlight' | 'open' | 'live' | 'outline';
} {
  // 0. Archived
  if (t.archived) {
    return { key: 'archived', label: 'Archived', variant: 'status' };
  }

  // 1. Draft phase (not public)
  if (t.phase === 1 || !isPublic(t.phase as Phase)) {
    return { key: 'draft', label: 'Draft', variant: 'status' };
  }

  // 2. Completed (past end date)
  if (isCompleted(t)) {
    return { key: 'completed', label: 'Completed', variant: 'status' };
  }

  // 3. Derived from divisions for published tournament
  if (!t.divisions || t.divisions.length === 0) {
    return { key: 'announced', label: 'Announced', variant: 'highlight' };
  }

  const regState = registrationState(
    t.divisions.map((d) => ({
      registrationOpens: d.registrationOpens || '',
      registrationCloses: d.registrationCloses || '',
    })),
    new Date(),
  );

  if (regState === 'opens-soon') {
    return { key: 'announced', label: 'Announced', variant: 'highlight' };
  }

  if (regState === 'closed') {
    return { key: 'closed', label: 'Registration closed', variant: 'status' };
  }

  // regState is 'open'
  // Check if all divisions are full
  const allFull = t.divisions.every((d) => d.cap > 0 && d.filled >= d.cap);
  if (allFull) {
    return { key: 'waitlist', label: 'Waitlist open', variant: 'highlight' };
  }

  return { key: 'open', label: 'Registration open', variant: 'open' };
}

function matchesFilter(t: CardTournament, key: StatusKey | null): boolean {
  if (key === 'archived') return t.archived;
  // Exclude archived tournaments from active filters
  if (t.archived) return false;

  // Default (no filter selected): upcoming events only — completed
  // tournaments stay hidden until their filter is chosen. Drafts show, so a
  // freshly created tournament is visible immediately.
  if (key === null) return !isCompleted(t);
  if (key === 'all') return true;
  const status = getTournamentStatus(t);
  if (key === 'draft') return status.key === 'draft';
  if (isCompleted(t)) return false;
  if (key === 'open') return status.key === 'open' || status.key === 'waitlist';
  if (key === 'closed') return status.key === 'closed';
  if (key === 'announced') return status.key === 'announced';
  return true;
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

/* ── Live courts model is in lib/courtRows ───────────────────────── */

export default function OrganizerDashboard() {
  const [activeTab, setActiveTab] = useState<'tournament' | 'history' | 'notifications'>('tournament');
  const [tournaments, setTournaments] = useState<DashboardTournament[]>([]);
  const [organizer, setOrganizer] = useState<Organizer | null>(null);
  /* Resolved on the server in app/layout.tsx and handed down by
   * AuthProvider — the dashboard used to re-fetch /api/auth/session for
   * this one id on every mount. `organizer` here is the ORGANIZER
   * identity, which is a different profile from the player one the site
   * header shows; see lib/session.ts. */
  const { organizerId, organizer: organizerIdentity } = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /* The rail rests collapsed to icons and widens on hover — that part is
   * pure CSS, so it costs no re-render. Pinning is the way to hold it open
   * without a mouse: hover and :focus-within are unavailable to touch, and
   * focus alone would close it again the moment you tab out. Only
   * meaningful above 960px, where the sidebar is a rail at all. */
  const [pinned, setPinned] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  /* No notifications exist yet, so the badge stays off rather than showing
   * a decorative number. Point this at the real count when they land. */
  const notificationCount = 0;
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveDetails, setLiveDetails] = useState<Record<string, TournamentDetail>>({});
  const searchWrapRef = useRef<HTMLDivElement>(null);

  /* Search has no view of its own: it takes you to the list the field
   * filters and puts the cursor in it.
   *
   * When the tab has to change first, the field does not exist yet, so the
   * focus waits for the render that creates it — tracked on a ref rather
   * than in state, which would cost an extra render per click. */
  const wantSearchFocus = useRef(false);

  const putCursorInSearch = () => {
    const input = searchWrapRef.current?.querySelector('input');
    input?.focus();
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const focusSearch = () => {
    setMoreOpen(false);
    if (activeTab === 'tournament') {
      putCursorInSearch();          // already rendered
    } else {
      wantSearchFocus.current = true;
      setActiveTab('tournament');
    }
  };

  useEffect(() => {
    if (!wantSearchFocus.current) return;
    wantSearchFocus.current = false;
    putCursorInSearch();
  }, [activeTab]);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close the More menu on an outside click or Escape, like the other menus.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);


  const [publishingTournament, setPublishingTournament] = useState<CardTournament | null>(null);
  const [scorekeeperModalTournament, setScorekeeperModalTournament] = useState<{ id: string; title: string } | null>(null);

  const refreshTournaments = async () => {
    if (!organizerId) return;
    try {
      const rows = await getDashboardTournaments(organizerId);
      setTournaments(rows);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    /* The organizer id has to arrive before the tournaments can be asked
     * for — the listing is scoped to it now, rather than returning every
     * event in the database the way it did under the single demo
     * organizer. It comes from the session the root layout already
     * resolved, so there is no round trip to wait on; and
     * app/dashboard/layout.tsx has established that whoever is here is an
     * organizer, so this only fails on a network error. */
    let cancelled = false;
    if (!organizerId) return;

    (async () => {
      try {
        const [org, rows] = await Promise.all([
          fetch('/api/organizer').then(r => r.json()),
          getDashboardTournaments(organizerId),
        ]);
        if (cancelled) return;
        setOrganizer(org);
        setTournaments(rows);
      } catch (err) {
        console.error(err);
      }
    })();

    return () => { cancelled = true; };
  }, [organizerId]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      /* Both halves matter: signOut() clears the browser copy, the route
       * clears the cookie that middleware and the server components read. */
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      window.location.href = '/login';
    }
  };

  const liveTournaments = useMemo(
    () => tournaments.filter(t => !t.archived && isLiveNow(t)),
    [tournaments]
  );

  const pastTournaments = useMemo(
    () => tournaments.filter(t => !t.archived && isCompleted(t)).sort((a, b) => (b.endDate || b.startDate).localeCompare(a.endDate || a.startDate)),
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
      <aside className={`${styles.sidebar} ${pinned ? styles.sidebarPinned : ''}`}>
        {/* Desktop: the logo row is the rail's collapse handle, per the
            design. Mobile: the bar has no rail, so the same slot is the
            Home link it has always been — see the 960px block in the CSS. */}
        <button
          type="button"
          className={styles.brand}
          onClick={() => { setPinned(v => !v); setMoreOpen(false); }}
          aria-pressed={pinned}
          title={pinned ? 'Unpin sidebar' : 'Keep sidebar open'}
        >
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
          <span className={styles.brandName}>LIVE BRACKET</span>
        </button>
        {/* Mobile only — below 960px the rail becomes a bar with nothing to
            collapse, so this slot replaces the brand button (see the CSS).
            "Home" here means the organizer's own dashboard, not the public
            site: someone inside the organizer area who taps a house wants
            their events list, not the marketing page. */}
        <Link href="/dashboard" className={styles.brandHome} aria-label="Dashboard home">
          <Home size={22} className={styles.brandHomeIcon} aria-hidden="true" />
        </Link>

        {/* The nav sits centred between two spacers, per the design. */}
        <div className={styles.railSpacer} />

        <nav className={styles.sideNav}>
          <button
            type="button"
            onClick={() => setActiveTab('tournament')}
            className={`${styles.sideLink} ${styles.sideLinkDesktopOnly} ${styles.navTournaments} ${activeTab === 'tournament' ? styles.sideLinkActive : ''}`}
            title="My Tournament"
          >
            <span className={styles.sideIcon}>
              {/* A list, not a trophy. The trophy read as "prizes" or
                  "winners"; this tab is the organizer's list of their own
                  events, and a list icon says that without a caption. */}
              <LayoutList size={23} strokeWidth={activeTab === 'tournament' ? 2.6 : 1.75} />
            </span>
            <span className={styles.sideLabel}>My Tournament</span>
          </button>

          {/* Search is not a view of its own — it jumps to the list and puts
              the cursor in the field that filters it. */}
          <button
            type="button"
            onClick={focusSearch}
            className={`${styles.sideLink} ${styles.sideLinkDesktopOnly}`}
            title="Search"
          >
            <span className={styles.sideIcon}>
              <Icon name="search" size={23} strokeWidth={1.75} />
            </span>
            <span className={styles.sideLabel}>Search</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`${styles.sideLink} ${styles.sideLinkDesktopOnly} ${activeTab === 'history' ? styles.sideLinkActive : ''}`}
            title="History"
          >
            <span className={styles.sideIcon}>
              <Icon name="calendar" size={23} strokeWidth={activeTab === 'history' ? 2.6 : 1.75} />
            </span>
            <span className={styles.sideLabel}>History</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={`${styles.sideLink} ${styles.sideLinkDesktopOnly} ${styles.navNotifications} ${activeTab === 'notifications' ? styles.sideLinkActive : ''}`}
            title="Notifications"
          >
            <span className={styles.sideIcon}>
              <Icon name="bell" size={23} strokeWidth={activeTab === 'notifications' ? 2.6 : 1.75} />
              {/* Reads off the real count, which is zero until notifications
                  exist — so no badge rather than a decorative one. */}
              {notificationCount > 0 && (
                <span className={styles.sideBadge}>{notificationCount}</span>
              )}
            </span>
            <span className={styles.sideLabel}>Notifications</span>
          </button>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className={`${styles.sideLink} ${styles.sideLinkDesktopOnly}`}
            title="Create"
          >
            <span className={styles.sideIcon}>
              <Icon name="plus" size={23} strokeWidth={1.75} />
            </span>
            <span className={styles.sideLabel}>Create</span>
          </button>

          {/* Inside the dashboard, "Profile" means the organizer identity —
              the name and photo on the public event pages — not the player
              profile at /profile, which the site header links to. */}
          <button
            type="button"
            className={`${styles.sideLink} ${styles.navProfile}`}
            title="Organizer profile"
            onClick={() => setProfileOpen(true)}
          >
            <span className={styles.sideIcon}>
              <span className={styles.sideAvatar}>
                {organizerIdentity?.avatarUrl
                  ? <img src={organizerIdentity.avatarUrl} alt="" />
                  : '🏐'}
              </span>
            </span>
            <span className={styles.sideLabel}>Profile</span>
          </button>
        </nav>

        <div className={styles.railSpacer} />

        <div className={styles.moreWrap} ref={moreRef}>
          {moreOpen && (
            <div className={styles.morePopup} role="menu">
              {/* Everything the phone bar cannot hold lives here instead.
                  The bar is down to the menu and the profile now, so My
                  Tournament and Notifications join History in the menu —
                  all three hidden on desktop, where the rail shows them
                  directly. */}
              <button
                type="button"
                className={`${styles.moreItem} ${styles.moreItemMobileOnly}`}
                role="menuitem"
                onClick={() => { setActiveTab('tournament'); setMoreOpen(false); }}
              >
                My Tournament
              </button>
              <button
                type="button"
                className={`${styles.moreItem} ${styles.moreItemMobileOnly}`}
                role="menuitem"
                onClick={() => { setActiveTab('notifications'); setMoreOpen(false); }}
              >
                {/* The count comes along, since the badge it used to wear
                    on the bar is not there to carry it any more. */}
                Notifications{notificationCount > 0 ? ` (${notificationCount})` : ''}
              </button>
              <button
                type="button"
                className={`${styles.moreItem} ${styles.moreItemMobileOnly}`}
                role="menuitem"
                onClick={() => { setActiveTab('history'); setMoreOpen(false); }}
              >
                History
              </button>
              {/* Nothing behind these yet — shown disabled rather than as
                  links that go nowhere. */}
              {MORE_ITEMS.map(label => (
                <button key={label} type="button" className={styles.moreItem} disabled role="menuitem">
                  {label}
                </button>
              ))}
              <Link href="/profile" className={styles.moreItem} role="menuitem">
                Player profile
              </Link>
              <button
                type="button"
                className={styles.moreItem}
                role="menuitem"
                onClick={handleLogout}
              >
                Log out
              </button>
            </div>
          )}
          <button
            type="button"
            className={styles.sideLink}
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            title="Menu"
          >
            <span className={styles.sideIcon}>
              <Menu size={23} strokeWidth={1.9} />
            </span>
            <span className={styles.sideLabel}>Menu</span>
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerIdentity}>
            <p className={styles.headerEyebrow}>Organizer dashboard</p>
            {/* The organizer's own name, not a greeting. The session copy
                is the fallback because it is server-rendered and therefore
                already there — /api/organizer resolves a moment later, so
                leading with it would flash an empty heading. */}
            <h1 className={styles.headerTitle}>
              {organizer?.name ?? organizerIdentity?.name ?? 'Organizer'}
            </h1>
          </div>
          <Button
            variant="primary"
            size="small"
            iconLeft={<Plus size={15} />}
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
                      {/* Same shape as the tournament rows below: when and
                          how big on one line, where on the next. */}
                      <div className={styles.heroMeta}>
                        <div className={styles.heroMetaLine}>
                          <span><Calendar size={16} /> {t.date}</span>
                          <span><Users size={16} /> {t.divisions.length} division{t.divisions.length === 1 ? '' : 's'}</span>
                        </div>
                        <span><MapPin size={16} /> {t.location}</span>
                      </div>
                      {/* Schedule leads — on event day it is the thing an
                          organizer opens first — and is the only orange
                          pill here, so the running order reads at a glance.
                          The other three are white. */}
                      <div className={styles.heroActions}>
                        {/* New tab on purpose: on event day an organizer keeps
                            the live board up and dips into the bracket or the
                            schedule, rather than navigating away from it. */}
                        <Link
                          href={`/dashboard/tournament/${t.id}/schedule`}
                          className={styles.heroPrimaryBtn}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Calendar size={14} /> Schedule
                          <span className={styles.srOnly}>(opens in a new tab)</span>
                        </Link>
                        <Link
                          href={`/dashboard/tournament/${t.id}`}
                          className={styles.heroWhiteBtn}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <BracketIcon size={14} /> Bracket
                          <span className={styles.srOnly}>(opens in a new tab)</span>
                        </Link>
                        {/* Setup and Scorekeeper drop their labels on a
                            phone and become icon buttons, which is what
                            keeps all four hero actions on one line there. */}
                        <Link
                          href={`/dashboard/tournament/${t.id}/setup`}
                          className={`${styles.heroWhiteBtn} ${styles.heroCollapsingBtn}`}
                          aria-label="Setup"
                        >
                          <Settings size={14} />
                          <span className={styles.heroBtnLabel}>Setup</span>
                        </Link>
                        <button
                          type="button"
                          className={`${styles.heroWhiteBtn} ${styles.heroCollapsingBtn}`}
                          aria-label="Scorekeeper"
                          onClick={() => setScorekeeperModalTournament({ id: t.id, title: t.title })}
                        >
                          <QrCode size={14} />
                          <span className={styles.heroBtnLabel}>Scorekeeper</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <CourtCards detail={detail} />
                </section>
              );
            })}

            {/* Tournament list */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>All Tournaments</h2>
              </div>

              {/* Narrow screens run the search and the status filter on one
                  row (70/30); wide ones give the search the full width and
                  use the pill tabs below instead of the select. */}
              <div className={styles.searchRow}>
                {/* Wrapped so the sidebar's Search item can reach the input —
                    SearchField is a plain function component, so a ref passed
                    to it would not forward. */}
                <div ref={searchWrapRef} className={styles.searchWrap}>
                  <SearchField
                    placeholder={isMobile ? 'Search tournament' : 'Search tournaments, locations, divisions'}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    showMic={true}
                    style={{ background: 'var(--sand-200)' }}
                  />
                </div>

                {/* A native select, so the picker, its motion and its chrome
                    are the platform's rather than ours. */}
                <select
                  className={styles.filterSelect}
                  aria-label="Filter tournaments by status"
                  value={statusFilter ?? 'all'}
                  onChange={e => setStatusFilter(e.target.value as StatusKey)}
                >
                  {STATUS_FILTERS.map(f => {
                    const count = tournaments.filter(t => !liveIds.has(t.id) && matchesFilter(t, f.key)).length;
                    return (
                      <option key={f.key} value={f.key}>
                        {f.label} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>

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
                    onPublish={setPublishingTournament}
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

      <PublishTournamentModal
        open={!!publishingTournament}
        tournamentTitle={publishingTournament?.title ?? ''}
        tournamentSlug={publishingTournament?.id ?? ''}
        onClose={() => setPublishingTournament(null)}
        onPublished={refreshTournaments}
      />

      <OrganizerProfileModal
        open={profileOpen}
        organizer={organizerIdentity}
        onClose={() => setProfileOpen(false)}
        /* Mirrors the save into the header's own copy so the greeting and
           the rail avatar update without waiting for a refetch. */
        onSaved={saved => setOrganizer(o => (o ? { ...o, name: saved.name ?? o.name, avatar_url: saved.avatarUrl } : o))}
      />

      {scorekeeperModalTournament && (
        <ScorekeeperQrModal
          slug={scorekeeperModalTournament.id}
          tournamentTitle={scorekeeperModalTournament.title}
          onClose={() => setScorekeeperModalTournament(null)}
        />
      )}
    </div>
  );
}

/* ── Live courts table ──────────────────────────────────────────── */

function CourtCards({ detail }: { detail: TournamentDetail | null }) {
  const rows = useMemo(() => (detail ? buildCourtRows(detail) : []), [detail]);
  const liveCount = rows.filter(r => r.hasLive).length;

  /* The board knows what is on each court; it doesn't know the scoring
   * token, which is what a QR has to encode. nextPerCourt picks the one
   * match per court that needs a link right now — the running match, or
   * the next one up — so a court's code is the code a referee standing
   * there would want, in either state of the card. */
  const { matches } = useScorekeeperLinks(detail?.slug ?? null);
  const [origin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const linkByCourt = useMemo(() => new Map(nextPerCourt(matches)), [matches]);

  const [zoomed, setZoomed] = useState<ZoomedCode | null>(null);

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
          /* r.sets is padded to SET_COLUMNS with nulls for the sets not
           * played yet; only the finished ones go in front of the score. */
          const playedSets = r.sets.filter((set): set is NonNullable<typeof set> => set !== null);
          /* Undefined on a court with nothing left to play, and on the
             "Unassigned" bucket — buildCourtRows and the scorekeeper API
             name that bucket differently, and a match with no court has
             nowhere to tape a code anyway. Both fall back to text. */
          const link = linkByCourt.get(r.court);
          const url = link ? `${origin}/score/${link.token}` : null;
          return (
            <article key={r.court} className={styles.courtCard}>
              <div className={styles.courtCardHead}>
                {/* Name and status read as one phrase — "Court 2, live" —
                    so the badge sits against the name rather than being
                    pushed to the far edge. The corner belongs to the QR. */}
                <span className={`${styles.courtCardName} ${r.hasLive ? '' : styles.courtCardNameIdle}`}>
                  {r.court}
                </span>
                {r.hasLive ? (
                  <span className={styles.courtBadgeLive}>
                    <span className={styles.courtBadgeLiveDot} aria-hidden="true" />
                    Live
                  </span>
                ) : (
                  /* "Free" takes the corner rather than sitting against the
                     name. On an idle card the code is already in the middle
                     and is its own enlarge button, so the corner is free —
                     and the two states then differ at a glance: something
                     live on the left, an idle court marked on the right. */
                  <span className={styles.courtBadgeFree}>Free</span>
                )}
                {r.hasLive && url && link && (
                  <button
                    type="button"
                    className={styles.courtQrBtn}
                    onClick={() => setZoomed({ court: r.court, url, match: link })}
                    aria-label={`Enlarge the scorekeeper code for ${r.court}`}
                  >
                    <QrCode size={16} aria-hidden="true" />
                  </button>
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
                    {/* Which round, then which division — the two things
                        that place a match in the draw. The round is the
                        quieter of the pair: it changes through the day,
                        while the division is what the card belongs to. */}
                    {r.round && <span className={styles.courtBoardRound}>{r.round}</span>}
                    <span className={styles.courtBoardDivision}>{r.division}</span>
                  </div>

                  {/* On a phone each side's finished sets sit just in
                      front of its live score, the way the homepage hero
                      scoreboard reads — the SET chips below cost a third
                      of the card's height to say the same thing, and the
                      wide card keeps them. */}
                  <div className={styles.courtTeamRow}>
                    <span className={`${styles.courtTeamName} ${scoredA ? styles.courtTeamScored : ''}`}>
                      {r.teamA}
                    </span>
                    <span className={styles.courtTeamRight}>
                      {playedSets.map((set, i) => (
                        <span key={i} className={styles.courtPrevSet}>{set.a}</span>
                      ))}
                      <span className={`${styles.courtTeamScore} ${scoredA ? styles.courtTeamScored : ''}`}>
                        {r.scoreA}
                      </span>
                    </span>
                  </div>
                  <div className={styles.courtBoardDivider} aria-hidden="true" />
                  <div className={styles.courtTeamRow}>
                    <span className={`${styles.courtTeamName} ${scoredB ? styles.courtTeamScored : ''}`}>
                      {r.teamB}
                    </span>
                    <span className={styles.courtTeamRight}>
                      {playedSets.map((set, i) => (
                        <span key={i} className={styles.courtPrevSet}>{set.b}</span>
                      ))}
                      <span className={`${styles.courtTeamScore} ${scoredB ? styles.courtTeamScored : ''}`}>
                        {r.scoreB}
                      </span>
                    </span>
                  </div>

                  {/* The wide card has the room to label each set, so it
                      keeps the chips. Hidden on a phone, where the same
                      numbers ride in front of the scores above. */}
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
                  {/* An idle card has the room a live one doesn't, so the
                      code goes where the "Court free" message was: a
                      referee arriving at an empty court scans it off the
                      board instead of hunting for the QR panel. With
                      nothing scheduled there is no token, and the message
                      stays. */}
                  {url && link ? (
                    <button
                      type="button"
                      className={styles.courtFreeQr}
                      onClick={() => setZoomed({ court: r.court, url, match: link })}
                      aria-label={`Enlarge the scorekeeper code for ${r.court}`}
                    >
                      <QrCodeImage
                        value={url}
                        size={104}
                        className={styles.courtFreeQrImg}
                        alt={`Scorekeeper QR for ${link.teamA} vs ${link.teamB}`}
                      />
                    </button>
                  ) : (
                    <>
                      <span className={styles.courtFreeTitle}>Court free</span>
                      <span className={styles.courtFreeNext}>Nothing scheduled yet</span>
                    </>
                  )}
                </div>
              )}

              <div className={styles.courtNext}>
                <span className={styles.courtNextLabel}>
                  {/* When and which round, in the same micro line — both
                      are context for the names underneath rather than
                      part of them. */}
                  Up next{r.upNextTime ? ` · ${r.upNextTime}` : ''}
                  {r.upNext?.round ? ` · ${r.upNext.round}` : ''}
                </span>
                <span className={styles.courtNextValue}>
                  {r.upNext ? (
                    <>
                      {r.upNext.tag && (
                        <span className={styles.courtNextTag}>{r.upNext.tag} · </span>
                      )}
                      {/* Three separators used to sit on this line at the
                          same weight — the "/" inside each pair's name and
                          the "vs" between them. The names now carry the
                          weight and the "vs" is a quiet marker, so the eye
                          lands on the team split first. */}
                      <span className={styles.courtNextTeam}>{r.upNext.teamA}</span>
                      <span className={styles.courtNextVs}>vs</span>
                      <span className={styles.courtNextTeam}>{r.upNext.teamB}</span>
                    </>
                  ) : (
                    'Nothing queued'
                  )}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <ScorekeeperQrZoom zoomed={zoomed} onClose={() => setZoomed(null)} />
    </>
  );
}


/* The row's status badge, one size down from the design system's default
 * so it sits over the title as a label rather than beside it as a peer.
 * Built once per variant rather than inline, so the object identity is
 * stable across the list's re-renders. */
const ROW_BADGE_SIZE = { padding: '3px 8px', fontSize: 9.5, letterSpacing: '0.07em' } as const;
const ROW_BADGE_STYLE: Record<string, React.CSSProperties> = {
  status: ROW_BADGE_SIZE,
  open: ROW_BADGE_SIZE,
  live: ROW_BADGE_SIZE,
  outline: ROW_BADGE_SIZE,
  highlight: { ...ROW_BADGE_SIZE, background: 'var(--amber-100, #FEF3C7)' },
};

/* ── Compact tournament row (expandable) ────────────────────────── */

function TournamentRow({
  t,
  expanded,
  onToggle,
  qrOpen,
  setQrOpen,
  hideQr = false,
  onPublish,
}: {
  t: CardTournament;
  expanded: boolean;
  onToggle: () => void;
  qrOpen: string | null;
  setQrOpen: (v: string | null) => void;
  hideQr?: boolean;
  onPublish?: (t: CardTournament) => void;
}) {
  const status = getTournamentStatus(t);
  const isLive = isLiveNow(t);
  const isArchived = t.archived;
  const isDraft = status.key === 'draft' || t.phase === 1;

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
          {/* Status first, then the name it belongs to — the badge reads
              as a label over the title rather than something appended to
              it, and a long name no longer decides where it sits. */}
          <span className={styles.rowTitleLine}>
            <span className={styles.rowPills}>
              {/* Small: it is a label above the title, not a peer of it.
                  "Registration open" keeps the design system's own look —
                  a tinted fill and its dot. The highlight variant ships as
                  solid amber-300, which beside it reads as a different
                  kind of thing entirely, so it borrows the light amber and
                  matches. Overridden here rather than in Badge, which a
                  dozen other surfaces share. */}
              <Badge variant={status.variant} style={ROW_BADGE_STYLE[status.variant]}>
                {status.label}
              </Badge>
              {isLive && (
                <span className={styles.rowLive}>
                  <span className={styles.rowLiveDot} aria-hidden="true" /> Live
                </span>
              )}
            </span>
            <span className={styles.rowTitle}>{t.title}</span>
          </span>
          <span className={styles.rowMeta}>
            {/* When and how big on one line, where on the next — the two
                facts an organizer scans for are then a single glance
                apart rather than stacked three deep. */}
            <span className={styles.rowMetaLine}>
              <span className={styles.rowMetaItem}>
                <Calendar size={14} className={styles.rowMetaIcon} aria-hidden="true" />
                <span>{t.date}</span>
              </span>
              <span className={styles.rowMetaItem}>
                <Users size={14} className={styles.rowMetaIcon} aria-hidden="true" />
                <span>{t.divisions.length} division{t.divisions.length === 1 ? '' : 's'}</span>
              </span>
            </span>
            <span className={styles.rowMetaItem}>
              <MapPin size={14} className={styles.rowMetaIcon} aria-hidden="true" />
              <span>{t.location}</span>
            </span>
          </span>
        </span>

        <span className={styles.rowActions} onClick={e => e.stopPropagation()}>
          {isArchived ? (
            <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.rowSetupBtn}>
              <Settings size={13} /> Manage
            </Link>
          ) : isDraft ? (
            <>
              <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.rowSetupBtn}>
                <Settings size={13} /> Setup
              </Link>
              {onPublish && (
                <button
                  type="button"
                  className={styles.rowPublishBtn}
                  onClick={() => onPublish(t)}
                >
                  <Globe size={13} /> Publish
                </button>
              )}
            </>
          ) : (
            <>
              {/* Setup, Bracket, Schedule, Scorekeeper — a column on a wide
                  screen, one line on a phone. Only Scorekeeper gives up its
                  label there: it is the longest of the four and the one an
                  organizer reaches for least, so dropping it alone buys
                  the width the other three need to stay named. */}
              <Link
                href={`/dashboard/tournament/${t.id}/setup`}
                className={styles.rowSetupBtn}
                title="Manage setup"
                aria-label="Setup"
              >
                <Settings size={14} />
                <span className={styles.rowBtnLabel}>Setup</span>
              </Link>
              <Link href={`/dashboard/tournament/${t.id}`} className={styles.rowBracketBtn}>
                <BracketIcon size={13} /> Bracket
              </Link>
              <Link href={`/dashboard/tournament/${t.id}/schedule`} className={styles.rowBracketBtn}>
                <Calendar size={13} /> Schedule
              </Link>
              {!hideQr && (
                <button
                  type="button"
                  className={`${styles.rowSetupBtn} ${styles.rowCollapsingBtn}`}
                  title="Generate scorekeeper QR"
                  aria-label="Scorekeeper"
                  onClick={() => setQrOpen(qrOpen === t.id ? null : t.id)}
                >
                  <QrCode size={14} />
                  <span className={styles.rowBtnLabel}>Scorekeeper</span>
                </button>
              )}
            </>
          )}
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
