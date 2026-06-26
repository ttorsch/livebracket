'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MapPin, Calendar, Users, Trophy, Clock, ChevronRight } from 'lucide-react';
import styles from './page.module.css';

type TournamentStatus = 'live' | 'upcoming' | 'finished';

/* ── Sample data ─────────────────────────────────────────────── */
const TOURNAMENT = {
  id: 'bang-niang-classic-2025',
  title: 'Bang Niang Beach Classic 2025',
  subtitle: 'Open Championship',
  location: 'Bang Niang Beach, Khao Lak',
  date: 'July 12–13, 2025',
  image: '/images/Hero.jpg',
  status: 'live' as TournamentStatus,
  format: 'Single Elimination',
  courts: 3,
  divisions: [
    { id: 'open-m', label: "Men's Open", teams: 8, filled: 8 },
    { id: 'open-w', label: "Women's Open", teams: 8, filled: 6 },
    { id: 'mixed', label: 'Mixed', teams: 8, filled: 5 },
  ],
  description: 'The annual Bang Niang Beach Classic draws the best beach volleyball teams from across Thailand and beyond. Fast-paced single elimination format with 3 top-quality sand courts.',
};

interface MatchPlayer { name: string; flag: string }
interface BracketMatch {
  id: string;
  court: string;
  time: string;
  teamA: MatchPlayer[];
  teamB: MatchPlayer[];
  scoreA?: number[];
  scoreB?: number[];
  winner?: 'A' | 'B';
  status: 'live' | 'upcoming' | 'done';
}

const BRACKET: { round: string; matches: BracketMatch[] }[] = [
  {
    round: 'QF',
    matches: [
      { id: 'qf1', court: 'Court 1', time: '09:00', teamA: [{ name: 'Santos', flag: '🇧🇷' }, { name: 'Lima', flag: '🇧🇷' }], teamB: [{ name: 'Müller', flag: '🇩🇪' }, { name: 'Schmidt', flag: '🇩🇪' }], scoreA: [21, 18], scoreB: [18, 21], status: 'done', winner: undefined },
      { id: 'qf2', court: 'Court 2', time: '09:00', teamA: [{ name: 'Kramer', flag: '🇳🇱' }, { name: 'de Vries', flag: '🇳🇱' }], teamB: [{ name: 'Charoenwong', flag: '🇹🇭' }, { name: 'Rattanawong', flag: '🇹🇭' }], scoreA: [21], scoreB: [19], status: 'live', winner: undefined },
      { id: 'qf3', court: 'Court 3', time: '09:30', teamA: [{ name: 'Tanaka', flag: '🇯🇵' }, { name: 'Yamamoto', flag: '🇯🇵' }], teamB: [{ name: 'Park', flag: '🇰🇷' }, { name: 'Kim', flag: '🇰🇷' }], scoreA: [], scoreB: [], status: 'upcoming', winner: undefined },
      { id: 'qf4', court: 'Court 1', time: '09:30', teamA: [{ name: 'Patel', flag: '🇮🇳' }, { name: 'Gupta', flag: '🇮🇳' }], teamB: [{ name: 'Wang', flag: '🇨🇳' }, { name: 'Chen', flag: '🇨🇳' }], scoreA: [], scoreB: [], status: 'upcoming', winner: undefined },
    ],
  },
  {
    round: 'SF',
    matches: [
      { id: 'sf1', court: 'Court 1', time: '12:00', teamA: [{ name: 'Santos', flag: '🇧🇷' }, { name: 'Lima', flag: '🇧🇷' }], teamB: [{ name: 'TBD', flag: '🏐' }, { name: 'TBD', flag: '' }], scoreA: [], scoreB: [], status: 'upcoming', winner: undefined },
      { id: 'sf2', court: 'Court 2', time: '12:00', teamA: [{ name: 'TBD', flag: '🏐' }, { name: 'TBD', flag: '' }], teamB: [{ name: 'TBD', flag: '🏐' }, { name: 'TBD', flag: '' }], scoreA: [], scoreB: [], status: 'upcoming', winner: undefined },
    ],
  },
  {
    round: 'Final',
    matches: [
      { id: 'f1', court: 'Main Court', time: '15:00', teamA: [{ name: 'TBD', flag: '🏐' }, { name: 'TBD', flag: '' }], teamB: [{ name: 'TBD', flag: '🏐' }, { name: 'TBD', flag: '' }], scoreA: [], scoreB: [], status: 'upcoming', winner: undefined },
    ],
  },
];

