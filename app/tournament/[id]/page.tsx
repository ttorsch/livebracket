'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { MapPin, Calendar, Users, Clock, Share2, Check } from 'lucide-react';
import styles from './page.module.css';

const cardVariants: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 50 : dir < 0 ? -50 : 0,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: {
      x: { type: 'spring' as const, stiffness: 350, damping: 30 },
      opacity: { duration: 0.2 },
    },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -50 : dir < 0 ? 50 : 0,
    opacity: 0,
    transition: {
      x: { type: 'spring' as const, stiffness: 350, damping: 30 },
      opacity: { duration: 0.15 },
    },
  }),
};
import { roundFormatLabel, isGroupFormat } from '@/lib/roundFormat';
import {
  getTournamentDetail, type TournamentDetail, type DetailMatch,
  type DetailDivision,
} from '../../../lib/data';
import { isThirdPlaceRound } from '../../../lib/divisionMatches';
import { fetchLiveScores, applyLiveScores, type LiveScoreMap } from '../../../lib/liveScores';
import { registrationState, nextOpening, isPublic, isTournamentLiveDate, type Phase } from '../../../lib/tournamentLifecycle';
import { ageLimitLabel } from '../../../lib/divisionEligibility';
import { useSignInHref, saveScrollPosition, useRestoreScrollPosition } from '../../../components/auth/useSignInHref';
import { useSession } from '../../../components/auth/AuthProvider';
import AccountButton from '../../../components/auth/AccountButton';
import CourtScheduleView from '../../../components/schedule/CourtScheduleView';

// Spectators are watching a match happen; the page has to keep up.
const LIVE_POLL_MS = 15000;

/* Dates are read in UTC everywhere in this app — a browser west of Greenwich
   would otherwise show a deadline a day early. */
function formatDay(d: Date): string {
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatCloseDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return formatDay(new Date(Date.UTC(y, m - 1, d)));
}

function getTitleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'T';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/* Labels and the group/knockout question both come from lib/roundFormat,
   which is keyed to the values rounds.format actually holds. The map that
   used to live here was keyed 'single-elim'/'double-elim' — values the
   schema does not allow — so every knockout round fell through to its raw
   column value and displayed as "single". */

/* ── Standings, tallied from the matches themselves ───────────────
 *
 * Nothing in the database stores a table: the rows below are counted off
 * the finished matches in the group rounds. Match points are 3 for a win,
 * which is the rule this app applies — the organizer's own scoring settings
 * cover sets and points within a match, not how a pool is ranked. */
const WIN_POINTS = 3;

interface StandingRow {
  teamId: string;
  team: string;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  points: number;
}

function buildStandings(division: DetailDivision): StandingRow[] {
  const table = new Map<string, StandingRow>();

  const row = (id: string, name: string) => {
    let r = table.get(id);
    if (!r) {
      r = { teamId: id, team: name, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, points: 0 };
      table.set(id, r);
    }
    return r;
  };

  for (const round of division.bracket) {
    if (!isGroupFormat(round.format)) continue;
    for (const m of round.matches) {
      // Only a finished match has told us anything.
      if (m.status !== 'done' || !m.teamAId || !m.teamBId || !m.winner) continue;

      const a = row(m.teamAId, m.teamAName ?? (m.teamA.length ? m.teamA.map(p => p.name).join(' / ') : 'TBD'));
      const b = row(m.teamBId, m.teamBName ?? (m.teamB.length ? m.teamB.map(p => p.name).join(' / ') : 'TBD'));

      const setsA = m.scoreA ?? [];
      const setsB = m.scoreB ?? [];
      for (let i = 0; i < Math.max(setsA.length, setsB.length); i++) {
        const sa = setsA[i] ?? 0;
        const sb = setsB[i] ?? 0;
        if (sa === sb) continue;
        if (sa > sb) { a.setsFor++; b.setsAgainst++; } else { b.setsFor++; a.setsAgainst++; }
      }

      const winner = m.winner === 'A' ? a : b;
      const loser = m.winner === 'A' ? b : a;
      winner.wins++;
      winner.points += WIN_POINTS;
      loser.losses++;
    }
  }

  return [...table.values()].sort(
    (x, y) =>
      y.points - x.points ||
      (y.setsFor - y.setsAgainst) - (x.setsFor - x.setsAgainst) ||
      x.team.localeCompare(y.team),
  );
}

/* ── One round, as the Format & Rules panel presents it ───────────── */
const CROSSING_LABEL: Record<string, string> = {
  fivb: 'FIVB standard crossing',
  static: 'Static cross-bracket',
};

