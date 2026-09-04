'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  MapPin,
  Calendar,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mic,
  ArrowUpDown,
  Menu,
  X
} from 'lucide-react';
import styles from './page.module.css';
import { DateChip } from '@/components/livebracket-ds';
import {
  getPublicTournaments,
  getRecentlyCompletedDivisions,
  getHomepageStats,
  todayLocal,
  type DashboardTournament,
  type CompletedDivisionSlide,
  type HomepageStats,
} from '@/lib/data';
import { useSignInHref, saveScrollPosition, useRestoreScrollPosition } from '@/components/auth/useSignInHref';
import { useSession } from '@/components/auth/AuthProvider';
import AccountButton from '@/components/auth/AccountButton';
import { registrationState } from '@/lib/tournamentLifecycle';
import {
  fetchHeroLiveMatches,
  nextSlots,
  EMPTY_SLOTS,
  type HeroLiveMatch,
  type HeroPlayer,
  type SlotState,
} from '@/lib/heroLive';

type Status = 'live' | 'upcoming' | 'finished';

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
  rawDivisions?: {
    name: string;
    cap: number;
    filled: number;
    registrationOpens?: string;
    registrationCloses?: string;
  }[];
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
          stroke="var(--color-primary, #EB6F43)"
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
      <AnimatePresence initial={false}>
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
        /* Keyed by position, not by value. Keying on the digit remounted the
           whole RollingDigit on every change, which threw away the
           AnimatePresence inside it — the new span mounted at its `initial`
           offset and never animated off it, so a score that ticked over
           simply vanished. Held steady, the inner AnimatePresence does the
           work it was written for: old digit out, new digit in. */
        <RollingDigit key={idx} digit={digit} className={className} />
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

type StatusFilter = 'all' | Status;
type SortOption = 'latest' | 'soonest';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All Statuses' },
  { key: 'live', label: 'Live Now' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'finished', label: 'Finished' },
];

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'latest', label: 'Latest' },
  { key: 'soonest', label: 'Soonest' },
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
function statusLabels(t: Tournament): {
  long: string;
  short: string;
  variant: 'live' | 'finished' | 'announced' | 'open' | 'waitlist' | 'closed';
} {
  if (t.status === 'live') return { long: 'Live now', short: 'Live now', variant: 'live' };
  if (t.status === 'finished') return { long: 'Finished', short: 'Finished', variant: 'finished' };

  const rawDivs = t.rawDivisions ?? [];
  if (rawDivs.length === 0) {
    return { long: 'Announced', short: 'Announced', variant: 'announced' };
  }

  const regState = registrationState(
    rawDivs.map((d) => ({
      registrationOpens: d.registrationOpens || '',
      registrationCloses: d.registrationCloses || '',
    })),
    new Date(),
  );

  if (regState === 'opens-soon' || regState === null) {
    return { long: 'Announced', short: 'Announced', variant: 'announced' };
  }

  if (regState === 'closed') {
    return { long: 'Registration Closed', short: 'Closed', variant: 'closed' };
  }

  // regState is 'open'
  const allFull = rawDivs.length > 0 && rawDivs.every((d) => d.cap > 0 && d.filled >= d.cap);
  if (allFull) {
    return { long: 'Waitlist Open', short: 'Waitlist', variant: 'waitlist' };
  }

  const fullest = (t.registrations || []).reduce(
    (max, r) => (r.total > 0 ? Math.max(max, r.filled / r.total) : max),
    0
  );
  if (fullest >= 0.8) return { long: 'Filling fast', short: 'Filling fast', variant: 'open' };
  return { long: 'Open Registration', short: 'Open Registration', variant: 'open' };
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
    rawDivisions: t.divisions,
    image: t.imageUrl || '/images/Hero.jpg',
    timeLabel: '',
    registrations: t.divisions.map(d => ({ division: d.name, filled: d.filled, total: d.cap })),
    organizerName: name,
    organizerInitials: initials,
  };
}

function generatePaginationItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 6) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, 'ellipsis', total];
  }
  if (current >= total - 2) {
    return [1, 'ellipsis', total - 3, total - 2, total - 1, total];
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
}

