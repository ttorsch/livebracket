'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, QrCode, BarChart2, Users, Trophy, ChevronRight, ArrowRight, Settings } from 'lucide-react';
import styles from './page.module.css';

/* ── Sample data ─────────────────────────────────────────────── */
const ORGANIZER = {
  name: 'Thana Sirichai',
  club: 'Khao Lak Volley Club',
  avatar: '🏐',
};

const STATS = [
  { label: 'Tournaments run', value: 12, icon: Trophy },
  { label: 'Teams registered', value: 148, icon: Users },
  { label: 'Matches scored', value: 320, icon: BarChart2 },
];

const ACTIVE_TOURNAMENTS = [
  {
    id: 'bang-niang-classic-2025',
    title: 'Bang Niang Beach Classic 2025',
    date: 'July 12–13, 2025',
    status: 'live' as const,
    divisions: ["Men's Open", "Women's Open", 'Mixed'],
    teamsTotal: 24,
    teamsFilled: 19,
    courts: 3,
    matchesTotal: 16,
    matchesDone: 4,
  },
  {
    id: 'khao-lak-open-2025',
    title: 'Khao Lak Open 2025',
    date: 'Aug 2–3, 2025',
    status: 'upcoming' as const,
    divisions: ["Men's Open", "Women's Open"],
    teamsTotal: 16,
    teamsFilled: 9,
    courts: 2,
    matchesTotal: 8,
    matchesDone: 0,
  },
];

const PAST_TOURNAMENTS = [
  { id: 'spring-classic-2025', title: 'Spring Classic 2025', date: 'Apr 19, 2025', teams: 20, winner: 'Santos / Lima 🇧🇷' },
  { id: 'new-year-open-2025', title: 'New Year Open 2025', date: 'Jan 5, 2025', teams: 12, winner: 'Tanaka / Yamamoto 🇯🇵' },
];

