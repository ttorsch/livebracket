'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  MapPin,
  Calendar,
  ArrowRight,
  ChevronDown,
  Mic
} from 'lucide-react';
import styles from './page.module.css';
import { DateChip } from '@/components/livebracket-ds';
import {
  getDashboardTournaments,
  getRecentlyCompletedDivisions,
  getHomepageStats,
  todayLocal,
  type DashboardTournament,
  type CompletedDivisionSlide,
  type HomepageStats,
} from '@/lib/data';

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
  startDate?: string; // ISO date, used to sort the hero's upcoming list
  endDate?: string; // ISO date, used for the recently-completed window
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

/* ── Real tournament data (events list) ─────────────────────────
   The events section below the hero is fed from the database; the
   hero's live pulse card and nearby banner keep their demo data. */

const CARD_ACCENTS = [
  'linear-gradient(135deg, #EA9836 0%, #F26749 100%)',
  'linear-gradient(135deg, #204ECF 0%, #2C6FB3 100%)',
  'linear-gradient(135deg, #F26749 0%, #C93E63 100%)',
  'linear-gradient(135deg, #1F8A70 0%, #204ECF 100%)',
];

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/* "Oct 3, 2026" + "Oct 4, 2026" -> "Oct 3 - Oct 4, 2026" (year printed once). */
function formatDateRange(start: string, end?: string): string {
  if (!end || end === start) return start;
  const [startMd, startYear] = start.split(', ');
  const [endMd, endYear] = end.split(', ');
  if (startYear && startYear === endYear) return `${startMd} \u2013 ${endMd}, ${endYear}`;
  return `${start} \u2013 ${end}`;
}

/* Status pill copy. Long form rides the desktop poster, short form the
   mobile row. "Filling" once any division passes 80% of its seats. */
function statusLabels(t: Tournament): { long: string; short: string } {
  if (t.status === 'live') return { long: 'Live now', short: 'Live' };
  const fullest = (t.registrations || []).reduce(
    (max, r) => (r.total > 0 ? Math.max(max, r.filled / r.total) : max),
    0
  );
  if (fullest >= 0.8) return { long: 'Filling fast', short: 'Filling' };
  return { long: 'Registration open', short: 'Open' };
}

function toEventCard(t: DashboardTournament, index: number, organizerName: string | null): Tournament {
  const today = todayLocal();
  const end = t.endDate || t.startDate;
  const status: Status =
    end < today ? 'finished' : t.startDate <= today ? 'live' : 'upcoming';
  const start = new Date(`${t.startDate}T00:00:00`);
  const name = organizerName || 'Live Bracket';
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return {
    id: t.id,
    title: t.title,
    location: t.location,
    dateLabel: shortDate(t.startDate),
    startDate: t.startDate,
    endDate: end,
    endDateLabel: end !== t.startDate ? shortDate(end) : undefined,
    chip: {
      m: start.toLocaleDateString('en-US', { month: 'short' }),
      d: String(start.getDate()).padStart(2, '0'),
    },
    status,
    teams: t.divisions.reduce((sum, d) => sum + d.filled, 0),
    format: `${t.divisions.length || 'No'} division${t.divisions.length === 1 ? '' : 's'}`,
    accent: CARD_ACCENTS[index % CARD_ACCENTS.length],
    divisions: t.divisions.map(d => d.name),
    image: t.imageUrl || '/images/Hero.jpg',
    timeLabel: '',
    registrations: t.divisions.map(d => ({ division: d.name, filled: d.filled, total: d.cap })),
    organizerName: name,
    organizerInitials: initials,
  };
}

const getPlayerInitial = (name: string) => {
  return name ? name.charAt(0).toUpperCase() : '?';
};