function TournamentCard({
  t,
  styles,
  saveScrollPosition,
}: {
  t: Tournament;
  styles: Record<string, string>;
  saveScrollPosition: (path: string) => void;
}) {
  const labelInfo = statusLabels(t);
  const badgeClass =
    labelInfo.variant === 'live'
      ? styles.cardStatusLive
      : labelInfo.variant === 'finished'
      ? styles.cardStatusFinished
      : labelInfo.variant === 'announced'
      ? styles.cardStatusAnnounced
      : labelInfo.variant === 'closed'
      ? styles.cardStatusClosed
      : '';
  const isRegisterable = labelInfo.variant === 'open' || labelInfo.variant === 'waitlist';
  const href = isRegisterable ? `/tournament/${t.id}/register` : `/tournament/${t.id}`;
  const btnLabel =
    t.status === 'live'
      ? 'View Bracket'
      : t.status === 'finished'
      ? 'View Standings'
      : isRegisterable
      ? 'Register Team'
      : 'View Details';

  return (
    <article className={styles.card}>
      <Link
        href={`/tournament/${t.id}`}
        className={styles.cardLink}
        onClick={() => saveScrollPosition('/')}
      >
        <div className={styles.cardMedia}>
          <img src={t.image} alt={t.title} className={styles.cardPoster} />
        </div>

        <div className={styles.cardBody}>
          <div className={styles.cardTitleRow}>
            <h3 className={styles.cardTitle}>{t.title}</h3>
            <span className={`${styles.cardStatusBadge} ${badgeClass}`}>
              <span className={styles.cardStatusDot} aria-hidden="true" />
              <span className={styles.cardStatusLong}>{labelInfo.long}</span>
              <span className={styles.cardStatusShort}>{labelInfo.short}</span>
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
          href={href}
          className={styles.cardRegisterBtn}
          onClick={() => saveScrollPosition('/')}
        >
          {btnLabel}
        </Link>
      </div>
    </article>
  );
}