export default function OrganizerDashboard() {
  const [qrOpen, setQrOpen] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
            <svg viewBox="283 51 687 687" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="626.5" cy="394.5" r="343.5" fill="#EE7A4C" />
              <line x1="465" y1="258" x2="573" y2="258" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="603" y1="320" x2="711" y2="320" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="603" y1="471" x2="681" y2="471" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="711" y1="449" x2="789" y2="449" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="465" y1="531" x2="573" y2="531" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="573" y1="259" x2="573" y2="380" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="711" y1="320" x2="711" y2="449" stroke="white" strokeWidth="30" strokeLinecap="round" />
              <line x1="573" y1="410" x2="573" y2="531" stroke="white" strokeWidth="30" strokeLinecap="round" />
            </svg>
          </span>
          <span>Live Bracket</span>
        </Link>

        <nav className={styles.sideNav}>
          <Link href="/dashboard" className={`${styles.sideLink} ${styles.sideLinkActive}`}>
            <BarChart2 size={18} />
            Dashboard
          </Link>
          <Link href="/dashboard/create" className={styles.sideLink}>
            <Plus size={18} />
            New tournament
          </Link>
          <Link href="/" className={styles.sideLink}>
            <Trophy size={18} />
            Browse events
          </Link>
          <Link href="/profile" className={styles.sideLink}>
            <Users size={18} />
            Profile
          </Link>
        </nav>

        <div className={styles.sideProfile}>
          <span className={styles.sideAvatar}>{ORGANIZER.avatar}</span>
          <div>
            <p className={styles.sideProfileName}>{ORGANIZER.name}</p>
            <p className={styles.sideProfileClub}>{ORGANIZER.club}</p>
          </div>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <p className={styles.headerEyebrow}>Organizer dashboard</p>
            <h1 className={styles.headerTitle}>Welcome back, {ORGANIZER.name.split(' ')[0]}</h1>
          </div>
          <Link href="/dashboard/create" className={styles.newTournamentBtn}>
            <Plus size={18} />
            New tournament
          </Link>
        </div>

        {/* Stats row */}
        <div className={styles.statsRow}>
          {STATS.map(stat => (
            <div key={stat.label} className={styles.statCard}
              style={{ backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
            >
              <div className={styles.statIcon}>
                <stat.icon size={20} />
              </div>
              <div className={styles.statNum}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Active tournaments */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active tournaments</h2>
          </div>

          <div className={styles.tournamentList}>
            {ACTIVE_TOURNAMENTS.map(t => (
              <div key={t.id} className={styles.tournamentCard}
                style={{ backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
              >
                <div className={styles.tournamentCardTop}>
                  <div>
                    <div className={styles.tournamentBadgeRow}>
                      {t.status === 'live' ? (
                        <span className={styles.livePill}><span className={styles.liveDot} />Live</span>
                      ) : (
                        <span className={styles.upcomingPill}>Upcoming</span>
                      )}
                    </div>
                    <h3 className={styles.tournamentCardTitle}>{t.title}</h3>
                    <p className={styles.tournamentCardDate}>{t.date}</p>
                  </div>
                  <div className={styles.tournamentCardActions}>
                    <button
                      className={styles.iconBtn}
                      title="Generate scorekeeper QR"
                      onClick={() => setQrOpen(qrOpen === t.id ? null : t.id)}
                    >
                      <QrCode size={18} />
                    </button>
                    <Link href={`/tournament/${t.id}`} className={styles.iconBtn} title="View tournament">
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                </div>

                <div className={styles.tournamentProgress}>
                  <div className={styles.progressRow}>
                    <span className={styles.progressLabel}>Teams</span>
                    <span className={styles.progressValue}>{t.teamsFilled}/{t.teamsTotal}</span>
                  </div>
                  <div className={styles.progressBarWrap}>
                    <div
                      className={styles.progressBarFill}
                      style={{ width: `${(t.teamsFilled / t.teamsTotal) * 100}%` }}
                    />
                  </div>
                  <div className={styles.progressRow} style={{ marginTop: 10 }}>
                    <span className={styles.progressLabel}>Matches</span>
                    <span className={styles.progressValue}>{t.matchesDone}/{t.matchesTotal}</span>
                  </div>
                  <div className={styles.progressBarWrap}>
                    <div
                      className={styles.progressBarFill}
                      style={{ width: `${(t.matchesDone / t.matchesTotal) * 100}%`, background: 'rgba(238, 122, 76, 0.5)' }}
                    />
                  </div>
                </div>

                <div className={styles.tournamentDivisions}>
                  {t.divisions.map(d => (
                    <span key={d} className={styles.divBadge}>{d}</span>
                  ))}
                </div>

                {qrOpen === t.id && (
                  <div className={styles.qrPanel}>
                    <div className={styles.qrPanelHeader}>
                      <span>Scorekeeper QR code</span>
                      <button className={styles.qrClose} onClick={() => setQrOpen(null)}>×</button>
                    </div>
                    <div className={styles.qrCode}>
                      {/* Placeholder QR visual */}
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

                <div className={styles.tournamentCardFooter}>
                  <Link href={`/tournament/${t.id}`} className={styles.viewLink}>
                    View tournament <ChevronRight size={14} />
                  </Link>
                  <button className={styles.editLink}>
                    <Settings size={14} /> Manage
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Past tournaments */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent results</h2>
          <div className={styles.pastList}>
            {PAST_TOURNAMENTS.map(t => (
              <Link key={t.id} href={`/tournament/${t.id}`} className={styles.pastCard}>
                <div>
                  <p className={styles.pastTitle}>{t.title}</p>
                  <p className={styles.pastDate}>{t.date} · {t.teams} teams</p>
                </div>
                <div className={styles.pastWinner}>
                  <span className={styles.trophyIcon}>🏆</span>
                  {t.winner}
                </div>
                <ChevronRight size={16} className={styles.pastArrow} />
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