interface RoundView {
  key: string;
  n: number;
  eyebrow: string;
  name: string;
  /* One tile per set that can be played: the regular sets, then the decider,
     which is scored differently and so gets its own tile. */
  sets: { label: string; points: string; note: string }[];
  facts: { label: string; value: string }[];
}

function buildRoundViews(division: DetailDivision, advanceCount: number): RoundView[] {
  const rounds = division.configuredRounds;
  /* Same rule as the advance count: the organizer's setup value is the
     definition, and a draw that has actually produced matches overrides it. */
  const drawn = division.bracket.some(r => r.matches.length > 0);
  const crossingKey = drawn && division.drawConfig ? division.drawConfig.crossing : division.crossing;
  const crossing = CROSSING_LABEL[crossingKey];

  return rounds.map((round, i) => {
    const s = round.scoring;
    const note = s.hardCap > 0 ? `hard cap ${s.hardCap}` : 'no hard cap';
    const isLast = i === rounds.length - 1;

    const sets: RoundView['sets'] = [];
    if (s.setsBestOf > 1) {
      for (let n = 1; n < s.setsBestOf; n++) {
        sets.push({ label: `Set ${n}`, points: String(s.pointsPerSet), note });
      }
      sets.push({ label: 'Deciding', points: String(s.decidingSetPoints), note });
    } else {
      sets.push({ label: 'Set 1', points: String(s.pointsPerSet), note });
    }

    const facts: RoundView['facts'] = [
      { label: 'Match', value: s.setsBestOf > 1 ? `Best of ${s.setsBestOf}` : '1 set' },
      { label: 'Hard cap', value: s.hardCap > 0 ? String(s.hardCap) : 'None' },
    ];

    // Advancing only applies to group / pool play stages
    if (isGroupFormat(round.format) && advanceCount > 0) {
      facts.push({ label: 'Advancing', value: `Top ${advanceCount} / pool` });
    }

    // Crossing describes how teams advance from round robin / pool play into the draw.
    if (isGroupFormat(round.format) && crossing) {
      facts.push({ label: 'Crossing', value: crossing });
    }

    return {
      key: `${i}-${round.format}`,
      n: i + 1,
      eyebrow: `Round ${i + 1}`,
      name: roundFormatLabel(round.format),
      sets,
      facts,
    };
  });
}

/* ── A court currently in play ───────────────────────────────────── */
interface LiveCourt {
  id: string;
  heading: string;      // "Court 1 · Open Men"
  setLabel: string;     // "Set 3"
  a: { name: string; history: string; score: number; leading: boolean };
  b: { name: string; history: string; score: number; leading: boolean };
  footnote: string;     // "Semifinal"
}

function toLiveCourt(divisionLabel: string, roundName: string, m: DetailMatch): LiveCourt {
  const setsA = m.scoreA ?? [];
  const setsB = m.scoreB ?? [];
  // applyLiveScores appends the set being played, so the last entry is the
  // score on court and everything before it is history.
  const currentA = setsA.length ? setsA[setsA.length - 1] : 0;
  const currentB = setsB.length ? setsB[setsB.length - 1] : 0;
  const doneA = setsA.slice(0, -1);
  const doneB = setsB.slice(0, -1);

  return {
    id: m.id,
    heading: [m.court, divisionLabel].filter(Boolean).join(' · '),
    setLabel: `Set ${Math.max(1, setsA.length)}`,
    a: {
      name: m.teamAName ?? m.teamA.map(p => p.name).join(' / '),
      history: doneA.length ? doneA.join(' · ') : '—',
      score: currentA,
      leading: currentA >= currentB,
    },
    b: {
      name: m.teamBName ?? m.teamB.map(p => p.name).join(' / '),
      history: doneB.length ? doneB.join(' · ') : '—',
      score: currentB,
      leading: currentB > currentA,
    },
    footnote: roundName,
  };
}