function PaginationControl({
  currentPage,
  totalPages,
  goToPage,
  styles,
}: {
  currentPage: number;
  totalPages: number;
  goToPage: (page: number, shouldScroll?: boolean) => void;
  styles: Record<string, string>;
}) {
  if (totalPages <= 1) return null;

  const paginationItems = generatePaginationItems(currentPage, totalPages);

  return (
    <nav className={styles.paginationContainer} aria-label="Tournament pagination">
      <button
        type="button"
        className={styles.paginationArrowBtn}
        onClick={() => goToPage(currentPage - 1, true)}
        disabled={currentPage <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft size={18} strokeWidth={2.2} />
      </button>

      <div className={styles.paginationNumbers}>
        {paginationItems.map((item, idx) => {
          if (item === 'ellipsis') {
            return (
              <span key={`ell-${idx}`} className={styles.paginationEllipsis}>
                ...
              </span>
            );
          }
          const isActive = item === currentPage;
          const nextItem = paginationItems[idx + 1];
          const showDot = typeof nextItem === 'number';

          return (
            <div key={item} className={styles.paginationItemWrapper}>
              <button
                type="button"
                className={`${styles.pageNumberBtn} ${isActive ? styles.pageNumberBtnActive : ''}`}
                onClick={() => goToPage(item, true)}
                aria-label={`Page ${item}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {item}
              </button>
              {showDot && (
                <span className={styles.paginationDot} aria-hidden="true">
                  •
                </span>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.paginationArrowBtn}
        onClick={() => goToPage(currentPage + 1, true)}
        disabled={currentPage >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight size={18} strokeWidth={2.2} />
      </button>
    </nav>
  );
}

const getPlayerInitial = (name: string) => {
  return name ? name.charAt(0).toUpperCase() : '?';
};

/* A team, as two overlapping circles: each player's photo where they have
 * one on their profile, their initial where they don't. Capped at two —
 * beyond a pair the stack stops reading as a team and starts reading as a
 * crowd. */
function HeroAvatars({ players }: { players: HeroPlayer[] }) {
  const pair = players.slice(0, 2);
  const slots = pair.length > 0 ? pair : [{ name: '', avatarUrl: null }];

  return (
    <span className={styles.scoreboardAvatarStack} aria-hidden="true">
      {slots.map((p, i) => (
        <span key={i} className={styles.scoreboardAvatar}>
          {p.avatarUrl
            ? <img src={p.avatarUrl} alt="" className={styles.scoreboardAvatarImg} />
            : getPlayerInitial(p.name)}
        </span>
      ))}
    </span>
  );
}

/* ── The beats of a card swap ─────────────────────────────────────
 *
 * A court being replaced plays out in four, in this order: the outgoing
 * card slides away, the incoming one appears as a miniature of itself at
 * the top right of the slot and extends to full size, it holds a moment
 * as a finished card, and only then does its score roll in. Slow enough
 * to read as a sequence rather than a flicker.
 *
 * They live together because each beat starts where the last one ends —
 * written out separately they would drift apart on the first edit, and
 * the score's cue is the whole entrance having finished. */
const CARD_EXIT_S = 0.3;
const CARD_MORPH_S = 1.4;
const SCORE_HOLD_S = 0.1;
const SCORE_ROLL_DELAY_MS = (CARD_EXIT_S + CARD_MORPH_S + SCORE_HOLD_S) * 1000;
/* Small enough to read as a card that hasn't grown yet rather than as a
 * card sliding in — about 35px across, with its corners still rounded. */
const CARD_SEED_SCALE = 0.12;

/* One court, as the hero card draws it: what and when on the first line,
 * which division and round on the second, then the two teams.
 *
 * `rollDelayMs` is 0 for the cards already on screen when the page loads —
 * they have no entrance to wait for, and a scoreboard that withheld its
 * scores for the length of an entrance it never played would just
 * look broken. */
function HeroScoreboard({ match, rollDelayMs }: { match: HeroLiveMatch; rollDelayMs: number }) {
  const isLive = match.status === 'live';

  /* The entrance replays the last point rather than just revealing the
   * score. The card arrives reading what the board read a moment ago —
   * 1–2 — holds there while it settles, and then the point lands: 2 rolls
   * to 3, on its own. The other number doesn't move, because the digits
   * animate on a *change* and that side's hasn't changed.
   *
   * lastScorer names the side that won the most recent point, so backing
   * that side off by one is the score before it. Right after a set closes
   * the running score is 0–0 while lastScorer still points at whoever won
   * the set, and the clamp below leaves both sides alone — there is no
   * point in this set to replay. */
  const [rolled, setRolled] = useState(rollDelayMs === 0);
  useEffect(() => {
    if (rolled) return;
    const t = setTimeout(() => setRolled(true), rollDelayMs);
    return () => clearTimeout(t);
  }, [rolled, rollDelayMs]);

  const replaying = !rolled && isLive && match.lastScorer !== null;
  const shownA = replaying && match.lastScorer === 'a' ? Math.max(0, match.pointsA - 1) : match.pointsA;
  const shownB = replaying && match.lastScorer === 'b' ? Math.max(0, match.pointsB - 1) : match.pointsB;
  /* Same clock either way — the word in front of it is what says whether
   * the match has started. */
  const when = match.startTime
    ? (isLive ? match.startTime : `Starts ${match.startTime}`)
    : '';

  return (
    <div className={styles.floatingScoreboard}>
      <div className={styles.scoreboardHeadGroup}>
        <div className={styles.scoreboardHeader}>
          <span className={styles.scoreboardStatus}>
            {[match.court, when].filter(Boolean).join(' \u00b7 ')}
          </span>
          {isLive && (
            /* Per court, not per card: with two courts stacked, one can be
               in play while the other is still waiting. */
            <span className={styles.scoreboardLiveIndicator}>
              <span className={styles.liveDotRedSmall} />
              LIVE
            </span>
          )}
        </div>
        <div className={styles.scoreboardSubHeader}>
          {[match.division, match.round].filter(Boolean).join(' \u00b7 ')}
        </div>
      </div>

      <HeroScoreRow
        team={match.teamA}
        setPoints={match.sets.map((v) => v.a)}
        points={shownA}
        live={isLive}
        /* The accent lands with the point, not before it — during the
           replay neither side has won it yet. */
        scored={rolled && isLive && match.lastScorer === 'a'}
      />
      <HeroScoreRow
        team={match.teamB}
        setPoints={match.sets.map((v) => v.b)}
        points={shownB}
        live={isLive}
        scored={rolled && isLive && match.lastScorer === 'b'}
      />
    </div>
  );
}

/* One side of the hero scoreboard: who they are, the sets they have
 * already finished, and the points in the set on court. */
function HeroScoreRow({
  team,
  setPoints,
  points,
  live,
  scored,
}: {
  team: HeroLiveMatch['teamA'];
  setPoints: number[];
  points: number;
  live: boolean;
  scored: boolean;
}) {
  return (
    <div className={styles.scoreboardTeamRow}>
      <div className={styles.scoreboardTeamLeft}>
        <HeroAvatars players={team.players} />
        <span className={`${styles.scoreboardTeamName} ${scored ? styles.scoreboardTeamScored : ''}`}>
          {team.name}
        </span>
      </div>
      <div className={styles.scoreboardTeamRight}>
        {setPoints.map((v, i) => (
          <span key={i} className={styles.scoreboardPrevSet}>{v}</span>
        ))}
        {live ? (
          /* Rolls the whole number rather than each digit. Per-digit
             rolling needs figures of uniform width, and the UI font has
             none — measured, `tabular-nums` is a no-op on it — so a fixed
             digit box clips a 0 and leaves a 1 stranded in the middle of
             it, printing 11 as "1 1". The accent still follows the last
             point, as on the organizer's court board. */
          <RollingDigit
            digit={String(points)}
            className={`${styles.scoreboardRolling} ${scored ? styles.scoreboardRollingScored : ''}`}
          />
        ) : (
          <span className={styles.scoreboardUpcomingScore}>&ndash;</span>
        )}
      </div>
    </div>
  );
}

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
              <Link
                href={`/tournament/${currentSlide.tournamentId}`}
                className={styles.completedLink}
                onClick={() => saveScrollPosition('/')}
              >
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
  // "Sign in" returns the visitor to this page, not to /profile.
  const signInHref = useSignInHref('player');
  /* Both land on the login form's Organizer tab, but on different forms:
   * "Create a tournament" promises a new account, so it opens sign-up;
   * "Organizer login" is for someone who already has one. */
  const createHref = useSignInHref('organizer', 'signup');
  const organizerHref = useSignInHref('organizer');
  /* Signed in, both of those controls are answers to a question already
   * settled — and "Sign In" was worse than useless: middleware bounced it
   * straight back here, so the page reloaded and still said Sign In. They
   * give way to the account button. */
  const { signedIn } = useSession();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('latest');
  const [query, setQuery] = useState('');

  // Pagination & Mobile Swipe States
  const [currentPage, setCurrentPage] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const mobileSwipeRef = useRef<HTMLDivElement>(null);
  const eventsSectionRef = useRef<HTMLElement>(null);

  // Navigation States & Ref
  const navRef = useRef<HTMLElement>(null);
  const tournamentSearchInputRef = useRef<HTMLInputElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Hero pulse card — the courts actually in play, from /api/live/now.
  const [heroMatches, setHeroMatches] = useState<HeroLiveMatch[]>([]);
  const [heroLoaded, setHeroLoaded] = useState(false);
  /* Which two courts are on screen. The ref is the working copy the next
   * poll reasons from; the state is what React draws. They are set
   * together, in the fetch callback, so the slot rules never run during a
   * render. */
  const heroSlotsRef = useRef<SlotState>(EMPTY_SLOTS);
  const [heroSlots, setHeroSlots] = useState<SlotState>(EMPTY_SLOTS);
  /* How long a card mounting from here on should hold its score back. The
   * first cards to fill an empty card don't morph in, so they don't wait —
   * a scoreboard withholding its scores for the length of an entrance it
   * never played would just look broken. Decided where the swap is
   * decided, in the poll. */
  const [heroRollDelayMs, setHeroRollDelayMs] = useState(0);

  // User Geolocation & Upcoming Banner
  const [userLoc, setUserLoc] = useState<string>('Khao Lak, Phang Nga, Thailand');
  const [nearbyEvent, setNearbyEvent] = useState<Tournament | null>(() => TOURNAMENTS.find((t) => t.status === 'upcoming') || null);

  // Events list — real tournaments from the database (announced and later;
  // drafts stay hidden from the public page).
  const [events, setEvents] = useState<Tournament[]>([]);
  const [completedSlides, setCompletedSlides] = useState<CompletedDivisionSlide[]>([]);
  const [realStats, setRealStats] = useState<HomepageStats>({ divisions: 0, registeredTeams: 0 });
  const [eventsLoaded, setEventsLoaded] = useState(false);

  useRestoreScrollPosition(eventsLoaded);

  useEffect(() => {
    const handleSave = () => {
      if (typeof window !== 'undefined' && window.scrollY > 0) {
        saveScrollPosition('/');
      }
    };
    window.addEventListener('scroll', handleSave, { passive: true });
    window.addEventListener('pagehide', handleSave);
    return () => {
      window.removeEventListener('scroll', handleSave);
      window.removeEventListener('pagehide', handleSave);
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    if (mobileSwipeRef.current) {
      mobileSwipeRef.current.scrollTo({ left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [query, statusFilter, sortBy]);

  const divisionsCount = useMemo(() => {
    const fromEvents = events.reduce((sum, t) => sum + (t.divisions?.length || 0), 0);
    return realStats.divisions > 0 ? realStats.divisions : fromEvents;
  }, [realStats, events]);

  const registeredTeamsCount = useMemo(() => {
    const fromEvents = events.reduce((sum, t) => sum + (t.teams || 0), 0);
    return realStats.registeredTeams > 0 ? realStats.registeredTeams : fromEvents;
  }, [realStats, events]);

  const activeLiveCount = useMemo(() => {
    return events.filter(e => e.status === 'live').length;
  }, [events]);

  const userCountry = useMemo(() => {
    return userLoc.split(',').pop()?.trim() || 'Thailand';
  }, [userLoc]);

  const matchesNearYouCount = useMemo(() => {
    const country = userCountry.toLowerCase();
    if (!country) return 0;
    return events.filter(t =>
      t.location.toLowerCase().includes(country) ||
      t.title.toLowerCase().includes(country)
    ).length;
  }, [events, userCountry]);

  useEffect(() => {
    Promise.all([
      getPublicTournaments(),
      getRecentlyCompletedDivisions(14),
      getHomepageStats(),
    ])
      .then(([rows, slides, statsData]) => {
        /* Each card is labelled with the organizer who owns that event.
         * This used to call /api/organizer once and stamp the same name on
         * everything — harmless when the database held one organizer, wrong
         * the moment a second signs up. */
        const cards = rows
          .filter(t => t.phase >= 2)
          .map((t, i) => toEventCard(t, i, t.organizerName));
        setEvents(cards);
        setCompletedSlides(slides);
        if (statsData) {
          const totalTeamsFromRows = rows.reduce((sum, t) => sum + t.divisions.reduce((dSum, d) => d.filled, 0), 0);
          const totalDivsFromRows = rows.reduce((sum, t) => sum + t.divisions.length, 0);
          setRealStats({
            divisions: statsData.divisions > 0 ? statsData.divisions : totalDivsFromRows,
            registeredTeams: statsData.registeredTeams > 0 ? statsData.registeredTeams : totalTeamsFromRows,
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
              const addr = data.address || {};
              let city = addr.city || addr.town || addr.municipality || addr.village || addr.suburb || addr.county || 'Khao Lak';
              if (/khuekkhak|takua pa|khao lak/i.test(city) || /phang nga/i.test(addr.state || '') || /phang nga/i.test(addr.county || '')) {
                city = 'Khao Lak';
              }
              const state = addr.state || addr.province || 'Phang Nga';
              const country = addr.country || 'Thailand';
              setUserLoc([city, state, country].filter(Boolean).join(', '));
            } else {
              setUserLoc('Khao Lak, Phang Nga, Thailand');
            }
          } catch {
            setUserLoc('Khao Lak, Phang Nga, Thailand');
          }
        },
        () => {
          setUserLoc('Khao Lak, Phang Nga, Thailand');
        }
      );
    }
  }, []);

  /* Poll the courts, and let each answer decide what the card shows next.
   *
   * Ten seconds is deliberately slower than the scoring: the card is a
   * glance from the top of the homepage, not a scoreboard being refereed,
   * and it shouldn't hold a live connection open for a match nobody on
   * this page is watching. It does mean the card follows the action up to
   * ten seconds behind, which at a glance is indistinguishable from live.
   *
   * There is no timer moving the card along any more. It changes when the
   * courts change and sits still otherwise. */
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchHeroLiveMatches().then((matches) => {
        if (cancelled) return;
        const wasShowing = heroSlotsRef.current.ids.some(Boolean);
        const slots = nextSlots(heroSlotsRef.current, matches, Date.now());
        heroSlotsRef.current = slots;
        setHeroMatches(matches);
        setHeroSlots(slots);
        setHeroRollDelayMs(wasShowing ? SCORE_ROLL_DELAY_MS : 0);
        setHeroLoaded(true);
      });
    };
    /* The first read always runs, hidden tab or not: it fills an empty
     * card, which animates nothing, and a tab opened in the background
     * should be ready the moment it is looked at. */
    load();
    /* The repeats are what need gating. A backgrounded tab gets no
     * animation frames, so a card swapped there would never finish
     * leaving — poll after poll would stack another frozen card on its way
     * out. Skipping those also spares the database requests nobody is
     * reading. The listener below catches the tab up on return. */
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 10_000);
    const onVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /* The card's mode. The scoreboard used to appear whenever a tournament's
   * dates covered today, which is not the same question — an event can be
   * running with every court empty. It now follows the feed: a court in
   * play (or the next one due) gets the scoreboard, and only when nothing
   * at all is on does the card fall back to the soonest-starting
   * tournaments. Until the feed resolves it shows neither, rather than
   * flashing one and swapping to the other. */
  const heroSlotMatches = useMemo(() => {
    const byId = new Map(heroMatches.map((m) => [m.matchId, m]));
    // Slot positions are preserved — each one owns its own transition, so
    // a court arriving in the top slot must not be mistaken for the bottom
    // slot's court having changed.
    return heroSlots.ids.map((id) => (id ? byId.get(id) ?? null : null));
  }, [heroMatches, heroSlots]);

  const heroPage = useMemo(
    () => heroSlotMatches.filter((m): m is HeroLiveMatch => m !== null),
    [heroSlotMatches]
  );

  const scrollToTop = (e: React.MouseEvent) => {
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.history.pushState({}, '', '/');
    }
  };

  const scrollToTournamentSearch = () => {
    if (menuOpen) setMenuOpen(false);
    const input = tournamentSearchInputRef.current;
    if (input) {
      // Synchronously focus within user-activation event so mobile OS immediately opens the keypad
      input.focus();
      if (input.value) {
        const len = input.value.length;
        input.setSelectionRange?.(len, len);
      }

      const navHeight = navRef.current?.offsetHeight || 80;
      const elementPosition = input.getBoundingClientRect().top + window.scrollY;
      const offsetPosition = Math.max(0, elementPosition - navHeight - 24);
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    } else {
      document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Monitor scroll position to apply solid background transition when scrolled
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-hide mobile menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Find the active marquee tournament for the Hero right column.
  const marqueeTournament = useMemo(() => {
    return TOURNAMENTS.find((t) => t.status === 'live') || TOURNAMENTS[0];
  }, []);

  const upcomingSoon = useMemo(() => {
    return events
      .filter((t) => t.status === 'upcoming')
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
      .slice(0, 3);
  }, [events]);

  // Filter and sort tournaments based on Search input, Status filter, and Sort order.
  const filteredActiveUpcoming = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = events.filter((t) => {
      if (statusFilter === 'live' && t.status !== 'live') return false;
      if (statusFilter === 'upcoming' && t.status !== 'upcoming') return false;
      if (statusFilter === 'finished' && t.status !== 'finished') return false;
      if (statusFilter === 'all' && t.status === 'finished') return false;
      if (q && !(`${t.title} ${t.location}`.toLowerCase().includes(q))) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      const dateA = a.startDate || '';
      const dateB = b.startDate || '';
      if (sortBy === 'latest') {
        return dateB.localeCompare(dateA) || a.title.localeCompare(b.title);
      } else {
        return dateA.localeCompare(dateB) || a.title.localeCompare(b.title);
      }
    });
  }, [events, statusFilter, sortBy, query]);

  const DESKTOP_PAGE_SIZE = 6;
  const MOBILE_PAGE_SIZE = 3;

  const desktopTotalPages = Math.max(1, Math.ceil(filteredActiveUpcoming.length / DESKTOP_PAGE_SIZE));
  const mobileTotalPages = Math.max(1, Math.ceil(filteredActiveUpcoming.length / MOBILE_PAGE_SIZE));
  const totalPages = isMobile ? mobileTotalPages : desktopTotalPages;

  const desktopPageTournaments = useMemo(() => {
    const start = (currentPage - 1) * DESKTOP_PAGE_SIZE;
    return filteredActiveUpcoming.slice(start, start + DESKTOP_PAGE_SIZE);
  }, [filteredActiveUpcoming, currentPage]);

  const mobilePages = useMemo(() => {
    const pages: Tournament[][] = [];
    for (let i = 0; i < filteredActiveUpcoming.length; i += MOBILE_PAGE_SIZE) {
      pages.push(filteredActiveUpcoming.slice(i, i + MOBILE_PAGE_SIZE));
    }
    return pages;
  }, [filteredActiveUpcoming]);

  const handleMobileScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    const page = index + 1;
    if (page >= 1 && page <= mobileTotalPages && page !== currentPage) {
      setCurrentPage(page);
    }
  };

  const goToPage = (page: number, shouldScrollToSection = false) => {
    const maxPages = isMobile ? mobileTotalPages : desktopTotalPages;
    const target = Math.max(1, Math.min(page, maxPages));
    setCurrentPage(target);

    if (isMobile && mobileSwipeRef.current) {
      const width = mobileSwipeRef.current.clientWidth;
      mobileSwipeRef.current.scrollTo({
        left: (target - 1) * width,
        behavior: 'smooth',
      });
    }

    if (shouldScrollToSection && eventsSectionRef.current) {
      const rect = eventsSectionRef.current.getBoundingClientRect();
      if (rect.top < 0) {
        eventsSectionRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const filteredCompletedSlides = useMemo(() => {
    if (statusFilter === 'live' || statusFilter === 'upcoming') return [];
    const q = query.trim().toLowerCase();
    if (!q) return completedSlides;
    return completedSlides.filter(
      (s) =>
        s.tournamentTitle.toLowerCase().includes(q) ||
        s.location.toLowerCase().includes(q) ||
        s.divisionName.toLowerCase().includes(q) ||
        s.winners.some((w) => w.toLowerCase().includes(q))
    );
  }, [completedSlides, statusFilter, query]);

  const uniqueCompletedTournamentCount = useMemo(() => {
    const ids = new Set(filteredCompletedSlides.map((s) => s.tournamentId));
    return ids.size;
  }, [filteredCompletedSlides]);

  const totalEventCount = useMemo(() => {
    if (statusFilter === 'finished') {
      return filteredActiveUpcoming.length > 0 ? filteredActiveUpcoming.length : uniqueCompletedTournamentCount;
    }
    return filteredActiveUpcoming.length + (statusFilter === 'all' ? uniqueCompletedTournamentCount : 0);
  }, [statusFilter, filteredActiveUpcoming.length, uniqueCompletedTournamentCount]);

  const hasAnyResults = filteredActiveUpcoming.length > 0 || (statusFilter !== 'live' && statusFilter !== 'upcoming' && filteredCompletedSlides.length > 0);

  return (
    <div className={styles.page} id="top">
      
      {/* ── Morphing Navigation Bar (Desktop Search & Action Buttons) ───────── */}
      <header 
        id="livebracket-nav"
        ref={navRef}
        className={`${styles.nav} ${scrolled ? styles.scrolled : styles.onHero}`}
      >
        <div className={styles.navRow}>
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
              <Search
                size={16}
                className={styles.navSearchIcon}
                onClick={scrollToTournamentSearch}
                role="button"
                tabIndex={0}
                aria-label="Search tournaments"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    scrollToTournamentSearch();
                  }
                }}
              />
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
            {!signedIn && (
              <>
                <Link
                  href={signInHref}
                  onClick={() => saveScrollPosition()}
                  className={styles.navSignInLink}
                >
                  Sign In
                </Link>
                <Link
                  href={createHref}
                  onClick={() => saveScrollPosition()}
                  className={styles.navCreateBtn}
                >
                  Create a tournament
                </Link>
              </>
            )}

            {/* Mobile Search Button */}
            <button 
              className={styles.mobileSearchToggle}
              onClick={scrollToTournamentSearch}
              aria-label="Search tournaments"
            >
              <Search size={18} />
            </button>

            {/* Signed-in Profile Button */}
            {signedIn && (
              <AccountButton onNavigate={() => saveScrollPosition()} />
            )}

            {/* Signed-out Mobile Hamburger Menu Button (Rightmost) */}
            {!signedIn && (
              <button
                className={styles.mobileMenuToggle}
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Toggle navigation menu"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Menu Dropdown (Signed-out visitor menu) */}
        {!signedIn && menuOpen && (
          <div className={styles.mobileMenuDropdown}>
            <Link
              href={signInHref}
              className={styles.mobileNavSignInLink}
              onClick={() => {
                saveScrollPosition();
                setMenuOpen(false);
              }}
            >
              Sign In
            </Link>
            <Link
              href={createHref}
              className={styles.mobileNavCreateBtn}
              onClick={() => {
                saveScrollPosition();
                setMenuOpen(false);
              }}
            >
              Create a tournament
            </Link>
            <Link
              href={organizerHref}
              className={styles.mobileNavOrganizerLink}
              onClick={() => {
                saveScrollPosition();
                setMenuOpen(false);
              }}
            >
              Organizer login
            </Link>
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
                    setStatusFilter('live');
                    document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Watch Live
                </button>
              </div>

              {/* Bottom Live Matches Indicator & Season Stats */}
              <div className={styles.heroStatsSection}>
                <button
                  type="button"
                  className={styles.heroNearYouBtn}
                  onClick={() => {
                    setQuery(userCountry);
                    setStatusFilter('all');
                    document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <div className={styles.nearYouContent}>
                    <div className={styles.nearYouTitleRow}>
                      <span className={styles.liveDotRed} />
                      <span className={styles.nearYouBold}>
                        {matchesNearYouCount} {matchesNearYouCount === 1 ? 'match' : 'matches'} near you
                      </span>
                    </div>
                    <div className={styles.nearYouLocationRow}>
                      <span className={styles.nearYouSub}>{userLoc}</span>
                      <ArrowRight size={13} className={styles.nearYouArrow} />
                    </div>
                  </div>
                </button>

                <div className={styles.heroStatsRow}>
                  <div className={styles.heroStatItem}>
                    <span className={styles.heroStatNumber}>{divisionsCount}</span>
                    <span className={styles.heroStatLabel}>{divisionsCount === 1 ? 'Division is coming' : 'Divisions are coming'}</span>
                  </div>
                  <div className={styles.heroStatDivider} />
                  <div className={styles.heroStatItem}>
                    <span className={styles.heroStatNumber}>{registeredTeamsCount}</span>
                    <span className={styles.heroStatLabel}>{registeredTeamsCount === 1 ? 'Team is playing' : 'Teams are playing'}</span>
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

                {heroPage.length > 0 ? (
                  <>
                {/* Top of the photo: live first, dates opposite. */}
                <div className={styles.showcaseTopRow}>
                  {heroPage.some((m) => m.status === 'live') && (
                    <span className={styles.showcaseLiveBadge}>
                      <span className={styles.liveDotWhite} />
                      LIVE
                    </span>
                  )}
                  <span className={styles.showcaseDateChip}>{heroPage[0].dateLabel}</span>
                </div>

                {/* Bottom of the photo: which event, and where. */}
                <div className={styles.showcaseTournamentInfo}>
                  <h3 className={styles.showcaseTournamentTitle}>{heroPage[0].tournamentTitle}</h3>
                  <p className={styles.showcaseTournamentSub}>{heroPage[0].location}</p>
                </div>

                {/* One scoreboard per court, each swapping on its own.
                    popLayout takes the outgoing card out of the flow the
                    instant it starts leaving, so the card underneath
                    doesn't wait for the slide to finish before settling —
                    and the incoming card holds the slot's height from the
                    first frame, while it is still a miniature. */}
                <div className={styles.scoreboardStack}>
                  {heroSlotMatches.map((m, slot) => (
                    /* The slot's AnimatePresence is mounted whether or not
                       it holds a court — it renders nothing when empty, so
                       it costs no element and no gap, and a court arriving
                       later still counts as a change and gets the morph
                       rather than popping in. */
                    <AnimatePresence key={slot} mode="popLayout" initial={false}>
                      {m && (
                        <motion.div
                          key={m.matchId}
                          /* The anchor the miniature grows out of. Pinning
                             the top-right corner is what makes it read as
                             a card extending down and to the left, rather
                             than one swelling from its middle. */
                          style={{ transformOrigin: '100% 0%' }}
                          /* Out to the left, quickly — this is the card
                             being replaced, not something to dwell on. Its
                             own transition, so the entrance's delays below
                             don't hold the exit up. */
                          exit={{
                            x: '-115%',
                            opacity: 0,
                            transition: { duration: CARD_EXIT_S, ease: [0.4, 0, 1, 1] },
                          }}
                          /* In as a miniature of the card at the top right
                             of the slot, which then extends to full size.
                             It holds the slot's height throughout: a
                             transform costs the layout nothing, so nothing
                             below it moves. */
                          initial={{ scale: CARD_SEED_SCALE, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{
                            // Both wait for the outgoing card to clear.
                            scale: {
                              duration: CARD_MORPH_S,
                              delay: CARD_EXIT_S,
                              ease: [0.22, 1, 0.36, 1],
                            },
                            // Quick, so the miniature is a card arriving
                            // rather than a shape fading up.
                            opacity: { duration: 0.2, delay: CARD_EXIT_S },
                          }}
                        >
                          <HeroScoreboard
                            match={m}
                            rollDelayMs={heroRollDelayMs}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  ))}
                </div>
                  </>
                ) : !heroLoaded ? null : upcomingSoon.length > 0 ? (
                  /* Nothing is live, so the scoreboard has nothing to show.
                     The card carries the next tournaments instead, anchored
                     to the bottom so one or two sit where three would end
                     rather than floating in the middle of the photo. */
                  <>
                    <div className={styles.showcaseTopRow}>
                      <span className={styles.showcaseNextBadge}>Up next</span>
                    </div>

                    <div className={styles.upNextPanel}>
                      {upcomingSoon.map(t => (
                        <Link
                          key={t.id}
                          href={`/tournament/${t.id}`}
                          onClick={() => saveScrollPosition('/')}
                          className={styles.upNextItem}
                        >
                          <span className={styles.upNextChip}>
                            <span className={styles.upNextChipMonth}>{t.chip.m}</span>
                            <span className={styles.upNextChipDay}>{t.chip.d}</span>
                          </span>
                          <span className={styles.upNextText}>
                            <span className={styles.upNextName}>{t.title}</span>
                            <span className={styles.upNextMeta}>{t.location}</span>
                          </span>
                          <ArrowRight size={16} className={styles.upNextArrow} />
                        </Link>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Content Body (Sticky Background Blobs Design System) ───── */}
      <div className={styles.contentBody}>
        <div className={styles.contentBg} aria-hidden="true" />

        {/* ── Events browser (Warm Sand Background overlaying blobs) ─── */}
        <section className={styles.events} id="events" ref={eventsSectionRef}>
          <div className={styles.container}>
            
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Tournaments</h2>
              <p className={styles.resultCount}>
                {totalEventCount} {totalEventCount === 1 ? 'event' : 'events'}
              </p>
            </div>

            {/* Controls: search + status filter dropdown + reorder dropdown */}
            <div className={styles.controls}>
              <div className={styles.search}>
                <Search size={16} className={styles.searchIconLeft} />
                <input
                  ref={tournamentSearchInputRef}
                  type="search"
                  placeholder="Find a tournament..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search tournaments"
                />
                <Mic size={15} className={styles.searchMicIcon} />
              </div>
              <div className={`${styles.sortSelect} ${styles.statusSelect}`}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  aria-label="Filter by status"
                >
                  {STATUS_FILTERS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} className={styles.sortSelectIcon} aria-hidden="true" />
              </div>
              <div className={`${styles.sortSelect} ${styles.reorderSelect}`}>
                <ArrowUpDown size={15} className={styles.sortSignIcon} aria-hidden="true" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  aria-label="Reorder tournaments"
                >
                  {SORT_OPTIONS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown size={16} className={styles.sortSelectIcon} aria-hidden="true" />
              </div>
            </div>

            {/* If everything is filtered out */}
            {!hasAnyResults && (
              <div className={styles.empty}>
                <p>No tournaments match that search query or filter.</p>
                <button
                  className={styles.linkBtn}
                  onClick={() => { setQuery(''); setStatusFilter('all'); setSortBy('latest'); }}
                >
                  Clear filters
                </button>
              </div>
            )}

            {/* Active & Upcoming Tournament List */}
            {filteredActiveUpcoming.length > 0 && (
              <>
                {/* Desktop Grid (6 cards per page) */}
                <div className={styles.desktopGrid}>
                  {desktopPageTournaments.map((t) => (
                    <TournamentCard
                      key={t.id}
                      t={t}
                      styles={styles}
                      saveScrollPosition={saveScrollPosition}
                    />
                  ))}
                </div>

                {/* Mobile Horizontal Swipe Track (3 cards per slide) */}
                <div
                  ref={mobileSwipeRef}
                  className={styles.mobileSwipeTrack}
                  onScroll={handleMobileScroll}
                >
                  {mobilePages.map((pageCards, pageIdx) => (
                    <div key={pageIdx} className={styles.mobilePageSlide}>
                      {pageCards.map((t) => (
                        <TournamentCard
                          key={t.id}
                          t={t}
                          styles={styles}
                          saveScrollPosition={saveScrollPosition}
                        />
                      ))}
                    </div>
                  ))}
                </div>

                {/* Pagination: ‹ 1 • 2 • ... • 8 › */}
                <PaginationControl
                  currentPage={currentPage}
                  totalPages={totalPages}
                  goToPage={goToPage}
                  styles={styles}
                />
              </>
            )}

            {/* Recently Completed Tournament Section (Slideshow) */}
            {filteredCompletedSlides.length > 0 && (
              <CompletedSlideshow slides={filteredCompletedSlides.slice(0, 8)} styles={styles} />
            )}

          </div>
        </section>


      </div>
    </div>
  );
}