const POOL_STANDINGS = [
  { pos: 1, teamA: { name: 'Santos', flag: '🇧🇷' }, teamB: { name: 'Lima', flag: '🇧🇷' }, w: 3, l: 0, pts: 9 },
  { pos: 2, teamA: { name: 'Kramer', flag: '🇳🇱' }, teamB: { name: 'de Vries', flag: '🇳🇱' }, w: 2, l: 1, pts: 6 },
  { pos: 3, teamA: { name: 'Charoenwong', flag: '🇹🇭' }, teamB: { name: 'Rattanawong', flag: '🇹🇭' }, w: 1, l: 2, pts: 3 },
  { pos: 4, teamA: { name: 'Müller', flag: '🇩🇪' }, teamB: { name: 'Schmidt', flag: '🇩🇪' }, w: 0, l: 3, pts: 0 },
];

const SCHEDULE = [
  { time: '09:00', court: 'Court 1', match: 'QF — Santos/Lima vs Müller/Schmidt', status: 'done' as const },
  { time: '09:00', court: 'Court 2', match: 'QF — Kramer/de Vries vs Charoenwong/Rattanawong', status: 'live' as const },
  { time: '09:30', court: 'Court 3', match: 'QF — Tanaka/Yamamoto vs Park/Kim', status: 'upcoming' as const },
  { time: '09:30', court: 'Court 1', match: 'QF — Patel/Gupta vs Wang/Chen', status: 'upcoming' as const },
  { time: '12:00', court: 'Court 1', match: 'SF — Winner QF1 vs Winner QF2', status: 'upcoming' as const },
  { time: '12:00', court: 'Court 2', match: 'SF — Winner QF3 vs Winner QF4', status: 'upcoming' as const },
  { time: '15:00', court: 'Main Court', match: 'Final — Winner SF1 vs Winner SF2', status: 'upcoming' as const },
];

const TEAMS = [
  { name: 'Santos / Lima', flags: '🇧🇷', seed: 1, status: 'active' },
  { name: 'Kramer / de Vries', flags: '🇳🇱', seed: 2, status: 'active' },
  { name: 'Charoenwong / Rattanawong', flags: '🇹🇭', seed: 3, status: 'active' },
  { name: 'Müller / Schmidt', flags: '🇩🇪', seed: 4, status: 'eliminated' },
  { name: 'Tanaka / Yamamoto', flags: '🇯🇵', seed: 5, status: 'active' },
  { name: 'Park / Kim', flags: '🇰🇷', seed: 6, status: 'active' },
  { name: 'Patel / Gupta', flags: '🇮🇳', seed: 7, status: 'active' },
  { name: 'Wang / Chen', flags: '🇨🇳', seed: 8, status: 'active' },
];

type Tab = 'bracket' | 'pool' | 'schedule' | 'teams';

