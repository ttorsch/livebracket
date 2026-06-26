'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star, Trophy, Calendar, MapPin, ChevronRight, Settings, LogOut } from 'lucide-react';
import styles from './page.module.css';

/* ── Sample player data ──────────────────────────────────────── */
const PLAYER = {
  name: 'Alex Svensson',
  flag: '🇸🇪',
  location: 'Khao Lak, Thailand',
  since: 'Jan 2024',
  avatar: '🏐',
  stats: {
    tournaments: 8,
    wins: 3,
    winRate: 62,
    setsWon: 41,
    setsLost: 22,
  },
};

const STARRED = [
  { id: 'bang-niang-classic-2025', title: 'Bang Niang Beach Classic', date: 'July 12–13, 2025', status: 'live' as const },
  { id: 'khao-lak-open-2025', title: 'Khao Lak Open 2025', date: 'Aug 2–3, 2025', status: 'upcoming' as const },
];

const HISTORY = [
  { id: 'spring-classic-2025', title: 'Spring Classic 2025', date: 'Apr 19, 2025', division: "Men's Open", result: 'Winner 🏆', placement: 1 },
  { id: 'new-year-open-2025', title: 'New Year Open 2025', date: 'Jan 5, 2025', division: "Men's Open", result: 'Runner-up', placement: 2 },
  { id: 'autumn-cup-2024', title: 'Autumn Cup 2024', date: 'Oct 12, 2024', division: "Men's Open", result: 'Top 4', placement: 3 },
  { id: 'summer-beach-2024', title: 'Summer Beach Classic 2024', date: 'Jul 20, 2024', division: 'Mixed', result: 'Winner 🏆', placement: 1 },
  { id: 'klv-open-2024', title: 'KLV Open 2024', date: 'Mar 3, 2024', division: "Men's Open", result: 'Group stage', placement: 6 },
];

type Tab = 'overview' | 'history' | 'starred';