export default function TournamentPage() {
  const params = useParams();
  const slug = String(params.id);

  const [baseTournament, setBaseTournament] = useState<TournamentDetail | null>(null);
  const [liveScores, setLiveScores] = useState<LiveScoreMap>({});
  const [activeDiv, setActiveDiv] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('');

  const handleRestoreState = useCallback((state: { activeDiv?: string; activeTab?: string }) => {
    if (state.activeDiv) setActiveDiv(state.activeDiv);
    if (state.activeTab) setActiveTab(state.activeTab);
  }, []);

  useRestoreScrollPosition(Boolean(baseTournament), handleRestoreState);

  useEffect(() => {
    getTournamentDetail(slug).then((data) => {
      setBaseTournament(data);
      if (data && data.divisions.length > 0) {
        setActiveDiv((prev) => prev || data.divisions[0].id);
      }
    }).catch(console.error);
  }, [slug]);

  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tournaments/${slug}/player-avatars`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data?.avatars) {
          setPlayerAvatars(data.avatars);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchLiveScores(slug).then(scores => { if (!cancelled) setLiveScores(scores); });
    };
    load();
    const timer = setInterval(load, LIVE_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [slug]);

  const tournament = useMemo(
    () => (baseTournament ? applyLiveScores(baseTournament, liveScores) : null),
    [baseTournament, liveScores],
  );

  const activeDivision = tournament?.divisions.find(d => d.id === activeDiv) ?? null;

  const [slideDirection, setSlideDirection] = useState<number>(0);

  const handleSelectDivision = (newId: string) => {
    if (newId === activeDiv || !tournament) return;
    const currentIndex = tournament.divisions.findIndex(d => d.id === activeDiv);
    const newIndex = tournament.divisions.findIndex(d => d.id === newId);
    if (currentIndex !== -1 && newIndex !== -1) {
      setSlideDirection(newIndex > currentIndex ? 1 : -1);
    }
    setActiveDiv(newId);
  };

  const handleSelectTab = (t: string) => {
    if (t === currentTab) return;
    const currentIndex = tabs.indexOf(currentTab);
    const newIndex = tabs.indexOf(t);
    if (currentIndex !== -1 && newIndex !== -1) {
      setSlideDirection(newIndex > currentIndex ? 1 : -1);
    }
    setActiveTab(t);
  };

  /* Every court in play across the whole event, plus what is due on next —
     the panel is about the tournament, not the selected division. */
  const { liveCourts, nextUp } = useMemo(() => {
    const live: LiveCourt[] = [];
    const upcoming: { time: string; sortKey: string; where: string; match: string }[] = [];

    for (const d of tournament?.divisions ?? []) {
      for (const round of d.bracket) {
        for (const m of round.matches) {
          if (m.status === 'live') {
            live.push(toLiveCourt(d.label, round.round, m));
          } else if (m.status === 'upcoming' && m.teamAId && m.teamBId) {
            upcoming.push({
              time: m.time,
              sortKey: `${m.scheduledDate ?? '9999-99-99'} ${m.time || '99:99'}`,
              where: [m.court, d.label].filter(Boolean).join(' · '),
              match: `${m.teamAName ?? 'TBD'} vs ${m.teamBName ?? 'TBD'}`,
            });
          }
        }
      }
    }

    upcoming.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return { liveCourts: live, nextUp: upcoming.slice(0, 2) };
  }, [tournament]);

  const regState = tournament ? registrationState(tournament.divisions) : null;
  const opensAt = tournament ? nextOpening(tournament.divisions) : null;

  /* The soonest close date still ahead — what "open until" refers to when
     divisions close on different days. */
  const closesOn = useMemo(() => {
    const dates = (tournament?.divisions ?? [])
      .map(d => d.registrationCloses)
      .filter(Boolean)
      .sort();
    return dates[0] ?? '';
  }, [tournament]);

  const courtCount = useMemo(() => new Set(
    (tournament?.divisions ?? [])
      .flatMap(d => d.bracket.flatMap(r => r.matches.map(m => m.court)))
      .filter(Boolean),
  ).size, [tournament]);

  const standings = useMemo(
    () => (activeDivision ? buildStandings(activeDivision) : []),
    [activeDivision],
  );

  /* A configured elimination round exists in the rounds table before the draw
     has run, with no matches hanging off it — that is "not drawn yet", not a
     bracket, so it must not produce an empty column. */
  /* The organizer's setup value is the definition; a draw that has actually
     been run overrides it, because that is what the bracket was built from.
     "Run" is tested by the presence of matches, not by settings.draw existing
     — that key can be a stub with no advance recorded, whose defaulted 2
     would otherwise mask a real setup value. */
  const advanceCount = useMemo(() => {
    if (!activeDivision) return 2;
    const drawn = activeDivision.bracket.some(r => r.matches.length > 0);
    const draw = activeDivision.drawConfig;
    return drawn && draw && draw.advance > 0 ? draw.advance : activeDivision.advancePerPool;
  }, [activeDivision]);

  const roundViews = useMemo(
    () => (activeDivision ? buildRoundViews(activeDivision, advanceCount) : []),
    [activeDivision, advanceCount],
  );

  const knockoutRounds = useMemo(
    () => (activeDivision?.bracket ?? [])
      .filter(r => !isGroupFormat(r.format) && !(activeDivision && isThirdPlaceRound(activeDivision, r)) && r.matches.length > 0),
    [activeDivision],
  );

  const thirdPlaceRound = useMemo(
    () => (activeDivision ? (activeDivision.bracket ?? []).find(r => isThirdPlaceRound(activeDivision, r) && r.matches.length > 0) : undefined),
    [activeDivision],
  );

  const isLive = useMemo(
    () => isTournamentLiveDate(tournament?.startDate, tournament?.endDate),
    [tournament?.startDate, tournament?.endDate],
  );

  const hasSchedule = useMemo(() => {
    return (tournament?.divisions ?? []).some(d =>
      d.bracket.some(r => r.matches.some(m => Boolean(m.court || m.time))),
    );
  }, [tournament]);

  /* Tabs follow the design's order. When the tournament is live, the Schedule
     tab appears first across all screen sizes. Otherwise it sits after Bracket.
     A pool table only earns a tab when the division actually has a group round,
     and vouchers only when the organizer created some. */
  const tabs = useMemo(() => {
    const t: string[] = [];
    if (isLive && hasSchedule) {
      t.push('Schedule');
    }
    t.push('Format & Rules', 'Prize', 'Teams');
    if (standings.length > 0) t.push('Standings');
    if (knockoutRounds.length > 0) t.push('Bracket');
    if (!isLive && hasSchedule) t.push('Schedule');
    if ((tournament?.vouchers.length ?? 0) > 0) t.push('Vouchers');
    return t;
  }, [isLive, hasSchedule, standings, knockoutRounds, tournament]);

  // A division change can retire the tab that was open.
  const defaultTab = isLive && hasSchedule ? 'Schedule' : 'Format & Rules';
  const currentTab = tabs.includes(activeTab) ? activeTab : (tabs.includes(defaultTab) ? defaultTab : tabs[0]);

  useEffect(() => {
    const handleSave = () => {
      if (typeof window !== 'undefined' && window.scrollY > 0) {
        saveScrollPosition(undefined, { activeDiv, activeTab: currentTab });
      }
    };
    window.addEventListener('scroll', handleSave, { passive: true });
    window.addEventListener('pagehide', handleSave);
    return () => {
      window.removeEventListener('scroll', handleSave);
      window.removeEventListener('pagehide', handleSave);
    };
  }, [activeDiv, currentTab]);

  if (!tournament) {
    return (
      <div className={styles.page}>
        <SiteHeader />
        <div className={styles.stateWrap}>Loading tournament…</div>
      </div>
    );
  }

  /* Draft means nobody but the organizer sees it, and archived means it has
     been taken off the board. Cancelled is deliberately not here: a cancelled
     event stays up so the teams who registered find out. */
  if (!isPublic(tournament.phase as Phase) || tournament.archived) {
    return (
      <div className={styles.page}>
        <SiteHeader />
        <div className={styles.stateWrap}>
          <h1 className={styles.stateTitle}>This tournament isn&apos;t published</h1>
          <p className={styles.stateBody}>The organizer hasn&apos;t made it public yet. Check back soon.</p>
        </div>
      </div>
    );
  }

  const canRegister = regState === 'open';

  return (
    <div className={styles.page}>
      <SiteHeader onSignInClick={() => saveScrollPosition(undefined, { activeDiv, activeTab: currentTab })} />

      {/* ── Event head ────────────────────────────────────────── */}
      <section className={styles.headSection}>
        <Link href="/" className={styles.backLink}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All events
        </Link>

        <div className={styles.heroCard}>
          <div className={styles.heroPosterWrap}>
            {tournament.imageUrl ? (
              <img
                src={tournament.imageUrl}
                alt={tournament.title}
                className={styles.heroPoster}
              />
            ) : (
              <div className={styles.heroPosterFallback} aria-hidden="true">
                <span className={styles.heroPosterInitials}>{getTitleInitials(tournament.title)}</span>
              </div>
            )}
          </div>

          <div className={styles.headMain}>
            <div className={styles.pillRow}>
              {tournament.cancelled ? (
                <span className={styles.pillCancelled}>Cancelled</span>
              ) : (
                <>
                  {regState === 'open' && (
                    <span className={styles.pillPrimary}>
                      <span className={styles.pillDot} />
                      Registration Open
                    </span>
                  )}
                  {regState === 'opens-soon' && (
                    <span className={styles.pillOutline}>
                      <Calendar size={12} />
                      {opensAt ? `Opens ${formatDay(opensAt)}` : 'Opens soon'}
                    </span>
                  )}
                  {regState === 'closed' && <span className={styles.pillMuted}>Registration Closed</span>}
                  {regState === null && <span className={styles.pillMuted}>Save the date</span>}
                </>
              )}
            </div>

            <h1 className={styles.title}>{tournament.title}</h1>

            <div className={styles.metaRow}>
              <div className={styles.metaLine}>
                <span className={styles.metaItem}>
                  <Calendar size={15} />
                  {tournament.date}
                </span>
                <span className={styles.metaItem}>
                  <MapPin size={15} />
                  {tournament.location}
                </span>
              </div>
              <div className={styles.metaLine}>
                <span className={styles.metaItem}>
                  <Users size={15} />
                  {courtCount > 0 ? `${courtCount} courts · ` : ''}
                  {tournament.divisions.length} division{tournament.divisions.length === 1 ? '' : 's'}
                </span>
                {regState === 'open' && closesOn && (
                  <span className={styles.metaItem}>
                    <Clock size={15} />
                    Registration closes {formatCloseDate(closesOn)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.headActions}>
            {canRegister ? (
              <Link href={`/tournament/${slug}/register`} className={styles.btnPrimary}>Register team</Link>
            ) : (
              <button className={styles.btnPrimary} disabled>
                {regState === 'opens-soon' && opensAt ? `Opens ${formatDay(opensAt)}` : 'Registration closed'}
              </button>
            )}
            <ShareButton />
          </div>
        </div>
      </section>

      {/* ── Live now ──────────────────────────────────────────── */}
      {liveCourts.length > 0 && (
        <section className={styles.liveSection}>
          <div className={styles.livePanel}>
            <div className={styles.livePanelHead}>
              <span className={styles.liveNowLabel}>
                <span className={styles.livePulse} />
                Live Now
              </span>
              <span className={styles.liveUpdated}>Updates every 15s</span>
            </div>

            <div className={styles.liveGrid}>
              {liveCourts.map(c => (
                <div key={c.id} className={styles.liveCard}>
                  <div className={styles.liveCardHead}>
                    <span className={styles.liveCourtName}>{c.heading}</span>
                    <span className={styles.liveSet}>{c.setLabel}</span>
                  </div>

                  {[c.a, c.b].map((side, i) => (
                    <div key={i}>
                      {i === 1 && <div className={styles.liveDivider} />}
                      <div className={styles.liveTeamRow}>
                        <span className={side.leading ? styles.liveTeamLead : styles.liveTeam}>{side.name}</span>
                        <span className={styles.liveScoreGroup}>
                          <span className={styles.liveHistory}>{side.history}</span>
                          <span className={side.leading ? styles.liveScoreLead : styles.liveScore}>{side.score}</span>
                        </span>
                      </div>
                    </div>
                  ))}

                  {c.footnote && <div className={styles.liveFootnote}>{c.footnote}</div>}
                </div>
              ))}

              {nextUp.length > 0 && (
                <div className={styles.nextCard}>
                  <span className={styles.nextLabel}>Next up</span>
                  {nextUp.map((n, i) => (
                    <div key={i} className={i === 0 ? styles.nextItem : styles.nextItemDivided}>
                      <div className={styles.nextTimeRow}>
                        <span className={styles.nextTime}>{n.time || '—'}</span>
                        <span className={styles.nextWhere}>{n.where}</span>
                      </div>
                      <div className={styles.nextMatch}>{n.match}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Division picker + tabs ───────────────────────────────
           On mobile these two ride together in one sticky rail under the
           header; on desktop the wrapper is display:contents so the tab bar
           keeps its own sticky behaviour. */}
      <div className={styles.controlRail}>
      {tournament.divisions.length > 0 && (
        <section className={styles.divisionSection}>
          <div className={styles.segmented}>
            {tournament.divisions.map(d => {
              const isActive = activeDiv === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`${styles.segment} ${isActive ? styles.segmentActive : ''}`}
                  onClick={() => handleSelectDivision(d.id)}
                  aria-pressed={isActive}
                >
                  {isActive && (
                    <motion.span
                      layoutId="tournament-division-pill"
                      className={styles.activePill}
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className={styles.segmentLabel}>{d.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className={styles.tabBar}>
        <div className={styles.tabBarInner}>
          {tabs.map(t => {
            const isActive = currentTab === t;
            return (
              <button
                key={t}
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                onClick={() => handleSelectTab(t)}
              >
                {isActive && (
                  <motion.span
                    layoutId="tournament-tab-underline"
                    className={styles.tabUnderlineIndicator}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span>{t}</span>
              </button>
            );
          })}
        </div>
      </div>
      </div>

      <main className={styles.main}>
        <div className={styles.sliderOverflowWrap}>
          <AnimatePresence mode="wait" initial={false} custom={slideDirection}>
            <motion.div
              key={`${activeDiv}-${currentTab}`}
              custom={slideDirection}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className={styles.animatedContentWrap}
            >

        {/* ── Format & rules ──────────────────────────────────── */}
        {currentTab === 'Format & Rules' && activeDivision && (
          <div className={styles.formatWrap}>

            {/* ── What the division is ─────────────────────────── */}
            <div className={styles.divisionCard}>
              <div className={styles.divisionCardMain}>
                <div className={styles.divisionCardHead}>
                  <p className={styles.microLabel}>Division</p>
                  <h2 className={styles.divisionName}>{activeDivision.label}</h2>
                  {activeDivision.formatTypeOnSand && (
                    <span className={styles.badgeStatus}>
                      {activeDivision.formatTypeOnSand}
                    </span>
                  )}
                </div>

                <div className={styles.divisionStats}>
                  {[
                    { label: 'Team cap', value: `${activeDivision.teams} teams` },
                    { label: 'Roster', value: `${activeDivision.rosterSize} players` },
                    { label: 'Gender', value: activeDivision.gender },
                    { label: 'Age limit', value: ageLimitLabel(activeDivision.ageLimit) },
                    ...(activeDivision.netHeight ? [{ label: 'Net height', value: activeDivision.netHeight }] : []),
                  ].map(st => (
                    <div key={st.label} className={styles.stat}>
                      <p className={styles.microLabel}>{st.label}</p>
                      <p className={styles.statValue}>{st.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Entry fee owns the full-height rail on the right of the card. */}
              <div className={styles.feeRail}>
                <p className={styles.microLabel}>Entry fee</p>
                <p className={styles.feeValue}>
                  {activeDivision.registrationFee > 0
                    ? `${activeDivision.registrationFee.toLocaleString()} THB`
                    : 'Free'}
                </p>
              </div>
            </div>

            {/* ── How the draw runs ────────────────────────────── */}
            {roundViews.length > 0 ? (
              <section className={styles.drawSection}>
                <div className={styles.drawHead}>
                  <h2 className={styles.drawTitle}>How the draw runs</h2>
                </div>

                <div className={styles.roundGrid}>
                  {roundViews.map(r => (
                    <article key={r.key} className={styles.roundCard}>
                      <div className={styles.roundBody}>
                        <div className={styles.roundHead}>
                          <span className={styles.roundNum}>{r.n}</span>
                          <div className={styles.roundHeadText}>
                            <p className={styles.microLabel}>{r.eyebrow}</p>
                            <h3 className={styles.roundName}>{r.name}</h3>
                          </div>
                        </div>

                        <div className={styles.setGrid}>
                          {r.sets.map(t => (
                            <div key={t.label} className={styles.setTile}>
                              <p className={styles.microLabel}>{t.label}</p>
                              <p className={styles.setPoints}>{t.points}</p>
                              <p className={styles.setNote}>{t.note}</p>
                            </div>
                          ))}
                        </div>

                        <div className={styles.factRow}>
                          {r.facts.map(f => (
                            <span key={f.label} className={styles.factPill}>
                              <span className={styles.factLabel}>{f.label}</span>
                              <span className={styles.factValue}>{f.value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <EmptyCard
                title="Format not set yet"
                body="The organizer hasn't configured this division's rounds."
              />
            )}

            {/* ── Note section ──────────────────────────────────── */}
            {activeDivision.rules.trim() && (
              <section className={styles.noteCard}>
                <p className={styles.microLabel}>Note</p>
                <p className={styles.noteText}>{activeDivision.rules.trim()}</p>
              </section>
            )}

            {tournament.description && (
              <section className={styles.aboutCard}>
                <p className={styles.microLabel}>About</p>
                <h2 className={styles.drawTitle}>This tournament</h2>
                <p className={styles.aboutText}>{tournament.description}</p>
              </section>
            )}
          </div>
        )}

        {/* ── Prize ───────────────────────────────────────────── */}
        {currentTab === 'Prize' && activeDivision && (
          <div className={styles.prizeWrap}>
            <div className={styles.prizeCard}>
              <div className={styles.prizeCardHead}>
                <div>
                  <p className={styles.microLabel}>Awards & Payout</p>
                  <h2 className={styles.drawTitle}>{activeDivision.label} Prizes</h2>
                </div>
                {activeDivision.registrationFee > 0 && (
                  <div className={styles.prizeFeeBadge}>
                    <span className={styles.microLabel}>Entry Fee</span>
                    <span className={styles.prizeFeeValue}>{activeDivision.registrationFee.toLocaleString()} THB</span>
                  </div>
                )}
              </div>

              {activeDivision.prizePool && activeDivision.prizePool.trim() ? (
                <div className={styles.prizeBody}>
                  <div className={styles.prizeText}>
                    {activeDivision.prizePool.trim()}
                  </div>
                </div>
              ) : (
                <EmptyCard
                  title="Prizes to be announced"
                  body="The organizer hasn't published the prize breakdown for this division yet. Check back closer to tournament start."
                />
              )}
            </div>
          </div>
        )}

        {/* ── Teams ───────────────────────────────────────────── */}
        {currentTab === 'Teams' && activeDivision && (
          <div className={styles.teamsWrap}>
            <FillCard division={activeDivision} />
            <div className={styles.teamsGrid}>
              {activeDivision.teamsList.map(team => {
                const parsedNames = parseTeamPlayers(team.name);
                const playerItems = team.players && team.players.length > 0
                  ? team.players
                  : parsedNames.map((n, idx) => ({
                      id: `${team.id}-${idx}`,
                      name: n,
                      userId: null,
                    }));

                return (
                  <div
                    key={team.id}
                    className={`${styles.teamCard} ${team.status === 'waitlist' ? styles.teamCardMuted : ''}`}
                  >
                    <div className={styles.teamCardHeader}>
                      <div className={styles.teamPlayersList}>
                        {playerItems.map((player, idx) => {
                          const avatarKey = player.userId || (idx === 0 && team.registeredBy ? team.registeredBy : undefined);
                          const avatarUrl = avatarKey ? playerAvatars[avatarKey] : undefined;
                          return (
                            <div key={player.id || idx} className={styles.teamPlayerRow}>
                              <PlayerAvatar name={player.name} avatarUrl={avatarUrl} />
                              <span className={styles.teamPlayerName}>{player.name}</span>
                            </div>
                          );
                        })}
                      </div>

                      {team.status === 'waitlist' && (
                        <span className={styles.teamTag}>
                          Waitlist
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {activeDivision.teamsList.length === 0 && (
                <EmptyCard title="No teams yet" body="Registered teams appear here as they sign up." />
              )}
            </div>
          </div>
        )}

        {/* ── Standings ───────────────────────────────────────── */}
        {currentTab === 'Standings' && (
            <div className={styles.tableCard}>
              <div className={styles.tableHead}>
                <span>#</span>
                <span>Players</span>
                <span className={styles.center}>W–L</span>
                <span className={styles.center}>Sets</span>
                <span className={styles.right}>Points</span>
              </div>
              {standings.map((r, i) => (
                <div key={r.teamId} className={styles.tableRow}>
                  <span className={styles.rank}>{i + 1}</span>
                  <span className={styles.tableTeam}>{r.team}</span>
                  <span className={`${styles.center} ${styles.num}`}>{r.wins}–{r.losses}</span>
                  <span className={`${styles.center} ${styles.numMuted}`}>{r.setsFor}–{r.setsAgainst}</span>
                  <span className={`${styles.right} ${styles.numBold}`}>{r.points}</span>
                </div>
              ))}
            </div>
        )}

        {/* ── Bracket ─────────────────────────────────────────── */}
        {currentTab === 'Bracket' && (
          knockoutRounds.length > 0 ? (
            <div className={styles.bracketScroll}>
              <div className={styles.bracketGrid}>
                {knockoutRounds.map((round, ri) => (
                  <div key={round.round} className={styles.bracketColumn}>
                    <div className={styles.bracketRoundLabel}>{round.round}</div>
                    <div className={styles.bracketMatches}>
                      {round.matches.map(m => <BracketCard key={m.id} match={m} />)}
                      {ri === knockoutRounds.length - 1 && thirdPlaceRound?.matches[0] && (
                        <div className={styles.thirdPlaceBlock}>
                          <div className={styles.thirdPlaceLabel}>3rd Place</div>
                          <BracketCard match={thirdPlaceRound.matches[0]} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyCard
              title="Bracket not drawn yet"
              body="This division is still in pool play. The draw appears here once pools finish."
            />
          )
        )}

        {/* ── Schedule ────────────────────────────────────────── */}
        {currentTab === 'Schedule' && tournament && (
          <CourtScheduleView
            tournament={tournament}
            activeDivisionId={activeDiv}
            onSelectDivision={handleSelectDivision}
          />
        )}

        {/* ── Vouchers ────────────────────────────────────────── */}
        {currentTab === 'Vouchers' && (
          <div className={styles.voucherGrid}>
            {tournament.vouchers.map(v => (
              <div key={v.id} className={styles.voucherCard}>
                <h3 className={styles.voucherTitle}>{v.title}</h3>
                <p className={styles.voucherDesc}>{v.description}</p>
                <span className={styles.voucherCode}>{v.code}</span>
              </div>
            ))}
          </div>
        )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────── */

function SiteHeader({ onSignInClick }: { onSignInClick?: () => void }) {
  const signInHref = useSignInHref();
  const { signedIn } = useSession();
  return (
    <header className={styles.siteHeader}>
      <div className={styles.siteHeaderInner}>
        {/* Narrow screens fold the way back into the header row, so the
            back link, the wordmark and the account control share one
            line. The copy below the head section (.backLink) is the
            wide-screen one and is hidden there instead. */}
        <Link href="/" className={styles.headerBack}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7H2m0 0l4 4M2 7l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All events
        </Link>

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
          <span className={styles.brandWord}>LIVE BRACKET</span>
        </Link>

        <nav className={styles.headerNav}>
          {signedIn ? (
            <AccountButton
              onNavigate={() => {
                if (onSignInClick) {
                  onSignInClick();
                } else {
                  saveScrollPosition();
                }
              }}
            />
          ) : (
            <Link
              href={signInHref}
              onClick={() => {
                if (onSignInClick) {
                  onSignInClick();
                } else {
                  saveScrollPosition();
                }
              }}
              className={styles.btnGeneral}
            >
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/* Uses the platform share sheet where there is one, and falls back to the
   clipboard — with the label reporting which happened. */
function ShareButton() {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // Dismissed, or unavailable — fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button 
      className={`${styles.btnGeneral} ${styles.shareBtn}`} 
      onClick={share}
      aria-label={copied ? "Link copied" : "Share event"}
      title={copied ? "Link copied" : "Share event"}
    >
      {copied ? <Check size={17} className={styles.shareIcon} /> : <Share2 size={17} className={styles.shareIcon} />}
      <span className={styles.shareBtnText}>{copied ? 'Link copied' : 'Share event'}</span>
    </button>
  );
}

function FillCard({ division }: { division: DetailDivision }) {
  const cap = Math.max(1, division.teams);
  const pct = Math.min(100, Math.round((division.filled / cap) * 100));
  const waitlist = division.teamsList.filter(t => t.status === 'waitlist').length;

  return (
    <div className={styles.fillCard}>
      <div className={styles.fillTop}>
        <div>
          <p className={styles.fillEyebrow}>Spots filled</p>
          <p className={styles.fillCount}>{division.filled} / {division.teams} teams</p>
        </div>
        <div className={styles.fillStats}>
          <div>
            <p className={styles.fillStatLabel}>Spots left</p>
            <p className={styles.fillStatValue}>{Math.max(0, division.teams - division.filled)}</p>
          </div>
          <div>
            <p className={styles.fillStatLabel}>Waitlist</p>
            <p className={styles.fillStatValue}>{waitlist}</p>
          </div>
          <div>
            <p className={styles.fillStatLabel}>Full</p>
            <p className={styles.fillStatValue}>{pct}%</p>
          </div>
        </div>
      </div>
      <div className={styles.fillTrack}>
        <div
          className={pct >= 100 ? styles.fillBarFull : styles.fillBar}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BracketCard({ match }: { match: DetailMatch }) {
  const live = match.status === 'live';
  const scoreA = match.scoreA ?? [];
  const scoreB = match.scoreB ?? [];

  return (
    <div className={`${styles.matchCard} ${live ? styles.matchCardLive : ''}`}>
      <div className={styles.matchMeta}>
        <span>{[match.court, match.time].filter(Boolean).join(' · ') || 'Time TBD'}</span>
        {live && <span className={styles.matchLive}>Live</span>}
        {match.status === 'done' && <span className={styles.matchDone}>Final</span>}
      </div>

      {([['A', match.teamAName, scoreA], ['B', match.teamBName, scoreB]] as const).map(([side, name, sets], i) => (
        <div key={side}>
          {i === 1 && <div className={styles.matchDivider} />}
          <div className={styles.matchRow}>
            <span className={match.winner === side ? styles.matchTeamWin : styles.matchTeam}>
              {name ?? 'TBD'}
            </span>
            <span className={styles.matchSets}>{sets.length ? sets.join(' · ') : '—'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.emptyCard}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
    </div>
  );
}

function parseTeamPlayers(name: string): string[] {
  const parts = name.split('/').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [name];
}

function PlayerAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  const words = name.trim().split(/\s+/).filter(Boolean);
  const initial = words.length > 1
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (name.trim()[0]?.toUpperCase() || '?');

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={styles.playerAvatarImg}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={styles.playerAvatar} aria-hidden="true">
      <span>{initial}</span>
    </div>
  );
}