function CompletedSlideshow({ slides, styles }: { slides: CompletedDivisionSlide[]; styles: Record<string, string> }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, 10000);
    return () => clearInterval(timer);
  }, [slides.length]);

  const currentSlide = slides[active] || slides[0];
  if (!currentSlide) return null;

  return (
    <div className={styles.completedSection}>
      <h3 className={styles.completedTitle}>Recently Completed</h3>
      <div className={styles.completedSlideshow}>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={currentSlide.id}
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
            {/* Line 1: title left + division badge · date pill + location right */}
            <div className={styles.completedMetaRow}>
              <div className={styles.completedTitleGroup}>
                <h4 className={styles.completedCardTitle}>{currentSlide.tournamentTitle}</h4>
                {currentSlide.divisionName && (
                  <span className={styles.completedDivisionBadge}>{currentSlide.divisionName}</span>
                )}
              </div>
              <div className={styles.completedMetaRight}>
                <span className={styles.completedDatePill}>{currentSlide.dateLabel}</span>
                <span className={styles.completedLocation}>
                  <MapPin size={12} strokeWidth={2} />
                  {currentSlide.location}
                </span>
              </div>
            </div>

            {/* Body: champion center */}
            <div className={styles.completedBody}>
              {currentSlide.winners && currentSlide.winners.length > 0 && (
                <div className={styles.completedChampionBlock}>
                  <div className={styles.completedTrophyIcon}>🏆</div>
                  <div className={styles.completedChampionRow}>
                    {currentSlide.winners.length === 1 ? (
                      <>
                        <div className={styles.completedChampionAvatars}>
                          <div className={styles.completedAvatar}>
                            {currentSlide.winners[0].split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        </div>
                        <span className={styles.completedPlayerName}>{currentSlide.winners[0]}</span>
                      </>
                    ) : currentSlide.winners.length === 2 ? (
                      <>
                        <span className={styles.completedPlayerName}>{currentSlide.winners[0]}</span>
                        <div className={styles.completedChampionAvatars}>
                          {currentSlide.winners.map((name, i) => (
                            <div key={i} className={styles.completedAvatar}>
                              {name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                          ))}
                        </div>
                        <span className={styles.completedPlayerName}>{currentSlide.winners[1]}</span>
                      </>
                    ) : (
                      <>
                        <div className={styles.completedChampionAvatars}>
                          {currentSlide.winners.slice(0, 4).map((name, i) => (
                            <div key={i} className={styles.completedAvatar}>
                              {name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                          ))}
                        </div>
                        <span className={styles.completedPlayerName}>{currentSlide.winners.join(' & ')}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={styles.completedFooter}>
              <Link href={`/tournament/${currentSlide.tournamentId}`} className={styles.completedLink}>
                View Standing
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>

        {slides.length > 1 && (
          <div className={styles.completedDots}>
            {slides.map((_, i) => (
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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Live Match Carousel State
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [liveMatches, setLiveMatches] = useState<CarouselMatch[]>(CAROUSEL_MATCHES);

  // User Geolocation & Upcoming Banner
  const [userLoc, setUserLoc] = useState<string>('Khao Lak');
  const [nearbyEvent, setNearbyEvent] = useState<Tournament | null>(() => TOURNAMENTS.find((t) => t.status === 'upcoming') || null);

  // Events list — real tournaments from the database (announced and later;
  // drafts stay hidden from the public page).
  const [events, setEvents] = useState<Tournament[]>([]);
  const [completedSlides, setCompletedSlides] = useState<CompletedDivisionSlide[]>([]);
  const [realStats, setRealStats] = useState<HomepageStats>({ upcomingMatches: 0, registeredTeams: 0 });
  const [eventsLoaded, setEventsLoaded] = useState(false);

  const upcomingMatchesCount = useMemo(() => {
    return realStats.upcomingMatches;
  }, [realStats]);

  const registeredTeamsCount = useMemo(() => {
    const fromEvents = events.reduce((sum, t) => sum + (t.teams || 0), 0);
    return realStats.registeredTeams > 0 ? realStats.registeredTeams : fromEvents;
  }, [realStats, events]);

  const activeLiveCount = useMemo(() => {
    const liveTournaments = events.filter(e => e.status === 'live');
    return liveTournaments.length;
  }, [events]);

  useEffect(() => {
    Promise.all([
      getDashboardTournaments(),
      getRecentlyCompletedDivisions(14),
      fetch('/api/organizer').then(r => r.json()).catch(() => null),
      getHomepageStats(),
    ])
      .then(([rows, slides, organizer, statsData]) => {
        const cards = rows
          .filter(t => t.phase >= 2)
          .map((t, i) => toEventCard(t, i, organizer?.name ?? null));
        setEvents(cards);
        setCompletedSlides(slides);
        if (statsData) {
          const totalFromRows = rows.reduce((sum, t) => sum + t.divisions.reduce((dSum, d) => d.filled, 0), 0);
          setRealStats({
            upcomingMatches: statsData.upcomingMatches,
            registeredTeams: statsData.registeredTeams > 0 ? statsData.registeredTeams : totalFromRows,
          });
        }
      })
      .catch(console.error)
      .finally(() => setEventsLoaded(true));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
            if (res.ok) {
              const data = await res.json();
              const city = data.address?.city || data.address?.town || data.address?.municipality || data.address?.county || data.address?.state || 'Phang Nga';
              setUserLoc(city);
            } else {
              setUserLoc('Phang Nga');
            }
          } catch {
            setUserLoc('Phang Nga');
          }
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

  // Hero pulse card mode: the live scoreboard only makes sense while a real
  // tournament is running. With none live, the card lists the three
  // soonest-starting tournaments instead. Until the fetch resolves we keep the
  // live layout so the card doesn't flash the empty upcoming state.
  const hasLiveTournament = useMemo(
    () => events.some((t) => t.status === 'live'),
    [events]
  );
  const showLiveCard = !eventsLoaded || hasLiveTournament;

  const upcomingSoon = useMemo(() => {
    return events
      .filter((t) => t.status === 'upcoming')
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
      .slice(0, 3);
  }, [events]);

  // Filter lists based on Search input and Filter tabs.
  const filteredActiveUpcoming = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((t) => {
      if (t.status === 'finished') return false;
      if (filter === 'live' && t.status !== 'live') return false;
      if (filter === 'upcoming' && t.status !== 'upcoming') return false;
      if (filter === 'finished') return false;
      if (q && !(`${t.title} ${t.location}`.toLowerCase().includes(q))) return false;
      return true;
    });
    // getDashboardTournaments returns rows ordered by start date, so
    // live events (earliest) lead and the nearest upcoming follow.
  }, [events, filter, query]);

  const filteredCompletedSlides = useMemo(() => {
    if (filter === 'live' || filter === 'upcoming') return [];
    const q = query.trim().toLowerCase();
    if (!q) return completedSlides;
    return completedSlides.filter(
      (s) =>
        s.tournamentTitle.toLowerCase().includes(q) ||
        s.location.toLowerCase().includes(q) ||
        s.divisionName.toLowerCase().includes(q) ||
        s.winners.some((w) => w.toLowerCase().includes(q))
    );
  }, [completedSlides, filter, query]);

  const uniqueCompletedTournamentCount = useMemo(() => {
    const ids = new Set(filteredCompletedSlides.map((s) => s.tournamentId));
    return ids.size;
  }, [filteredCompletedSlides]);

  const totalEventCount = useMemo(() => {
    if (filter === 'finished') return uniqueCompletedTournamentCount;
    return filteredActiveUpcoming.length + (filter === 'all' ? uniqueCompletedTournamentCount : 0);
  }, [filter, filteredActiveUpcoming.length, uniqueCompletedTournamentCount]);

  const hasAnyResults = filteredActiveUpcoming.length > 0 || filteredCompletedSlides.length > 0;

  return (
    <div className={styles.page} id="top">
      
      {/* ── Morphing Navigation Bar (Desktop Search & Action Buttons) ───────── */}
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
            <span className={styles.brandText}>LIVE BRACKET</span>
          </Link>

          {/* Desktop Center Search Bar */}
          <div className={styles.navSearchWrapper}>
            <div className={styles.navSearchPill}>
              <Search size={16} className={styles.navSearchIcon} />
              <input
                type="text"
                placeholder="Find a tournament"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className={styles.navSearchInput}
              />
              <Mic size={15} className={styles.navMicIcon} />
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className={styles.navRightActions}>
            <Link href="/login" className={styles.navSignInLink}>
              Sign In
            </Link>
            <Link href="/login?role=organizer" className={styles.navCreateBtn}>
              Create a tournament
            </Link>

            {/* Mobile Search Button */}
            <button 
              className={styles.mobileSearchToggle}
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
              aria-label="Toggle search"
            >
              <Search size={18} />
            </button>
          </div>
        </div>
        
        {/* Mobile Search Dropdown */}
        {mobileSearchOpen && (
          <div className={styles.mobileSearchDropdown}>
            <div className={styles.navSearchPill} style={{ width: '100%' }}>
              <Search size={16} className={styles.navSearchIcon} />
              <input
                type="text"
                placeholder="Find a tournament"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className={styles.navSearchInput}
                autoFocus
              />
            </div>
          </div>
        )}
      </header>

      {/* ── Redesigned Hero Section ──── */}
      <section className={styles.heroNew}>
        <div className={styles.container}>
          <div className={styles.heroNewGrid}>
            
            {/* Left Column: Headlines, CTAs, Stats */}
            <div className={styles.heroNewLeftCol}>
              <p className={styles.heroKicker}>KHAO LAK VOLLEY PRESENTS</p>
              <h1 className={styles.heroHeadline}>
                Every Point<br />live on one link
              </h1>
              <p className={styles.heroSubtitle}>
                Set up brackets, seed the draw in seconds, and update scores court-side. Players and spectators follow the same live link — no account needed.
              </p>

              <div className={styles.heroCtasRow}>
                <a href="#events" className={styles.heroPrimaryPill}>
                  See all tournaments
                </a>
                <button 
                  type="button" 
                  className={styles.heroSecondaryPill}
                  onClick={() => {
                    setFilter('live');
                    document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Watch a live match
                </button>
              </div>

              {/* Bottom Live Matches Indicator & Season Stats */}
              <div className={styles.heroStatsSection}>
                <button
                  type="button"
                  className={styles.heroNearYouBtn}
                  onClick={() => {
                    setQuery(userLoc);
                    document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <span className={styles.liveDotRed} />
                  <span className={styles.nearYouBold}>{activeLiveCount} {activeLiveCount === 1 ? 'match' : 'matches'} near you</span>
                  <span className={styles.nearYouSub}>{userLoc}</span>
                  <ArrowRight size={14} className={styles.nearYouArrow} />
                </button>

                <div className={styles.heroStatsRow}>
                  <div className={styles.heroStatItem}>
                    <span className={styles.heroStatNumber}>{upcomingMatchesCount}</span>
                    <span className={styles.heroStatLabel}>Upcoming matches</span>
                  </div>
                  <div className={styles.heroStatDivider} />
                  <div className={styles.heroStatItem}>
                    <span className={styles.heroStatNumber}>{registeredTeamsCount}</span>
                    <span className={styles.heroStatLabel}>Registered teams</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Featured Live Showcase Card */}
            <div className={styles.heroNewRightCol}>
              <div className={styles.showcaseCard}>
                <img 
                  src="/images/Hero.jpg" 
                  alt="Beach volleyball tournament in action" 
                  className={styles.showcaseImg} 
                />
                <div className={styles.showcaseGradientOverlay} />

                {/* Top Badges */}
                <div className={styles.showcaseTopRow}>
                  <span className={styles.showcaseLiveBadge}>
                    <span className={styles.liveDotWhite} />
                    LIVE
                  </span>
                  <span className={styles.showcaseCourtLabel}>Court 1 · Memories Beach</span>
                </div>

                {/* Middle Tournament Title */}
                <div className={styles.showcaseTournamentInfo}>
                  <h3 className={styles.showcaseTournamentTitle}>Khao Lak Open 2027</h3>
                  <p className={styles.showcaseTournamentSub}>Men · Quarterfinal</p>
                </div>

                {/* Bottom Floating Scoreboard Card */}
                <div className={styles.floatingScoreboard}>
                  <div className={styles.scoreboardHeader}>
                    <span className={styles.scoreboardStatus}>SET 3 · IN PROGRESS</span>
                    <span className={styles.scoreboardLiveIndicator}>
                      <span className={styles.liveDotRedSmall} />
                      LIVE
                    </span>
                  </div>

                  {/* Team A Row */}
                  <div className={styles.scoreboardTeamRow}>
                    <div className={styles.scoreboardTeamLeft}>
                      <span className={styles.scoreboardAvatar}>A/</span>
                      <span className={styles.scoreboardTeamName}>Aroon / Niran</span>
                    </div>
                    <div className={styles.scoreboardTeamRight}>
                      <span className={styles.scoreboardPrevSet}>21</span>
                      <span className={styles.scoreboardPrevSet}>19</span>
                      <span className={`${styles.scoreboardCurrentScore} ${styles.scoreLead}`}>2</span>
                    </div>
                  </div>

                  {/* Team B Row */}
                  <div className={styles.scoreboardTeamRow}>
                    <div className={styles.scoreboardTeamLeft}>
                      <span className={styles.scoreboardAvatar}>L/</span>
                      <span className={styles.scoreboardTeamName}>Lukas / Felix</span>
                    </div>
                    <div className={styles.scoreboardTeamRight}>
                      <span className={styles.scoreboardPrevSet}>18</span>
                      <span className={styles.scoreboardPrevSet}>21</span>
                      <span className={styles.scoreboardCurrentScore}>1</span>
                    </div>
                  </div>
                </div>
              </div>
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
              <h2 className={styles.sectionTitle}>Tournaments</h2>
              <p className={styles.resultCount}>
                {totalEventCount} {totalEventCount === 1 ? 'event' : 'events'}
              </p>
            </div>

            {/* Controls: search + sort/filter dropdown */}
            <div className={styles.controls}>
              <div className={styles.search}>
                <Search size={18} className={styles.searchIconLeft} />
                <input
                  type="search"
                  placeholder="Search tournaments"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search tournaments"
                />
              </div>
              <div className={styles.sortSelect}>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as 'all' | Status)}
                  aria-label="Filter tournaments"
                >
                  {FILTERS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                <ChevronDown size={18} className={styles.sortSelectIcon} aria-hidden="true" />
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

            {/* Active & Upcoming Tournament List (Vertical Poster Card) */}
            {filteredActiveUpcoming.length > 0 && (
              <div className={styles.grid}>
                {filteredActiveUpcoming.map((t) => (
                  <article key={t.id} className={styles.card}>
                    <Link href={`/tournament/${t.id}`} className={styles.cardLink}>
                      <div className={styles.cardMedia}>
                        <img src={t.image} alt={t.title} className={styles.cardPoster} />
                      </div>

                      <div className={styles.cardBody}>
                        {/* Badge is absolutely positioned over the poster on desktop
                            and sits inline beside the title on the mobile row. */}
                        <div className={styles.cardTitleRow}>
                          <h3 className={styles.cardTitle}>{t.title}</h3>
                          <span
                            className={`${styles.cardStatusBadge} ${t.status === 'live' ? styles.cardStatusLive : ''}`}
                          >
                            <span className={styles.cardStatusDot} aria-hidden="true" />
                            <span className={styles.cardStatusLong}>{statusLabels(t).long}</span>
                            <span className={styles.cardStatusShort}>{statusLabels(t).short}</span>
                          </span>
                        </div>

                        <div className={styles.cardMetaList}>
                          <div className={styles.cardMetaRow}>
                            <Calendar size={17} className={styles.cardMetaIcon} />
                            <span className={styles.cardMetaText}>
                              {formatDateRange(t.dateLabel, t.endDateLabel)}
                            </span>
                          </div>
                          <div className={styles.cardMetaRow}>
                            <MapPin size={17} className={styles.cardMetaIcon} />
                            <span className={styles.cardMetaText}>{t.location}</span>
                          </div>
                        </div>

                        {t.registrations && (
                          <div className={styles.cardDivisionsSection}>
                            {t.registrations.map((reg, idx) => (
                              <div key={idx} className={styles.divisionItem}>
                                <div className={styles.divisionHeader}>
                                  <span className={styles.divisionName}>{reg.division}</span>
                                  <span className={styles.divisionSeats}>
                                    {reg.filled}/{reg.total}
                                    <span className={styles.divisionSeatsWord}> seats</span>
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
                      </div>
                    </Link>

                    <div className={styles.cardFooter}>
                      <div className={styles.organizerRow}>
                        <div className={styles.organizerAvatar}>
                          {t.organizerInitials || 'LB'}
                        </div>
                        <div className={styles.organizerMeta}>
                          <span className={styles.organizerLabel}>Organizer</span>
                          <span className={styles.organizerName}>
                            {t.organizerName || 'Live Bracket'}
                          </span>
                        </div>
                      </div>
                      <Link
                        href={t.status === 'live' ? `/tournament/${t.id}` : `/tournament/${t.id}/register`}
                        className={styles.cardRegisterBtn}
                      >
                        {t.status === 'live' ? 'View Bracket' : 'Register Team'}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Recently Completed Tournament Section (Slideshow) */}
            {filteredCompletedSlides.length > 0 && (
              <CompletedSlideshow slides={filteredCompletedSlides.slice(0, 8)} styles={styles} />
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
