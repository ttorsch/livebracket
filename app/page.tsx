'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  MapPin,
  Calendar,
  ArrowRight,
  Mic,
  Star
} from 'lucide-react';
import styles from './page.module.css';
import { DateChip } from '@/components/livebracket-ds';

type Status = 'live' | 'upcoming' | 'finished';

interface CarouselMatch {
  id: string;
  division: string;
  round: string;
  court: string;
  teamAPlayers: { firstName: string; lastName: string; flag: string }[];
  teamBPlayers: { firstName: string; lastName: string; flag: string }[];
  currentPointsA: number;
  currentPointsB: number;
  sets: { a: number; b: number }[];
  lastScorer?: 'A' | 'B';
}

interface RegistrationInfo {
  division: string;
  filled: number;
  total: number;
}

interface Tournament {
  id: string;
  title: string;
  location: string;
  dateLabel: string;
  endDateLabel?: string;
  chip: { m: string; d: string };
  status: Status;
  teams: number;
  format: string;
  accent: string; // CSS background for the card banner
  winner?: string;
  winners?: [string, string];
  divisions?: string[];
  image: string;
  timeLabel: string;
  registrations?: RegistrationInfo[];
  organizerName?: string;
  organizerInitials?: string;
}

function ProgressCircle({ filled, total }: { filled: number; total: number }) {
  const pct = Math.min(100, Math.max(0, (filled / total) * 100));
  const radius = 22;
  const strokeWidth = 2.5;
  const normalizedRadius = radius - strokeWidth;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className={styles.progressCircleContainer}>
      <svg
        height={radius * 2}
        width={radius * 2}
        className={styles.progressCircleSvg}
      >
        <circle
          stroke="rgba(20, 31, 46, 0.12)"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="var(--orange, #EE7A4C)"
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className={styles.progressCircleBar}
        />
      </svg>
      <span className={styles.progressCircleText}>{filled}/{total}</span>
    </div>
  );
}

