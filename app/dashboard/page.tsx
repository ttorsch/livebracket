'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, QrCode, Trophy, Settings, Calendar, MapPin, History, Bell, ChevronDown,
} from 'lucide-react';
import styles from './page.module.css';
import CreateTournamentModal from './CreateTournamentModal';
import { Button, SearchField } from '../../components/livebracket-ds';
import {
  getDashboardTournaments, getTournamentDetail, todayLocal,
  type DashboardTournament, type TournamentDetail, type DetailMatch, type DetailMatchPlayer,
} from '../../lib/data';

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
  // Default (no filter selected): upcoming events only — drafts and
  // completed tournaments stay hidden until their filter is chosen.
  if (key === null) return !isCompleted(t) && phaseToStatus(t.phase) !== 'draft';
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
  isLive: boolean;
}

interface CourtRow {
  court: string;
  division: string;
  teamA: string;
  teamB: string;
  sets: (SetScore | null)[];
  hasLive: boolean;
  upNext: string | null;
}

function playerNames(players: DetailMatchPlayer[]): string {
  return players.map(p => p.name).filter(Boolean).join(' / ') || 'TBD';
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
      ? `${playerNames(next.teamA)} vs ${playerNames(next.teamB)}${next.time ? ` · ${next.time}` : ''}`
      : null;

    if (entry.live) {
      const m = entry.live;
      const a = m.scoreA ?? [];
      const b = m.scoreB ?? [];
      const setCount = Math.max(a.length, b.length);
      const sets: (SetScore | null)[] = [];
      for (let i = 0; i < SET_COLUMNS; i++) {
        if (i >= setCount) { sets.push(null); continue; }
        sets.push({ a: a[i] ?? 0, b: b[i] ?? 0, isLive: i === setCount - 1 });
      }
      rows.push({
        court,
        division: m.division,
        teamA: playerNames(m.teamA),
        teamB: playerNames(m.teamB),
        sets,
        hasLive: true,
        upNext,
      });
    } else if (next) {
      rows.push({
        court,
        division: next.division,
        teamA: '',
        teamB: '',
        sets: Array(SET_COLUMNS).fill(null),
        hasLive: false,
        upNext,
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveDetails, setLiveDetails] = useState<Record<string, TournamentDetail>>({});
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

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

    const load = () => {
      Promise.all(liveTournaments.map(t => getTournamentDetail(t.id).catch(() => null)))
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

  const copyLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div className={styles.page}>
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
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
          <span className={styles.brandName}>Live Bracket</span>
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
            {liveTournaments.map(t => (
              <section key={t.id} className={styles.liveSection}>
                <div className={styles.hero}>
                  <div className={styles.heroBg} aria-hidden="true">
                    {t.imageUrl && <img src={t.imageUrl} alt="" />}
                  </div>
                  <div className={styles.heroScrim} aria-hidden="true" />
                  <div className={styles.heroContent}>
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
                        <Trophy size={16} /> Open Live Bracket
                      </Link>
                      <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.heroGhostBtn}>
                        <Settings size={16} /> Manage Setup
                      </Link>
                    </div>
                  </div>
                </div>

                <CourtsTable detail={liveDetails[t.id] ?? null} />
              </section>
            ))}

            {/* Tournament list */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>All Tournaments</h2>
              </div>

              <SearchField
                placeholder="Search tournaments, locations, divisions"
                value={query}
                onChange={e => setQuery(e.target.value)}
                showMic={false}
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
                    copiedId={copiedId}
                    copyLink={copyLink}
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
                  copiedId={null}
                  copyLink={() => {}}
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

function CourtsTable({ detail }: { detail: TournamentDetail | null }) {
  const rows = useMemo(() => (detail ? buildCourtRows(detail) : []), [detail]);

  if (!detail) {
    return <div className={styles.courtsEmpty}>Loading court activity…</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.courtsEmpty}>No matches on court right now.</div>;
  }

  return (
    <div className={styles.courtsCard}>
      <div className={styles.courtsScroll}>
        <table className={styles.courtsTable}>
          <thead>
            <tr>
              <th>Court</th>
              <th>Now playing</th>
              {Array.from({ length: SET_COLUMNS }, (_, i) => (
                <th key={i}>Set {i + 1}</th>
              ))}
              <th>Up next</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.court} className={r.hasLive ? '' : styles.courtRowIdle}>
                <td className={styles.courtName}>
                  {r.hasLive && <span className={styles.courtLiveDot} aria-hidden="true" />}
                  {r.court}
                </td>
                <td>
                  {r.hasLive ? (
                    <div className={styles.courtPlayers}>
                      <span>{r.teamA}</span>
                      <span className={styles.courtVs}>vs</span>
                      <span>{r.teamB}</span>
                      <span className={styles.courtDivision}>{r.division}</span>
                    </div>
                  ) : (
                    <span className={styles.courtIdleLabel}>Court free</span>
                  )}
                </td>
                {r.sets.map((set, i) => (
                  <td key={i}>
                    {set ? (
                      <span className={set.isLive ? styles.courtLiveScore : styles.courtSets}>
                        {set.a}–{set.b}
                      </span>
                    ) : (
                      <span className={styles.courtSets}>—</span>
                    )}
                  </td>
                ))}
                <td className={styles.courtUpNext}>{r.upNext ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Compact tournament row (expandable) ────────────────────────── */

function TournamentRow({
  t,
  expanded,
  onToggle,
  qrOpen,
  setQrOpen,
  copiedId,
  copyLink,
  hideQr = false,
}: {
  t: CardTournament;
  expanded: boolean;
  onToggle: () => void;
  qrOpen: string | null;
  setQrOpen: (v: string | null) => void;
  copiedId: string | null;
  copyLink: (id: string, url: string) => void;
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
          {t.imageUrl ? <img src={t.imageUrl} alt="" /> : <Trophy size={22} strokeWidth={1.5} />}
        </span>

        <span className={styles.rowInfo}>
          <span className={styles.rowPills}>
            <span className={`${styles.pill} ${pill.cls}`}>{pill.label}</span>
            {isLive && (
              <span className={styles.rowLive}>
                <span className={styles.rowLiveDot} aria-hidden="true" /> Live
              </span>
            )}
          </span>
          <span className={styles.rowTitle}>{t.title}</span>
          <span className={styles.rowMeta}>
            <span>{t.date}</span>
            <span className={styles.rowMetaDot} aria-hidden="true">•</span>
            <span>{t.location}</span>
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
          <Link href={`/dashboard/tournament/${t.id}/setup`} className={styles.rowSetupBtn}>
            <Settings size={15} /> Setup
          </Link>
        </span>

        <ChevronDown size={18} className={styles.rowChevron} aria-hidden="true" />
      </div>

      {qrOpen === t.id && (
        <div className={styles.qrPanel}>
          <div className={styles.qrPanelHeader}>
            <span>Scorekeeper QR code</span>
            <button className={styles.qrClose} onClick={() => setQrOpen(null)}>×</button>
          </div>
          <div className={styles.qrCode}>
            <div className={styles.qrPlaceholder}>
              <QrCode size={80} color="rgba(20,24,30,0.5)" />
              <p>Scan to open court scoring</p>
            </div>
          </div>
          <div className={styles.qrLink}>
            <span className={styles.qrUrl}>livebracket.klv.app/score/{t.id}</span>
            <button
              className={styles.copyBtn}
              onClick={() => copyLink(t.id, `https://livebracket.klv.app/score/${t.id}`)}
            >
              {copiedId === t.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
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
