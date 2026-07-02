'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { MapPin, Calendar, Users, Trophy, Clock, ChevronRight } from 'lucide-react';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailMatch } from '../../../lib/data';

type BracketMatch = DetailMatch;

type Tab = 'bracket' | 'pool' | 'schedule' | 'teams' | 'rules' | 'vouchers';

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
  const searchParams = useSearchParams();
  const slug = String(params.id);

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [activeDiv, setActiveDiv] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('bracket');
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabBarStuck, setTabBarStuck] = useState(false);

  useEffect(() => {
    getTournamentDetail(slug).then((data) => {
      setTournament(data);
      if (data && data.divisions.length > 0) setActiveDiv(data.divisions[0].id);
    }).catch(console.error);
  }, [slug]);

  // Read Phase query param to test dynamic flows: 1 = Shell, 2 = Announced, 3 = Open, 4 = Closed/Logistics
  const phaseParam = searchParams.get('phase');
  const phase = phaseParam ? parseInt(phaseParam) : (tournament?.phase ?? 3);

  // Watchlist Star Button State
  const [starred, setStarred] = useState(false);
  const [watchlistCount, setWatchlistCount] = useState(14);

  useEffect(() => {
    const isStarred = localStorage.getItem(`watchlist_${params.id}`) === 'true';
    setStarred(isStarred);
    setWatchlistCount(isStarred ? 15 : 14);
  }, [params.id]);

  const toggleWatchlist = () => {
    const nextState = !starred;
    setStarred(nextState);
    localStorage.setItem(`watchlist_${params.id}`, String(nextState));
    setWatchlistCount(nextState ? 15 : 14);
  };

  useEffect(() => {
    if (!tabBarRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setTabBarStuck(!entry.isIntersecting),
      { threshold: 1, rootMargin: '-80px 0px 0px 0px' }
    );
    observer.observe(tabBarRef.current);
    return () => observer.disconnect();
  }, []);

  if (!tournament) {
    return (
      <div className={styles.page}>
        <Nav />
        <div className={styles.container} style={{ padding: '160px 0', textAlign: 'center' }}>
          Loading tournament…
        </div>
      </div>
    );
  }

  const activeDivision = tournament.divisions.find((d) => d.id === activeDiv) ?? null;
  const courtCount = new Set(
    tournament.divisions.flatMap((d) => d.bracket.flatMap((r) => r.matches.map((m) => m.court))).filter(Boolean)
  ).size;
  const scheduleItems = (activeDivision?.bracket ?? []).flatMap((r) =>
    r.matches.map((m) => ({
      time: m.time,
      court: m.court,
      match: `${r.round} — ${m.teamA.map((p) => p.name).join('/')} vs ${m.teamB.map((p) => p.name).join('/')}`,
      status: m.status,
    }))
  );

  return (
    <div className={styles.page}>
      <Nav />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroBg}>
          <img src="/images/Hero.jpg" alt="" className={styles.heroImg} />
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
              {phase === 1 && (
                <span className={styles.upcomingBadge}>Save the Date</span>
              )}
              {phase === 2 && (
                <span className={styles.upcomingBadge}>Registration Opens Soon</span>
              )}
              {phase === 3 && (
                <span className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  Registration Open
                </span>
              )}
              {phase === 4 && (
                <span className={styles.finishedBadge}>Logistics Seeding</span>
              )}
              <span className={styles.formatBadge}>Single Elimination</span>
            </div>

            <h1 className={styles.heroTitle}>{tournament.title}</h1>

            <div className={styles.heroMeta}>
              <span className={styles.heroMetaItem}>
                <MapPin size={15} />
                {tournament.location}
              </span>
              <span className={styles.heroMetaItem}>
                <Calendar size={15} />
                {tournament.date}
              </span>
              {courtCount > 0 && (
                <span className={styles.heroMetaItem}>
                  <Users size={15} />
                  {courtCount} courts
                </span>
              )}
            </div>

            <div className={styles.heroActions}>
              {phase === 1 && (
                <button className={styles.heroDisabled} disabled>
                  Registration Date Pending
                </button>
              )}
              {phase === 2 && (
                <button className={styles.heroDisabled} disabled>
                  Registration Opens Soon
                </button>
              )}
              {phase === 3 && (
                <Link
                  href={`/tournament/${params.id}/register`}
                  className={styles.heroPrimary}
                >
                  Register team
                  <ChevronRight size={16} />
                </Link>
              )}
              {phase === 4 && (
                <button className={styles.heroDisabled} disabled>
                  Registration Closed
                </button>
              )}
              
              <button className={styles.heroShare} onClick={toggleWatchlist}>
                {starred ? '★ Watching' : '☆ Watchlist'} ({watchlistCount})
              </button>
              <button className={styles.heroShare} onClick={() => alert('Link copied to clipboard!')}>
                Share event
              </button>
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
            {(['bracket', 'pool', 'schedule', 'teams', 'rules', 'vouchers'] as Tab[]).map(tab => (
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
              {activeDivision && activeDivision.bracket.length > 0 ? (
                <div className={styles.bracketScroll}>
                  <div className={styles.bracketGrid}>
                    {activeDivision.bracket.map((round) => (
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
              ) : (
                <p className={styles.poolNote}>No bracket scheduled yet for this division.</p>
              )}
            </div>
          )}

          {/* Pool standings */}
          {activeTab === 'pool' && (
            <div className={styles.poolSection}>
              <p className={styles.poolNote}>This division doesn&apos;t use pool play.</p>
            </div>
          )}

          {/* Schedule */}
          {activeTab === 'schedule' && (
            <div className={styles.scheduleSection}>
              {scheduleItems.length > 0 ? (
                <div className={styles.scheduleList}>
                  {scheduleItems.map((item, i) => (
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
              ) : (
                <p className={styles.poolNote}>No matches scheduled yet for this division.</p>
              )}
            </div>
          )}

          {/* Teams */}
          {activeTab === 'teams' && (
            <div className={styles.teamsSection}>
              <div className={styles.teamsGrid}>
                {(activeDivision?.teamsList ?? []).map((team) => (
                  <div key={team.seed} className={`${styles.teamCard} ${team.status === 'waitlist' ? styles.teamCardEliminated : ''}`}>
                    <div className={styles.teamSeed}>#{team.seed}</div>
                    <div className={styles.teamName}>{team.name}</div>
                    {team.status === 'waitlist' && (
                      <div className={styles.teamElimBadge}>Waitlist</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rules */}
          {activeTab === 'rules' && (
            <div className={styles.rulesSection}>
              <h2 className={styles.rulesTitle}>About this tournament</h2>
              <div className={styles.rulesContent}>
                {tournament.description || 'No description provided yet.'}
              </div>
              <h2 className={styles.rulesTitle}>Venue Information</h2>
              <div className={styles.rulesContent}>
                {tournament.location}
              </div>
            </div>
          )}

          {/* Vouchers */}
          {activeTab === 'vouchers' && (
            <div className={styles.vouchersSection}>
              <h2 className={styles.rulesTitle}>Sponsor Promotions &amp; Perks</h2>
              <div className={styles.vouchersGrid}>
                {tournament.vouchers.map(v => (
                  <div key={v.id} className={styles.voucherItemCard}>
                    <span className={styles.voucherTitle}>{v.title}</span>
                    <p className={styles.voucherDesc}>{v.description}</p>
                    <span className={styles.voucherCode}>PROMO CODE: {v.code}</span>
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