function RollingDigit({ digit, className }: { digit: string; className?: string }) {
  return (
    <div className={`${styles.rollingDigitContainer} ${className || ''}`}>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={digit}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 30
          }}
          className={styles.activePoints}
          style={{
            position: 'absolute',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function RollingNumber({ value, className }: { value: number; className?: string }) {
  const digits = useMemo(() => String(value).split(''), [value]);

  return (
    <div style={{ display: 'inline-flex', overflow: 'hidden' }} className={className}>
      {digits.map((digit, idx) => (
        <RollingDigit key={`${idx}-${digit}`} digit={digit} className={className} />
      ))}
    </div>
  );
}

// Frontend-only sample data — stands in for a future /api/tournaments feed.
const TOURNAMENTS: Tournament[] = [
  {
    id: 'khao-lak-open-2027',
    title: 'Khao Lak Open 2027',
    location: 'Khao Lak, Phang Nga, Thailand',
    dateLabel: 'Apr 1, 2026',
    chip: { m: 'Apr', d: '01' },
    status: 'live',
    teams: 16,
    format: 'Double elimination',
    accent: 'linear-gradient(135deg, #F26749 0%, #EE7A4C 55%, #F2A24C 100%)',
    divisions: ['Men', 'Women', 'Mixed', 'U19 Men', 'U19 Women', 'Masters'],
    image: '/images/memories_beach_poster.png',
    timeLabel: '9:41 AM',
    registrations: [
      { division: 'Men', filled: 19, total: 24 },
      { division: 'Women', filled: 19, total: 24 },
    ],
    organizerName: 'Memories Beach Club',
    organizerInitials: 'MB',
  },
  {
    id: 'sunset-shootout',
    title: 'Sunset Shootout 3v3',
    location: 'White Sand Beach',
    dateLabel: 'Jun 28, 2026',
    chip: { m: 'Jun', d: '28' },
    status: 'upcoming',
    teams: 12,
    format: 'Pools → knockout',
    accent: 'linear-gradient(135deg, #EA9836 0%, #F26749 100%)',
    divisions: ['Men', 'Women', 'Mixed'],
    image: '/images/Hero.jpg',
    timeLabel: '4:00 PM',
    registrations: [
      { division: 'Men', filled: 10, total: 12 },
      { division: 'Women', filled: 8, total: 12 },
    ],
    organizerName: 'Sunset Sports Association',
    organizerInitials: 'SS',
  },
  {
    id: 'monsoon-cup',
    title: 'Monsoon Cup',
    location: 'Khuk Khak Beach',
    dateLabel: 'Jul 5, 2026',
    endDateLabel: 'Jul 6, 2026',
    chip: { m: 'Jul', d: '05' },
    status: 'upcoming',
    teams: 24,
    format: 'Single elimination',
    accent: 'linear-gradient(135deg, #204ECF 0%, #2C6FB3 100%)',
    divisions: ['Mixed'],
    image: '/images/Activity-league.jpg',
    timeLabel: '8:00 AM',
    registrations: [
      { division: 'Mixed', filled: 20, total: 24 },
    ],
    organizerName: 'Andaman Volley League',
    organizerInitials: 'AV',
  },
  {
    id: 'ladies-night-league',
    title: 'Ladies Night League',
    location: 'Bang Niang Beach',
    dateLabel: 'Jul 12, 2026',
    chip: { m: 'Jul', d: '12' },
    status: 'upcoming',
    teams: 8,
    format: 'Round robin',
    accent: 'linear-gradient(135deg, #83A5F2 0%, #204ECF 100%)',
    divisions: ['Women'],
    image: '/images/Activity-social.jpg',
    timeLabel: '6:00 PM',
    registrations: [
      { division: 'Women', filled: 6, total: 8 },
    ],
    organizerName: 'Phang Nga Volleyball',
    organizerInitials: 'PN',
  },
  {
    id: 'andaman-open',
    title: 'Andaman Open',
    location: 'Nang Thong Beach',
    dateLabel: 'Jul 19, 2026',
    endDateLabel: 'Jul 20, 2026',
    chip: { m: 'Jul', d: '19' },
    status: 'upcoming',
    teams: 32,
    format: 'Double elimination',
    accent: 'linear-gradient(135deg, #2C6FB3 0%, #83A5F2 100%)',
    divisions: ['Men', 'Women', 'Mixed'],
    image: '/images/VB activity - kl classic.jpg',
    timeLabel: '8:30 AM',
    registrations: [
      { division: 'Men', filled: 28, total: 32 },
      { division: 'Women', filled: 24, total: 32 },
    ],
    organizerName: 'Khao Lak Sports Club',
    organizerInitials: 'KL',
  },
  {
    id: 'full-moon-smash',
    title: 'Full Moon Smash',
    location: 'White Sand Beach',
    dateLabel: 'May 31, 2026',
    chip: { m: 'May', d: '31' },
    status: 'finished',
    teams: 16,
    format: 'Single elimination',
    accent: 'linear-gradient(135deg, #7A8294 0%, #3A414D 100%)',
    winner: 'Net Ninjas',
    winners: ['James Carter', 'Marco Silva'],
    divisions: ['Men', 'Women'],
    image: '/images/activity-khao lak classic.jpg',
    timeLabel: '9:00 AM',
    registrations: [
      { division: 'Men', filled: 16, total: 16 },
      { division: 'Women', filled: 16, total: 16 },
    ],
    organizerName: 'White Sand Beach Club',
    organizerInitials: 'WS',
  },
  {
    id: 'low-season-cup',
    title: 'Low Season Cup',
    location: 'Khuk Khak Beach',
    dateLabel: 'May 17, 2026',
    chip: { m: 'May', d: '17' },
    status: 'finished',
    teams: 12,
    format: 'Pools → knockout',
    accent: 'linear-gradient(135deg, #7A8294 0%, #14181E 100%)',
    winner: 'Beach Bums',
    winners: ['Sofia Reyes', 'Lena Müller'],
    divisions: ['Mixed'],
    image: '/images/activity-training.jpg',
    timeLabel: '2:00 PM',
    registrations: [
      { division: 'Mixed', filled: 12, total: 12 },
    ],
  },
];

// Carousel Slide Match Data Structure (aligned to user's layout references)
const CAROUSEL_MATCHES: CarouselMatch[] = [
  {
    id: 'match-1',
    division: "Men",
    round: "Quarterfinals",
    court: "Court 1",
    teamAPlayers: [
      { firstName: "Aroon", lastName: "Suwannarat", flag: "🇹🇭" },
      { firstName: "Niran", lastName: "Boonmee", flag: "🇹🇭" }
    ],
    teamBPlayers: [
      { firstName: "Lukas", lastName: "Weber", flag: "🇩🇪" },
      { firstName: "Felix", lastName: "Schmidt", flag: "🇩🇪" }
    ],
    currentPointsA: 2,
    currentPointsB: 1,
    sets: [
      { a: 21, b: 18 },
      { a: 19, b: 21 }
    ]
  },
  {
    id: 'match-2',
    division: "Women",
    round: "Semifinals",
    court: "Court 2",
    teamAPlayers: [
      { firstName: "Marie", lastName: "Fischer", flag: "🇩🇪" },
      { firstName: "Klara", lastName: "Hoffmann", flag: "🇩🇪" }
    ],
    teamBPlayers: [
      { firstName: "Larissa", lastName: "Souza", flag: "🇧🇷" },
      { firstName: "Talita", lastName: "Ferreira", flag: "🇧🇷" }
    ],
    currentPointsA: 15,
    currentPointsB: 12,
    sets: [
      { a: 21, b: 16 }
    ]
  },
  {
    id: 'match-3',
    division: "Mixed",
    round: "Final",
    court: "Court 1",
    teamAPlayers: [
      { firstName: "Sarah", lastName: "Tremblay", flag: "🇨🇦" },
      { firstName: "Melissa", lastName: "Roy", flag: "🇨🇦" }
    ],
    teamBPlayers: [
      { firstName: "Alix", lastName: "Moreau", flag: "🇫🇷" },
      { firstName: "Clémentine", lastName: "Girard", flag: "🇫🇷" }
    ],
    currentPointsA: 9,
    currentPointsB: 7,
    sets: [
      { a: 19, b: 21 },
      { a: 21, b: 17 }
    ]
  },
  {
    id: 'match-4',
    division: "Men",
    round: "Semifinals",
    court: "Court 3",
    teamAPlayers: [
      { firstName: "Pablo", lastName: "Garcia", flag: "🇪🇸" },
      { firstName: "Adrian", lastName: "Martinez", flag: "🇪🇸" }
    ],
    teamBPlayers: [
      { firstName: "Marco", lastName: "Rossi", flag: "🇮🇹" },
      { firstName: "Paolo", lastName: "Bianchi", flag: "🇮🇹" }
    ],
    currentPointsA: 4,
    currentPointsB: 6,
    sets: [
      { a: 21, b: 18 }
    ]
  },
  {
    id: 'match-5',
    division: "Women",
    round: "Quarterfinals",
    court: "Court 4",
    teamAPlayers: [
      { firstName: "Miki", lastName: "Tanaka", flag: "🇯🇵" },
      { firstName: "Megumi", lastName: "Sato", flag: "🇯🇵" }
    ],
    teamBPlayers: [
      { firstName: "Sophie", lastName: "Walker", flag: "🇦🇺" },
      { firstName: "Emma", lastName: "Mitchell", flag: "🇦🇺" }
    ],
    currentPointsA: 18,
    currentPointsB: 20,
    sets: [
      { a: 21, b: 19 },
      { a: 17, b: 21 }
    ]
  },
  {
    id: 'match-6',
    division: "Mixed",
    round: "Semifinals",
    court: "Court 2",
    teamAPlayers: [
      { firstName: "Emma", lastName: "Taylor", flag: "🇬🇧" },
      { firstName: "Liam", lastName: "Wilson", flag: "🇬🇧" }
    ],
    teamBPlayers: [
      { firstName: "Chloé", lastName: "Rochat", flag: "🇨🇭" },
      { firstName: "Noah", lastName: "Baumann", flag: "🇨🇭" }
    ],
    currentPointsA: 20,
    currentPointsB: 19,
    sets: [
      { a: 22, b: 20 },
      { a: 15, b: 21 }
    ]
  }
];

const FILTERS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'Latest' },
  { key: 'upcoming', label: 'Starting Soon' },
];