export default function PlayerProfile() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className={styles.page}>
      {/* ── Top bar ────────────────────────────────────────────── */}
      <header className={styles.topBar}>
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
        <div className={styles.topBarActions}>
          <Link href="/" className={styles.topLink}>Browse events</Link>
          <button className={styles.iconBtn} title="Settings"><Settings size={18} /></button>
          <button className={styles.iconBtn} title="Log out"><LogOut size={18} /></button>
        </div>
      </header>

      {/* ── Profile hero ───────────────────────────────────────── */}
      <div className={styles.profileHero}>
        <div className={styles.profileHeroBg} />
        <div className={styles.container}>
          <div className={styles.profileCard}
            style={{ backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' }}
          >
            <div className={styles.avatar}>{PLAYER.avatar}</div>
            <div className={styles.profileInfo}>
              <div className={styles.profileNameRow}>
                <h1 className={styles.profileName}>{PLAYER.name}</h1>
                <span className={styles.profileFlag}>{PLAYER.flag}</span>
              </div>
              <div className={styles.profileMeta}>
                <span className={styles.profileMetaItem}>
                  <MapPin size={13} />
                  {PLAYER.location}
                </span>
                <span className={styles.profileMetaItem}>
                  <Calendar size={13} />
                  Member since {PLAYER.since}
                </span>
              </div>
            </div>
            <div className={styles.profileStats}>
              <div className={styles.profileStat}>
                <span className={styles.profileStatNum}>{PLAYER.stats.tournaments}</span>
                <span className={styles.profileStatLabel}>Tournaments</span>
              </div>
              <div className={styles.profileStatDivider} />
              <div className={styles.profileStat}>
                <span className={styles.profileStatNum}>{PLAYER.stats.wins}</span>
                <span className={styles.profileStatLabel}>Wins</span>
              </div>
              <div className={styles.profileStatDivider} />
              <div className={styles.profileStat}>
                <span className={styles.profileStatNum}>{PLAYER.stats.winRate}%</span>
                <span className={styles.profileStatLabel}>Win rate</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className={styles.tabBar}>
        <div className={styles.container}>
          <div className={styles.tabs}>
            {(['overview', 'history', 'starred'] as Tab[]).map(t => (
              <button
                key={t}
                className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.container}>

          {/* Overview */}
          {tab === 'overview' && (
            <div className={styles.overviewGrid}>
              {/* Performance card */}
              <div className={styles.overviewCard}
                style={{ backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
              >
                <h2 className={styles.overviewCardTitle}>Performance</h2>
                <div className={styles.performanceStats}>
                  <div className={styles.perfStatRow}>
                    <span className={styles.perfStatLabel}>Sets won</span>
                    <div className={styles.perfBar}>
                      <div
                        className={styles.perfBarFill}
                        style={{ width: `${(PLAYER.stats.setsWon / (PLAYER.stats.setsWon + PLAYER.stats.setsLost)) * 100}%` }}
                      />
                    </div>
                    <span className={styles.perfStatVal}>{PLAYER.stats.setsWon}</span>
                  </div>
                  <div className={styles.perfStatRow}>
                    <span className={styles.perfStatLabel}>Sets lost</span>
                    <div className={styles.perfBar}>
                      <div
                        className={`${styles.perfBarFill} ${styles.perfBarLoss}`}
                        style={{ width: `${(PLAYER.stats.setsLost / (PLAYER.stats.setsWon + PLAYER.stats.setsLost)) * 100}%` }}
                      />
                    </div>
                    <span className={styles.perfStatVal}>{PLAYER.stats.setsLost}</span>
                  </div>
                </div>
                <div className={styles.winRateCircle}>
                  <svg viewBox="0 0 100 100" className={styles.winRateSvg}>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(20,31,46,0.08)" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="40"
                      fill="none"
                      stroke="#EE7A4C"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - PLAYER.stats.winRate / 100)}`}
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <div className={styles.winRateText}>
                    <span className={styles.winRatePct}>{PLAYER.stats.winRate}%</span>
                    <span className={styles.winRateLabel}>Win rate</span>
                  </div>
                </div>
              </div>

              {/* Recent activity */}
              <div className={styles.overviewCard}
                style={{ backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
              >
                <h2 className={styles.overviewCardTitle}>Recent tournaments</h2>
                <div className={styles.recentList}>
                  {HISTORY.slice(0, 3).map(h => (
                    <Link key={h.id} href={`/tournament/${h.id}`} className={styles.recentItem}>
                      <div className={styles.recentPlacement} data-pos={h.placement <= 2 ? h.placement : 'other'}>
                        {h.placement}
                      </div>
                      <div className={styles.recentInfo}>
                        <p className={styles.recentTitle}>{h.title}</p>
                        <p className={styles.recentMeta}>{h.division} · {h.date}</p>
                      </div>
                      <span className={styles.recentResult}>{h.result}</span>
                    </Link>
                  ))}
                </div>
                <button className={styles.seeAllBtn} onClick={() => setTab('history')}>
                  See full history <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* History */}
          {tab === 'history' && (
            <div className={styles.historyList}>
              {HISTORY.map((h, i) => (
                <Link key={h.id} href={`/tournament/${h.id}`} className={styles.historyCard}>
                  <div className={styles.historyPlacement} data-pos={h.placement <= 2 ? h.placement : 'other'}>
                    #{h.placement}
                  </div>
                  <div className={styles.historyInfo}>
                    <p className={styles.historyTitle}>{h.title}</p>
                    <p className={styles.historyMeta}>{h.division}</p>
                  </div>
                  <div className={styles.historyRight}>
                    <span className={styles.historyResult}>{h.result}</span>
                    <span className={styles.historyDate}>{h.date}</span>
                  </div>
                  <ChevronRight size={16} className={styles.historyArrow} />
                </Link>
              ))}
            </div>
          )}

          {/* Starred */}
          {tab === 'starred' && (
            <div>
              {STARRED.length === 0 ? (
                <div className={styles.emptyStarred}>
                  <Star size={32} color="rgba(20,24,30,0.2)" />
                  <p>No starred events yet</p>
                  <Link href="/" className={styles.browseLink}>Browse events</Link>
                </div>
              ) : (
                <div className={styles.starredList}>
                  {STARRED.map(e => (
                    <Link key={e.id} href={`/tournament/${e.id}`} className={styles.starredCard}>
                      <div className={styles.starredInfo}>
                        <div className={styles.starredBadgeRow}>
                          {e.status === 'live' ? (
                            <span className={styles.livePill}><span className={styles.liveDot} />Live</span>
                          ) : (
                            <span className={styles.upcomingPill}>Upcoming</span>
                          )}
                        </div>
                        <p className={styles.starredTitle}>{e.title}</p>
                        <p className={styles.starredDate}>{e.date}</p>
                      </div>
                      <div className={styles.starredActions}>
                        <button
                          className={styles.unstarBtn}
                          onClick={ev => ev.preventDefault()}
                          title="Remove from starred"
                        >
                          <Star size={16} fill="currentColor" />
                        </button>
                        <ChevronRight size={16} className={styles.starredArrow} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