/* ── Nav (mirrors homepage) ───────────────────────────────────── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : styles.onHero}`}>
      <div className={styles.navRow}
        style={scrolled ? { backdropFilter: 'blur(18px) saturate(150%)', WebkitBackdropFilter: 'blur(18px) saturate(150%)' } : undefined}
      >
        <Link href="/" className={styles.logo}>
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
          <span>Live Bracket</span>
        </Link>

        <ul className={styles.links}>
          <li><Link href="/" className={styles.link}>Events</Link></li>
          <li><Link href="/dashboard" className={styles.link}>Dashboard</Link></li>
          <li><Link href="/profile" className={styles.link}>My Profile</Link></li>
          <li><Link href="/" className={`${styles.link} ${styles.linkKlv}`}>KLV Home</Link></li>
        </ul>

        <div className={styles.actions}>
          <Link href="/login" className={styles.pillContact}>Log in</Link>
          <button className={styles.menuBtn} onClick={() => setMenuOpen(v => !v)} aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {menuOpen && (
          <>
            <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
            <div className={styles.mobileMenu}>
              <Link href="/" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Events</Link>
              <Link href="/dashboard" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <Link href="/profile" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>My Profile</Link>
              <Link href="/login" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Log in</Link>
              <Link href="/" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>KLV Home</Link>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

/* ── Bracket match card ───────────────────────────────────────── */
function BracketMatchCard({ match }: { match: BracketMatch }) {
  const statusColor = match.status === 'live' ? '#FF3B3B' : match.status === 'done' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)';

  return (
    <div className={`${styles.bracketMatch} ${match.status === 'live' ? styles.bracketMatchLive : ''}`}>
      <div className={styles.bracketMatchMeta}>
        <span className={styles.bracketCourt}>{match.court}</span>
        {match.status === 'live' && <span className={styles.bracketLivePill}><span className={styles.liveDot} style={{ background: statusColor }} />Live</span>}
        {match.status === 'done' && <span className={styles.bracketDonePill}>Done</span>}
        {match.status === 'upcoming' && <span className={styles.bracketTimePill}>{match.time}</span>}
      </div>
      <div className={styles.bracketTeamRow}>
        <div className={styles.bracketTeamNames}>
          {match.teamA.map((p, i) => (
            <span key={i} className={styles.bracketPlayerName}>
              {p.flag && <span className={styles.bracketFlag}>{p.flag}</span>}
              {p.name}
            </span>
          ))}
        </div>
        {(match.scoreA?.length ?? 0) > 0 && (
          <span className={styles.bracketScore}>{match.scoreA!.join(' · ')}</span>
        )}
      </div>
      <div className={styles.bracketDivider} />
      <div className={styles.bracketTeamRow}>
        <div className={styles.bracketTeamNames}>
          {match.teamB.map((p, i) => (
            <span key={i} className={styles.bracketPlayerName}>
              {p.flag && <span className={styles.bracketFlag}>{p.flag}</span>}
              {p.name}
            </span>
          ))}
        </div>
        {(match.scoreB?.length ?? 0) > 0 && (
          <span className={styles.bracketScore}>{match.scoreB!.join(' · ')}</span>
        )}
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function TournamentDetail() {
  const params = useParams();
  const [activeDiv, setActiveDiv] = useState(TOURNAMENT.divisions[0].id);
  const [activeTab, setActiveTab] = useState<Tab>('bracket');
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabBarStuck, setTabBarStuck] = useState(false);

  useEffect(() => {
    if (!tabBarRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setTabBarStuck(!entry.isIntersecting),
      { threshold: 1, rootMargin: '-80px 0px 0px 0px' }
    );
    observer.observe(tabBarRef.current);
    return () => observer.disconnect();
  }, []);

  const tournament = TOURNAMENT;

  return (
    <div className={styles.page}>
      <Nav />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroBg}>
          <img src={tournament.image} alt="" className={styles.heroImg} />
          <div className={styles.heroScrim} />
        </div>
        <div className={styles.heroContent}>
          <div className={styles.container}>
            <Link href="/" className={styles.backLink}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All events
            </Link>

            <div className={styles.heroBadgeRow}>
              {tournament.status === 'live' && (
                <span className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  Live now
                </span>
              )}
              {tournament.status === 'upcoming' && (
                <span className={styles.upcomingBadge}>Upcoming</span>
              )}
              <span className={styles.formatBadge}>{tournament.format}</span>
            </div>

            <h1 className={styles.heroTitle}>{tournament.title}</h1>
            <p className={styles.heroSubtitle}>{tournament.subtitle}</p>

            <div className={styles.heroMeta}>
              <span className={styles.heroMetaItem}>
                <MapPin size={15} />
                {tournament.location}
              </span>
              <span className={styles.heroMetaItem}>
                <Calendar size={15} />
                {tournament.date}
              </span>
              <span className={styles.heroMetaItem}>
                <Users size={15} />
                {tournament.courts} courts
              </span>
            </div>

            <div className={styles.heroActions}>
              <Link
                href={`/tournament/${params.id}/register`}
                className={styles.heroPrimary}
              >
                Register team
                <ChevronRight size={16} />
              </Link>
              <button className={styles.heroShare}>Share event</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Division selector ─────────────────────────────────── */}
      <div className={styles.divisionBar}>
        <div className={styles.container}>
          <div className={styles.divisionTabs}>
            {tournament.divisions.map(div => (
              <button
                key={div.id}
                className={`${styles.divisionTab} ${activeDiv === div.id ? styles.divisionTabActive : ''}`}
                onClick={() => setActiveDiv(div.id)}
              >
                {div.label}
                <span className={styles.divisionCount}>{div.filled}/{div.teams}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content tabs ──────────────────────────────────────── */}
      <div ref={tabBarRef} className={`${styles.tabBar} ${tabBarStuck ? styles.tabBarStuck : ''}`}>
        <div className={styles.container}>
          <div className={styles.tabs}>
            {(['bracket', 'pool', 'schedule', 'teams'] as Tab[]).map(tab => (
              <button
                key={tab}
                className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.container}>

          {/* Bracket */}
          {activeTab === 'bracket' && (
            <div className={styles.bracketSection}>
              <div className={styles.bracketScroll}>
                <div className={styles.bracketGrid}>
                  {BRACKET.map((round) => (
                    <div key={round.round} className={styles.bracketRound}>
                      <div className={styles.bracketRoundLabel}>{round.round}</div>
                      <div className={styles.bracketRoundMatches}>
                        {round.matches.map((match) => (
                          <BracketMatchCard key={match.id} match={match} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pool standings */}
          {activeTab === 'pool' && (
            <div className={styles.poolSection}>
              <h2 className={styles.poolTitle}>Pool A — Standings</h2>
              <div className={styles.standingsTable}>
                <div className={styles.standingsHeader}>
                  <span>#</span>
                  <span>Team</span>
                  <span>W</span>
                  <span>L</span>
                  <span>Pts</span>
                </div>
                {POOL_STANDINGS.map(row => (
                  <div key={row.pos} className={`${styles.standingsRow} ${row.pos <= 2 ? styles.standingsRowQualify : ''}`}>
                    <span className={styles.standingsPos}>{row.pos}</span>
                    <span className={styles.standingsTeam}>
                      <span>{row.teamA.flag}{row.teamA.name}</span>
                      <span className={styles.standingsSep}>/</span>
                      <span>{row.teamB.flag}{row.teamB.name}</span>
                    </span>
                    <span className={styles.standingsStat}>{row.w}</span>
                    <span className={styles.standingsStat}>{row.l}</span>
                    <span className={`${styles.standingsStat} ${styles.standingsPts}`}>{row.pts}</span>
                  </div>
                ))}
              </div>
              <p className={styles.poolNote}>Top 2 teams advance to elimination bracket</p>
            </div>
          )}

          {/* Schedule */}
          {activeTab === 'schedule' && (
            <div className={styles.scheduleSection}>
              <div className={styles.scheduleList}>
                {SCHEDULE.map((item, i) => (
                  <div key={i} className={`${styles.scheduleItem} ${item.status === 'live' ? styles.scheduleItemLive : ''} ${item.status === 'done' ? styles.scheduleItemDone : ''}`}>
                    <div className={styles.scheduleTime}>
                      <Clock size={13} />
                      {item.time}
                    </div>
                    <div className={styles.scheduleCourt}>{item.court}</div>
                    <div className={styles.scheduleMatch}>{item.match}</div>
                    <div className={styles.scheduleStatus}>
                      {item.status === 'live' && <span className={styles.scheduleStatusLive}><span className={styles.liveDot} />Live</span>}
                      {item.status === 'done' && <span className={styles.scheduleStatusDone}>✓ Done</span>}
                      {item.status === 'upcoming' && <span className={styles.scheduleStatusUpcoming}>Upcoming</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Teams */}
          {activeTab === 'teams' && (
            <div className={styles.teamsSection}>
              <div className={styles.teamsGrid}>
                {TEAMS.map((team) => (
                  <div key={team.seed} className={`${styles.teamCard} ${team.status === 'eliminated' ? styles.teamCardEliminated : ''}`}>
                    <div className={styles.teamSeed}>#{team.seed}</div>
                    <div className={styles.teamFlag}>{team.flags}</div>
                    <div className={styles.teamName}>{team.name}</div>
                    {team.status === 'eliminated' && (
                      <div className={styles.teamElimBadge}>Eliminated</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── Footer CTA ────────────────────────────────────────── */}
      <div className={styles.footerCta}>
        <div className={styles.container}>
          <div className={styles.footerCtaInner}>
            <div>
              <p className={styles.footerCtaLabel}>Want to play?</p>
              <p className={styles.footerCtaTitle}>Register your team</p>
            </div>
            <Link href={`/tournament/${params.id}/register`} className={styles.footerCtaBtn}>
              Register now <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