const STATUS_LABEL: Record<Status, string> = { 
  live: 'Live Now', 
  upcoming: 'Upcoming', 
  finished: 'Finished' 
};

const getPlayerInitial = (name: string) => {
  return name ? name.charAt(0).toUpperCase() : '?';
};

function CompletedSlideshow({ tournaments, styles }: { tournaments: Tournament[]; styles: Record<string, string> }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (tournaments.length <= 1) return;
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % tournaments.length);
    }, 10000);
    return () => clearInterval(timer);
  }, [tournaments.length]);

  const t = tournaments[active];

  return (
    <div className={styles.completedSection}>
      <h3 className={styles.completedTitle}>Recently Completed</h3>
      <div className={styles.completedSlideshow}>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={t.id}
            className={styles.completedCard}
            initial={{ clipPath: 'circle(8px at 50% 50%)', scale: 0.05, opacity: 1 }}
            animate={{ clipPath: 'circle(150% at 50% 50%)', scale: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{
              clipPath: { duration: 1.2, ease: [0.25, 1, 0.5, 1] },
              scale: { type: 'spring', stiffness: 120, damping: 26 },
            }}
            style={{ backdropFilter: 'blur(24px) saturate(200%)', WebkitBackdropFilter: 'blur(24px) saturate(200%)' }}
          >
            {/* Line 1: title left · date pill + location right */}
            <div className={styles.completedMetaRow}>
              <h4 className={styles.completedCardTitle}>{t.title}</h4>
              <div className={styles.completedMetaRight}>
                <span className={styles.completedDatePill}>{t.dateLabel}</span>
                <span className={styles.completedLocation}>
                  <MapPin size={12} strokeWidth={2} />
                  {t.location}
                </span>
              </div>
            </div>

            {/* Body: champion center */}
            <div className={styles.completedBody}>

              {t.winners && (
                <div className={styles.completedChampionBlock}>
                  <div className={styles.completedTrophyIcon}>🏆</div>
                  <div className={styles.completedChampionRow}>
                    <span className={styles.completedPlayerName}>{t.winners[0]}</span>
                    <div className={styles.completedChampionAvatars}>
                      {t.winners.map((name, i) => (
                        <div key={i} className={styles.completedAvatar}>
                          {name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      ))}
                    </div>
                    <span className={styles.completedPlayerName}>{t.winners[1]}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={styles.completedFooter}>
              <Link href={`#events`} className={styles.completedLink}>View Standing</Link>
            </div>
          </motion.div>
        </AnimatePresence>

        {tournaments.length > 1 && (
          <div className={styles.completedDots}>
            {tournaments.map((_, i) => (
              <button
                key={i}
                className={`${styles.completedDot} ${i === active ? styles.completedDotActive : ''}`}
                onClick={() => setActive(i)}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LiveBracketHome() {
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');

  // Morphing Navigation States
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Live Match Carousel State
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [liveMatches, setLiveMatches] = useState<CarouselMatch[]>(CAROUSEL_MATCHES);

  // User Geolocation & Upcoming Banner
  const [userLoc, setUserLoc] = useState<string>('Khao Lak');
  const [nearbyEvent, setNearbyEvent] = useState<Tournament | null>(() => TOURNAMENTS.find((t) => t.status === 'upcoming') || null);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLoc('Phang Nga');
        },
        () => {
          setUserLoc('Khao Lak');
        }
      );
    }
  }, []);

  // Auto-play the live match carousel (recreating the timer on index change resets the countdown on user click)
  useEffect(() => {
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % CAROUSEL_MATCHES.length);
    }, 9000);
    return () => clearInterval(timer);
  }, [carouselIndex]);

  // Simulate live score updates (incrementing exactly one side by +1 once per slide duration)
  useEffect(() => {
    // Schedule a single score update 3.5 seconds into the slide's 9-second lifetime
    const scoreTimer = setTimeout(() => {
      setLiveMatches((prevMatches) => {
        return prevMatches.map((match, idx) => {
          if (idx === carouselIndex) {
            // Alternating scoring randomly between Team A and Team B
            const isTeamA = Math.random() > 0.5;
            const currentA = match.currentPointsA;
            const currentB = match.currentPointsB;

            // Reset scores if they get too high (e.g. 25)
            const nextA = isTeamA ? (currentA >= 25 ? 0 : currentA + 1) : currentA;
            const nextB = !isTeamA ? (currentB >= 25 ? 0 : currentB + 1) : currentB;

            return {
              ...match,
              currentPointsA: nextA,
              currentPointsB: nextB,
              lastScorer: isTeamA ? 'A' : 'B'
            };
          }
          return match;
        });
      });
    }, 1800);

    return () => clearTimeout(scoreTimer);
  }, [carouselIndex]);

  const handleDotClick = (idx: number) => {
    setCarouselIndex(idx);
  };

  const scrollToTop = (e: React.MouseEvent) => {
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.history.pushState({}, '', '/');
    }
  };

  // Monitor scroll position to apply morphing layout transitions (desktop & mobile)
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      const isScrolled = y > 20;
      setScrolled(isScrolled);

      if (window.innerWidth < 960) {
        const enterStart = 20;
        const enterEnd = 100;
        // --enter-t is [0, 1] over scrollY [20, 100] drives logo shrink + transparent to glass
        const enterT = Math.min(1, Math.max(0, (y - enterStart) / (enterEnd - enterStart)));
        const nav = document.getElementById('livebracket-nav');
        nav?.style.setProperty('--enter-t', String(enterT));
        
        // --compact-t is [0, 1] over scrollY [100, 300] for additional mobile container shrink
        const compactZone = 200;
        const compactT = Math.min(1, Math.max(0, (y - enterEnd) / compactZone));
        nav?.style.setProperty('--compact-t', String(compactT));
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Find the active marquee tournament for the Hero right column.
  const marqueeTournament = useMemo(() => {
    return TOURNAMENTS.find((t) => t.status === 'live') || TOURNAMENTS[0];
  }, []);

  // Filter lists based on Search input and Filter tabs.
  const filteredActiveUpcoming = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOURNAMENTS.filter((t) => {
      if (t.status === 'finished') return false;
      if (filter === 'live' && t.status !== 'live') return false;
      if (filter === 'upcoming' && t.status !== 'upcoming') return false;
      if (filter === 'finished') return false;
      if (q && !(`${t.title} ${t.location}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [filter, query]);

  const filteredFinished = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOURNAMENTS.filter((t) => {
      if (t.status !== 'finished') return false;
      if (filter === 'live' || filter === 'upcoming') return false;
      if (q && !(`${t.title} ${t.location}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [filter, query]);

  const hasAnyResults = filteredActiveUpcoming.length > 0 || filteredFinished.length > 0;

  // Active slide match item
  const activeMatch = liveMatches[carouselIndex];

  return (
    <div className={styles.page} id="top">
      
      {/* ── Morphing Navigation Bar (Design System Portal) ───────── */}
      <header 
        id="livebracket-nav"
        className={`${styles.nav} ${scrolled ? styles.scrolled : styles.onHero}`}
      >
        <div 
          className={styles.navRow}
          style={{
            backdropFilter: 'var(--nav-backdrop-filter)',
            WebkitBackdropFilter: 'var(--nav-backdrop-filter)'
          }}
        >
          <Link href="/" className={styles.logo} aria-label="Live Bracket — home" onClick={scrollToTop}>
            <span className={styles.brandMark} aria-hidden="true">
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
            <li>
              <a href="#events" className={styles.link}>Tournaments</a>
            </li>
            <li>
              <Link href="/#community" className={styles.link}>Community & News</Link>
            </li>
            <li>
              <Link href="/#about" className={styles.link}>About</Link>
            </li>
          </ul>

          <div className={styles.actions}>
            <Link href="/login" className={styles.pillContact}>
              Sign In
            </Link>
            
            <button 
              className={styles.menuBtn}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                {menuOpen ? (
                  <path d="M5 5l10 10M5 15L15 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                ) : (
                  <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </div>
        
        {/* Mobile menu popup sheet */}
        {menuOpen && (
          <>
            <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
            <div className={styles.mobileMenu}>
              <a href="#events" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>
                Tournaments
              </a>
              <Link href="/#community" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>
                Community & News
              </Link>
              <Link href="/#about" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>
                About
              </Link>
              <Link href="/login" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>
                Sign In
              </Link>
              {/* TEMP: quick access to the organizer dashboard for testing — remove later */}
              <Link href="/dashboard" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>
                Dashboard
              </Link>
            </div>
          </>
        )}
      </header>

      {/* ── Asymmetrical "Pulse" Hero (Swapped Left and Right layout) ──── */}
      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden="true">
          <img src="/images/Hero.jpg" alt="Volleyball tournament background" className={styles.heroImg} />
          <div className={styles.heroScrim} />
        </div>
        <div className={styles.container} style={{ width: '100%' }}>
          <div className={styles.heroGrid}>
            
            {/* Swapped LEFT Column: Live "Pulse" Card Container */}
            <div className={styles.heroCardCol}>
              <div 
                className={styles.pulseCard}
                style={{
                  backdropFilter: 'blur(5px)',
                  WebkitBackdropFilter: 'blur(5px)'
                }}
              >
                
                {/* Event Header: LIVE NOW + Stacking Info */}
                <div className={styles.pulseHeader}>
                  <span className={styles.liveBadge}>
                    <span className={styles.liveDot} />
                    Live Now
                  </span>
                  <div className={styles.pulseHeaderDetails}>
                    <h2 className={styles.pulseTitle}>{marqueeTournament?.title}</h2>
                    <div className={styles.pulseDatesRow}>
                      <span className={styles.pulseDatePill}>{marqueeTournament?.dateLabel}</span>
                      <span className={styles.pulseDateTo}>to</span>
                      <span className={styles.pulseDatePill}>{marqueeTournament?.dateLabel}</span>
                    </div>
                    <p className={styles.pulseMeta}>
                      <MapPin size={13} style={{ marginRight: '6px' }} />
                      <span>{marqueeTournament?.location}</span>
                    </p>
                  </div>
                </div>

                <div className={styles.pulseDivider} />

                {/* Inner Match Card Container with Slide-in Ease Out from Top & fast disappear exit */}
                <AnimatePresence mode="popLayout">
                  <motion.div 
                    key={carouselIndex}
                    className={styles.carouselMatchCard}
                    initial={{ 
                      clipPath: 'circle(8px at 50% 50%)',
                      scale: 0.05,
                      opacity: 1
                    }}
                    animate={{ 
                      clipPath: 'circle(150% at 50% 50%)',
                      scale: 1,
                      opacity: 1
                    }}
                    exit={{ 
                      opacity: 0,
                      transition: { duration: 0 }
                    }}
                    transition={{
                      clipPath: { duration: 1.2, ease: [0.25, 1, 0.5, 1] },
                      scale: { type: 'spring', stiffness: 120, damping: 26 },
                      boxShadow: { type: 'spring', stiffness: 400, damping: 25 }
                    }}
                    style={{
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
                      background: 'rgba(255, 255, 255, 0.88)',
                      border: '1px solid rgba(255, 255, 255, 0.4)'
                    }}
                  >
                    <div className={styles.newCarouselContainer} style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%' }}>
                      
                      {/* Header Row */}
                      <div className={styles.newCarouselHeader}>
                        <span className={styles.newCarouselTitle}>
                          {activeMatch.division.toUpperCase()} • {activeMatch.round.toUpperCase()}
                        </span>
                        <span className={styles.newLiveBadge}>
                          <span className={styles.newLiveDot} />
                          LIVE
                        </span>
                      </div>

                      {/* Team A Row */}
                      <div className={`${styles.newTeamRow} ${activeMatch.currentPointsA >= activeMatch.currentPointsB ? styles.leadingTeam : styles.trailingTeam}`}>
                        <div className={styles.teamLeftGroup}>
                          <div className={styles.teamAvatarStack}>
                            {activeMatch.teamAPlayers.map((player, pIdx) => (
                              <div key={pIdx} className={styles.teamAvatarItem}>
                                {getPlayerInitial(player.lastName)}
                              </div>
                            ))}
                          </div>
                          <div className={styles.teamNameText}>
                            {activeMatch.teamAPlayers.map((player, pIdx) => (
                              <span key={pIdx} className={styles.teamNameLine}>{player.lastName}</span>
                            ))}
                          </div>
                        </div>
                        <div className={styles.teamRightGroup}>
                          <div className={styles.setHistoryRow}>
                            {activeMatch.sets.map((set, sIdx) => (
                              <span key={sIdx} className={styles.historyPointsValue}>
                                {set.a}
                              </span>
                            ))}
                          </div>
                          <RollingNumber
                            value={activeMatch.currentPointsA}
                            className={activeMatch.lastScorer === 'A' ? `${styles.livePoints} ${styles.livePointsActive}` : styles.livePoints}
                          />
                        </div>
                      </div>

                      {/* Divider */}
                      <div className={styles.newMatchDivider} />

                      {/* Team B Row */}
                      <div className={`${styles.newTeamRow} ${activeMatch.currentPointsB > activeMatch.currentPointsA ? styles.leadingTeam : styles.trailingTeam}`}>
                        <div className={styles.teamLeftGroup}>
                          <div className={styles.teamAvatarStack}>
                            {activeMatch.teamBPlayers.map((player, pIdx) => (
                              <div key={pIdx} className={styles.teamAvatarItem}>
                                {getPlayerInitial(player.lastName)}
                              </div>
                            ))}
                          </div>
                          <div className={styles.teamNameText}>
                            {activeMatch.teamBPlayers.map((player, pIdx) => (
                              <span key={pIdx} className={styles.teamNameLine}>{player.lastName}</span>
                            ))}
                          </div>
                        </div>
                        <div className={styles.teamRightGroup}>
                          <div className={styles.setHistoryRow}>
                            {activeMatch.sets.map((set, sIdx) => (
                              <span key={sIdx} className={styles.historyPointsValue}>
                                {set.b}
                              </span>
                            ))}
                          </div>
                          <RollingNumber
                            value={activeMatch.currentPointsB}
                            className={activeMatch.lastScorer === 'B' ? `${styles.livePoints} ${styles.livePointsActive}` : styles.livePoints}
                          />
                        </div>
                      </div>

                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Carousel Indicator Dots below inner card (remains static) */}
                <div className={styles.carouselIndicators} role="tablist" aria-label="Live Match Slides">
                  {liveMatches.map((_, idx) => (
                    <button
                      key={idx}
                      role="tab"
                      aria-selected={carouselIndex === idx}
                      className={`${styles.carouselDot} ${carouselIndex === idx ? styles.carouselDotActive : ''}`}
                      onClick={() => handleDotClick(idx)}
                      aria-label={`Go to live match slide ${idx + 1}`}
                    />
                  ))}
                </div>

                {/* Card Footer Peach CTA */}
                <div className={styles.pulseFooter}>
                  <Link 
                    href="#events" 
                    className={styles.pulseCta} 
                    onClick={() => setFilter('live')}
                    style={{
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)'
                    }}
                  >
                    See all division
                  </Link>
                </div>

              </div>
            </div>

            {/* Swapped RIGHT Column: Headline, paragraph text, and CTAs */}
            <div className={styles.heroTextCol}>
              <p className={styles.kicker}>Khao Lak Volley presents</p>
              <h1 className={styles.serifTitle}>
                LIVE BRACKET
              </h1>
              <p className={styles.heroSub}>
                Set up brackets, seed the draw in seconds, and update scores court-side. Share one live link so players and spectators can follow real-time scores and tournament standings.
              </p>
              <div className={styles.heroCtas}>
                <a href="#events" className={styles.heroPrimary}>
                  See all tournament <ArrowRight size={16} />
                </a>
              </div>
              {nearbyEvent && (
                <div 
                  className={styles.nearbyCard}
                  style={{
                    backdropFilter: 'blur(5px)',
                    WebkitBackdropFilter: 'blur(5px)'
                  }}
                >
                  <div className={styles.nearbyCardHeader}>
                    <span className={styles.nearbyCardKicker} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <MapPin size={12} style={{ color: 'var(--coral)' }} /> Phang Nga
                    </span>
                    <span className={styles.nearbyStatusPill}>Upcoming</span>
                  </div>
                  
                  <div className={styles.nearbyCardContent}>
                    <div className={styles.nearbyCardTextCol}>
                      <h3 className={styles.nearbyCardTitle}>{nearbyEvent.title}</h3>
                      
                      <div className={styles.nearbyCardMeta}>
                        <DateChip 
                          style={{
                            fontWeight: 700,
                            fontSize: '13.5px',
                            padding: '6px 14px',
                            border: 'none',
                            width: 'fit-content'
                          }}
                        >
                          {nearbyEvent.dateLabel}
                        </DateChip>
                        <span className={styles.nearbyMetaItem}>
                          <MapPin size={13} className={styles.nearbyMetaIcon} />
                          {nearbyEvent.location}
                        </span>
                      </div>
                    </div>

                    <Link 
                      href={`/tournament/${nearbyEvent.id}`} 
                      className={styles.nearbyArrowBtn}
                      aria-label="View tournament details"
                    >
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </section>

      {/* ── Content Body (Sticky Background Blobs Design System) ───── */}
      <div className={styles.contentBody}>
        <div className={styles.contentBg} aria-hidden="true" />

        {/* ── Events browser (Warm Sand Background overlaying blobs) ─── */}
        <section className={styles.events} id="events">
          <div className={styles.container}>
            
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>Tournaments</p>
                <h2 className={styles.sectionTitle}>
                  Find your <em>next match</em>.
                </h2>
              </div>
              <p className={styles.resultCount}>
                {filteredActiveUpcoming.length + filteredFinished.length} { (filteredActiveUpcoming.length + filteredFinished.length) === 1 ? 'event' : 'events' }
              </p>
            </div>

            {/* Controls: search + status filters */}
            <div className={styles.controls}>
              <div className={styles.searchRow}>
                <div className={styles.search}>
                  <Search size={18} className={styles.searchIconLeft} />
                  <input
                    type="search"
                    placeholder="Search tournaments"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search tournaments"
                  />
                  <Mic size={18} className={styles.searchIconRight} />
                </div>
              </div>
              <div className={styles.chips} role="tablist" aria-label="Filter by status">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`${styles.chip} ${filter === f.key ? styles.chipActive : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
                <button className={styles.favoriteBtn} aria-label="Add to favorites">
                  <Star size={16} style={{ marginRight: '8px' }} /> Add Favorite
                </button>
              </div>
            </div>

            {/* If everything is filtered out */}
            {!hasAnyResults && (
              <div className={styles.empty}>
                <p>No tournaments match that search query or filter.</p>
                <button
                  className={styles.linkBtn}
                  onClick={() => { setQuery(''); setFilter('all'); }}
                >
                  Clear filters
                </button>
              </div>
            )}

            {/* Active & Upcoming Tournament List (Horizontal Poster Layout) */}
            {filteredActiveUpcoming.length > 0 && (
              <div className={styles.grid}>
                {filteredActiveUpcoming.map((t) => (
                  <Link
                    key={t.id}
                    href={`#events`}
                    className={styles.card}
                    style={{
                      backdropFilter: 'blur(24px) saturate(200%)',
                      WebkitBackdropFilter: 'blur(24px) saturate(200%)',
                    }}
                  >
                    <div className={styles.cardImageCol}>
                      <img src={t.image} alt={t.title} className={styles.cardPoster} />
                    </div>
                    
                    <div className={styles.cardHeaderCol}>
                      <span
                        className={styles.cardTopGlassLayer}
                        aria-hidden="true"
                        style={{
                          backdropFilter: 'blur(15px) saturate(180%)',
                          WebkitBackdropFilter: 'blur(15px) saturate(180%)',
                        }}
                      />
                      <div className={styles.cardMainInfo}>
                        <h3 className={styles.cardTitle}>{t.title}</h3>

                        <div className={styles.cardPillsRow}>
                          <span className={styles.cardPillBadge}>{t.dateLabel}</span>
                          <span className={styles.cardPillTo}>to</span>
                          <span className={styles.cardPillBadge}>{t.endDateLabel || t.dateLabel}</span>
                        </div>

                        <div className={styles.cardLocationRow}>
                          <MapPin size={13} className={styles.cardLocIcon} />
                          <span className={styles.cardLocationText}>{t.location}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className={`${styles.cardDetailsCol} ${!t.registrations ? styles.cardDetailsNoReg : ''}`}>
                      <span
                        className={styles.cardGlassLayer}
                        aria-hidden="true"
                        style={{
                          backdropFilter: 'blur(15px) saturate(180%)',
                          WebkitBackdropFilter: 'blur(15px) saturate(180%)',
                        }}
                      />

                      {t.registrations && (
                        <div className={styles.cardDivisionsSection}>
                          {t.registrations.map((reg, idx) => (
                            <div key={idx} className={styles.divisionItem}>
                              <div className={styles.divisionHeader}>
                                <span className={styles.divisionName}>{reg.division}</span>
                                <span className={styles.divisionSeats}>
                                  <strong>{reg.filled}</strong>/{reg.total} seats
                                </span>
                              </div>
                              <div className={styles.progressBarBg}>
                                <div
                                  className={styles.progressBarFill}
                                  style={{ width: `${Math.min(100, (reg.filled / reg.total) * 100)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                          {t.divisions && t.divisions.length > t.registrations.length && (
                            <div className={styles.moreDivisionsText}>
                              + {t.divisions.length - t.registrations.length} more divisions available
                            </div>
                          )}
                        </div>
                      )}

                      <div className={styles.organizerRow}>
                        <div className={styles.organizerAvatar}>
                          {t.organizerInitials || 'LB'}
                        </div>
                        <span className={styles.organizerName}>
                          {t.organizerName || 'Live Bracket'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Recently Completed Tournament Section (Slideshow) */}
            {filteredFinished.length > 0 && (
              <CompletedSlideshow tournaments={filteredFinished.slice(0, 5)} styles={styles} />
            )}

          </div>
        </section>

        {/* ── Organizer CTA band ──────────────────────────────────── */}
        <section className={styles.ctaSection}>
          <div className={styles.container}>
            <div className={styles.ctaCard}>
              <h2 className={styles.ctaTitle}>Running a tournament this season?</h2>
              <p className={styles.ctaSub}>
                Set up your bracket in minutes and share one live link with the whole Khao Lak beach.
              </p>
              <div className={styles.ctaButtons}>
                <Link href="/login" className={styles.ctaPrimary}>
                  Create a tournament <ArrowRight size={16} />
                </Link>
                <a href="#events" className={styles.ctaSecondary}>Browse events</a>
              </div>
            </div>
          </div>
        </section>
        
      </div>
    </div>
  );
}
