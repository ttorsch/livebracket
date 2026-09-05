'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, Utensils, ChevronDown, Search, X } from 'lucide-react';
import styles from './CourtScheduleView.module.css';
import type { TournamentDetail, DetailDivision } from '../../lib/data';
import { labelDivisions } from '../../lib/schedule/schedulableDivisions';

interface ScheduleMatch {
  id: string;
  divisionLabel: string;
  divisionId: string;
  roundName: string;
  matchNo: string;
  court: string;
  time: string;
  teamA: string;
  teamB: string;
  scoreA?: number[];
  scoreB?: number[];
  winner?: 'A' | 'B' | null;
  status: 'upcoming' | 'live' | 'done';
  day: number;
  date: string;
  dateLabel: string;
  durationMinutes: number;
  /* Everything the search box looks through, lowercased once here rather
     than on every keystroke: both teams, the players inside them, the court
     and the round. */
  haystack: string;
}

interface BlockRow {
  kind: 'block';
  key: string;
  sort: number;
  court: string;
  day: number;
  label: string;
  from: string;
  to: string;
  minutes: number;
}

interface MatchRow {
  kind: 'match';
  key: string;
  sort: number;
  m: ScheduleMatch;
}

type CourtRow = MatchRow | BlockRow;

function getMatchWinner(m: {
  winner?: 'A' | 'B' | null;
  status: 'upcoming' | 'live' | 'done';
  scoreA?: number[];
  scoreB?: number[];
}): 'A' | 'B' | null {
  if (m.status !== 'done') return null;
  if (m.winner === 'A' || m.winner === 'B') return m.winner;
  if (!m.scoreA || !m.scoreB || m.scoreA.length === 0 || m.scoreB.length === 0) return null;

  let winsA = 0;
  let winsB = 0;
  const len = Math.min(m.scoreA.length, m.scoreB.length);
  for (let i = 0; i < len; i++) {
    if (m.scoreA[i] > m.scoreB[i]) winsA++;
    else if (m.scoreB[i] > m.scoreA[i]) winsB++;
  }
  if (winsA > winsB) return 'A';
  if (winsB > winsA) return 'B';
  return null;
}

function timeKey(day: number, t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return day * 1e7 + Number(m[1]) * 60 + Number(m[2]);
}

function dayIndexOf(startDate: string, dateStr: string): number {
  const toUTC = (v: string) => {
    const [y, m, d] = v.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(dateStr) - toUTC(startDate)) / 86_400_000);
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function addDaysUTC(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function fromHHMM(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toHHMM(mins: number): string {
  const norm = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const isBufferBlock = (label?: string) =>
  Boolean(label && (label.toLowerCase().includes('buffer') || label.toLowerCase().includes('net adjust')));

const byDate = (a: string, b: string) => (!a ? 1 : !b ? -1 : a.localeCompare(b));

interface CourtSectionBlockProps {
  section: {
    key: string;
    title: string | null;
    courts: Array<{
      courtName: string;
      matches: ScheduleMatch[];
      rows: CourtRow[];
      endText: string;
    }>;
  };
  children: (props: {
    gridRef: React.RefObject<HTMLDivElement | null>;
    onScroll: () => void;
    courtHeaderProps: {
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
      onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
      onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
      onLostPointerCapture: (e: React.PointerEvent<HTMLDivElement>) => void;
      'data-draggable'?: string;
    };
    isGrabbing: boolean;
  }) => React.ReactNode;
}

function CourtSectionBlock({ section, children }: CourtSectionBlockProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [thumbRatio, setThumbRatio] = useState(1);
  const [canScroll, setCanScroll] = useState(false);
  const isDragging = useRef(false);

  const isGrabbingCourts = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScrollLeft = useRef(0);
  const [isGrabbing, setIsGrabbing] = useState(false);

  useEffect(() => {
    if (!isGrabbing) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isGrabbing]);

  const updateScroll = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max > 2) {
      setCanScroll(true);
      setScrollRatio(Math.max(0, Math.min(1, el.scrollLeft / max)));
      setThumbRatio(Math.max(0.15, Math.min(1, el.clientWidth / el.scrollWidth)));
    } else {
      setCanScroll(false);
      setScrollRatio(0);
      setThumbRatio(1);
    }
  }, []);

  useEffect(() => {
    updateScroll();
    window.addEventListener('resize', updateScroll);
    return () => window.removeEventListener('resize', updateScroll);
  }, [updateScroll, section.courts.length]);

  const seek = (clientX: number) => {
    const el = gridRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = ratio * max;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    trackRef.current?.setPointerCapture(e.pointerId);
    seek(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    seek(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleCourtHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const el = gridRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;

    isGrabbingCourts.current = true;
    dragStartX.current = e.clientX;
    dragStartScrollLeft.current = el.scrollLeft;
    setIsGrabbing(true);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleCourtHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isGrabbingCourts.current) return;
    const el = gridRef.current;
    if (!el) return;

    const deltaX = e.clientX - dragStartX.current;
    el.scrollLeft = dragStartScrollLeft.current - deltaX;
    updateScroll();
  };

  const handleCourtHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isGrabbingCourts.current) return;
    isGrabbingCourts.current = false;
    setIsGrabbing(false);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const courtHeaderProps = {
    onPointerDown: handleCourtHeaderPointerDown,
    onPointerMove: handleCourtHeaderPointerMove,
    onPointerUp: handleCourtHeaderPointerUp,
    onPointerCancel: handleCourtHeaderPointerUp,
    onLostPointerCapture: handleCourtHeaderPointerUp,
    'data-draggable': canScroll ? 'true' : undefined,
  };

  const thumbWidthPct = thumbRatio * 100;
  const thumbLeftPct = scrollRatio * (100 - thumbWidthPct);

  return (
    <section key={section.key} className={styles.daySection}>
      {section.title && (
        <div className={styles.dayHeading}>
          <Calendar size={16} color="var(--orange, #EE7A4C)" />
          <span>{section.title}</span>
          <span className={styles.dayHeadingMeta}>
            {section.courts.reduce((sum, c) => sum + c.matches.length, 0)} matches
          </span>
        </div>
      )}

      {section.courts.length > 3 && canScroll && (
        <div className={styles.courtSlideBarWrap}>
          <div
            ref={trackRef}
            className={styles.courtSlideBarTrack}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title="Slide to view more courts"
            role="scrollbar"
            aria-label="Courts scrollbar"
            aria-valuenow={Math.round(scrollRatio * 100)}
          >
            <div
              className={styles.courtSlideBarThumb}
              style={{
                left: `${thumbLeftPct}%`,
                width: `${thumbWidthPct}%`,
              }}
            />
          </div>
        </div>
      )}

      {children({ gridRef, onScroll: updateScroll, courtHeaderProps, isGrabbing })}
    </section>
  );
}

export interface CourtScheduleViewProps {
  tournament: TournamentDetail;
  activeDivisionId?: string;
  onSelectDivision?: (divisionId: string) => void;
}

export default function CourtScheduleView({
  tournament,
  activeDivisionId,
  onSelectDivision,
}: CourtScheduleViewProps) {
  const [showAllDivisions, setShowAllDivisions] = useState(true);
  const [activeDay, setActiveDay] = useState<'all' | number>('all');
  const [query, setQuery] = useState('');
  /* Only the narrow layout collapses search to an icon; on a wide filter bar
     the field is always there and this flag does nothing. */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    // If the user explicitly switched the division tab above, focus on that division
    setShowAllDivisions(false);
  }, [activeDivisionId]);

  const labelsByDivision = useMemo(
    () => labelDivisions(tournament.divisions ?? []),
    [tournament.divisions],
  );

  const divColorIndex = useMemo(() => {
    const map = new Map<string, number>();
    tournament.divisions.forEach((d, i) => map.set(d.label, i % 6));
    return map;
  }, [tournament.divisions]);

  // Aggregate all matches across divisions
  const allMatches = useMemo<ScheduleMatch[]>(() => {
    const list: ScheduleMatch[] = [];

    tournament.divisions.forEach((div: DetailDivision) => {
      const labels = labelsByDivision.get(div.id);

      div.bracket.forEach(round => {
        round.matches.forEach(m => {
          const label = labels?.get(m.id);
          if (label?.bye) return;

          const court = m.court || '';
          const time = m.time || '';
          if (!court && !time) return;

          const day = m.scheduledDate ? dayIndexOf(tournament.startDate, m.scheduledDate) : 0;
          const dateStr = m.scheduledDate || tournament.startDate || '';

          const teamA = label?.teamA ?? m.teamAName ?? (m.teamA.length ? m.teamA.map(p => p.name).join(' / ') : 'TBD');
          const teamB = label?.teamB ?? m.teamBName ?? (m.teamB.length ? m.teamB.map(p => p.name).join(' / ') : 'TBD');
          // The roster too: a pair shows as a team name on the card, and a
          // player looking for their own match types their own name.
          const players = [...m.teamA, ...m.teamB].map(pl => pl.name);

          list.push({
            id: m.id,
            divisionLabel: div.label,
            divisionId: div.id,
            roundName: round.round,
            matchNo: label?.no ?? '',
            court: court || 'Court 1',
            time: time || '—',
            teamA,
            teamB,
            haystack: [teamA, teamB, ...players, court, round.round].join(' ').toLowerCase(),
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            winner: (m as any).winner ?? null,
            status: m.status,
            day,
            date: dateStr,
            dateLabel: dateStr ? shortDate(dateStr) : '',
            durationMinutes: round.durationMinutes ?? 45,
          });
        });
      });
    });

    return list;
  }, [tournament, labelsByDivision]);

  const currentDivisionId = activeDivisionId || tournament.divisions[0]?.id;

  // Filter matches based on selected division and active day
  const searchTerm = query.trim().toLowerCase();

  const filteredMatches = useMemo(() => {
    return allMatches.filter(m => {
      if (!showAllDivisions && currentDivisionId && m.divisionId !== currentDivisionId) {
        return false;
      }
      if (activeDay !== 'all' && m.day !== activeDay) {
        return false;
      }
      if (searchTerm && !m.haystack.includes(searchTerm)) {
        return false;
      }
      return true;
    });
  }, [allMatches, showAllDivisions, currentDivisionId, activeDay, searchTerm]);

  const dayCount = tournament.dayCount || 1;
  const splitByDay = dayCount > 1 && activeDay === 'all';

  const sectionTitle = (date: string): string => {
    if (!date) return 'Not yet scheduled';
    const idx = dayIndexOf(tournament.startDate, date);
    return idx >= 0 && idx < dayCount ? `Day ${idx + 1} · ${shortDate(date)}` : shortDate(date);
  };

  const courtSections = useMemo(() => {
    const sections = new Map<string, Map<string, ScheduleMatch[]>>();

    filteredMatches.forEach(m => {
      const key = splitByDay ? m.date : '';
      let courts = sections.get(key);
      if (!courts) {
        courts = new Map();
        sections.set(key, courts);
      }
      const list = courts.get(m.court);
      if (list) list.push(m);
      else courts.set(m.court, [m]);
    });

    const activeBlocks = tournament.scheduleConfig?.blocks ?? [];
    const blocks = activeBlocks.map((b, index) => ({ b, index }));

    return Array.from(sections.entries())
      .sort(([a], [b]) => byDate(a, b))
      .map(([date, courts]) => ({
        key: date || 'undated',
        title: splitByDay ? sectionTitle(date) : null,
        courts: Array.from(courts.entries())
          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
          .map(([courtName, matches]) => {
            const days = new Set(matches.map(m => m.day));
            const rows: CourtRow[] = matches.map(m => ({
              kind: 'match',
              key: m.id,
              sort: timeKey(m.day, m.time),
              m,
            }));

            for (const { b, index } of blocks) {
              if (b.court != null && b.court !== courtName) continue;
              if (isBufferBlock(b.label)) continue;
              const onDays = b.day == null ? [...days] : days.has(b.day) ? [b.day] : [];
              const from = fromHHMM(b.start);
              const to = fromHHMM(b.end);
              if (from == null || to == null || to <= from) continue;
              for (const day of onDays) {
                rows.push({
                  kind: 'block',
                  key: `blk-${index}-${day}`,
                  sort: timeKey(day, b.start),
                  court: courtName,
                  day,
                  label: b.label ?? 'Blocked',
                  from: b.start,
                  to: b.end,
                  minutes: to - from,
                });
              }
            }

            const endsAt = matches.reduce((latest, m) => {
              const start = fromHHMM(m.time);
              return start == null ? latest : Math.max(latest, start + (m.durationMinutes || 45));
            }, -1);

            return {
              courtName,
              matches,
              rows: rows.sort((x, y) => x.sort - y.sort),
              endText: endsAt >= 0 ? toHHMM(endsAt) : '—',
            };
          }),
      }));
  }, [filteredMatches, splitByDay, tournament]);

  const gapStrip = (b: { label: string; from: string; to: string; minutes: number }) => (
    <div className={styles.gapStrip} title={`${b.label} ${b.from}–${b.to}`}>
      <span className={styles.gapStripIcon}>
        {b.label.toLowerCase().includes('lunch') ? <Utensils size={13} /> : <Clock size={13} />}
      </span>
      <span className={styles.gapStripLabel}>{b.label}</span>
      <span className={styles.gapStripTime}>
        {b.from}–{b.to}
      </span>
    </div>
  );

  return (
    <div className={styles.container}>
      {/* ── Filter Bar: divisions toggle + day selector + search ── */}
      <div
        className={`${styles.filterBar} ${searchOpen ? styles.filterBarSearching : ''}`}
        role="toolbar"
        aria-label="Schedule filters"
      >
          {tournament.divisions.length > 1 && (
            <button
              type="button"
              className={`${styles.filterBtn} ${showAllDivisions ? styles.filterBtnActive : ''}`}
              onClick={() => setShowAllDivisions(prev => !prev)}
              aria-pressed={showAllDivisions}
            >
              <span>Show all divisions</span>
            </button>
          )}

          {dayCount > 1 && (
            <>
              {tournament.divisions.length > 1 && (
                <span className={styles.filterDivider} aria-hidden="true" />
              )}
              {/* Desktop segmented date selector */}
              <div className={`${styles.segmented} ${styles.daySegmented}`} role="group" aria-label="Filter by day">
                <button
                  type="button"
                  className={`${styles.segBtn} ${activeDay === 'all' ? styles.segBtnActive : ''}`}
                  onClick={() => setActiveDay('all')}
                  aria-pressed={activeDay === 'all'}
                >
                  {activeDay === 'all' && (
                    <motion.span
                      layoutId="schedule-date-active-pill"
                      className={styles.activeDatePill}
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className={styles.segBtnContent}>All Days</span>
                </button>
                {Array.from({ length: dayCount }, (_, i) => {
                  const dateStr = tournament.startDate ? addDaysUTC(tournament.startDate, i) : '';
                  const dateText = dateStr ? shortDate(dateStr) : '';
                  const isActive = activeDay === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`${styles.segBtn} ${isActive ? styles.segBtnActive : ''}`}
                      onClick={() => setActiveDay(i)}
                      aria-pressed={isActive}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="schedule-date-active-pill"
                          className={styles.activeDatePill}
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                        />
                      )}
                      <span className={styles.segBtnContent}>
                        <span className={styles.dayPillNum}>Day {i + 1}</span>
                        {dateText && <span className={styles.dayPillDate}>{dateText}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Mobile native picker select pill */}
              <div className={`${styles.dateSelectWrap} ${activeDay !== 'all' ? styles.dateSelectActive : ''}`}>
                <span className={styles.dateSelectLabel}>
                  {activeDay === 'all' ? (
                    'All Days'
                  ) : (
                    <>
                      <span>Day {activeDay + 1}</span>
                      {tournament.startDate && (
                        <span className={styles.dateSelectSub}>
                          · {shortDate(addDaysUTC(tournament.startDate, activeDay))}
                        </span>
                      )}
                    </>
                  )}
                </span>
                <ChevronDown size={14} className={styles.selectChevron} aria-hidden="true" />
                <select
                  className={styles.nativeDateSelect}
                  value={activeDay}
                  onChange={(e) => setActiveDay(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  aria-label="Filter schedule by day"
                >
                  <option value="all">All Days</option>
                  {Array.from({ length: dayCount }, (_, i) => {
                    const dateStr = tournament.startDate ? addDaysUTC(tournament.startDate, i) : '';
                    const dateText = dateStr ? shortDate(dateStr) : '';
                    return (
                      <option key={i} value={i}>
                        Day {i + 1}{dateText ? ` (${dateText})` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </>
          )}

        {(tournament.divisions.length > 1 || dayCount > 1) && (
          <span className={styles.filterDivider} aria-hidden="true" />
        )}

        {/* Narrow layouts show a magnifier until it is asked for; the field
            then takes the row, which is why the other filters step aside. */}
        <button
          type="button"
          className={styles.searchToggle}
          onClick={() => {
            setSearchOpen(true);
            // After the commit that unhides it — a hidden input cannot take focus.
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
          aria-label="Search the schedule"
          aria-expanded={searchOpen}
        >
          <Search size={15} />
        </button>

        <div className={`${styles.searchWrap} ${searchOpen ? styles.searchWrapOpen : ''}`}>
          <Search size={14} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            className={styles.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onBlur={() => { if (!query.trim()) setSearchOpen(false); }}
            placeholder="Search player, team, court"
            aria-label="Search the schedule by player, team, court or round"
          />
          {(query || searchOpen) && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => { setQuery(''); setSearchOpen(false); }}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Court Sections ── */}
      {courtSections.length === 0 || courtSections.every(s => s.courts.length === 0) ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{searchTerm ? 'No matches found' : 'No scheduled matches'}</p>
          <p className={styles.emptyBody}>
            {searchTerm
              ? `Nothing matches “${query.trim()}”. Try a player, team, court or round.`
              : !showAllDivisions
              ? 'No scheduled matches found for this division.'
              : activeDay !== 'all'
              ? 'No scheduled matches found for this day.'
              : 'The organizer has not published match times and courts yet.'}
          </p>
        </div>
      ) : (
        courtSections.map(section => (
          <CourtSectionBlock key={section.key} section={section}>
            {({ gridRef, onScroll, courtHeaderProps, isGrabbing }) => (
              <div
                ref={gridRef}
                onScroll={onScroll}
                className={`${styles.courtsGrid} ${isGrabbing ? styles.gridGrabbing : ''}`}
                data-multi-court={section.courts.length > 3 ? 'true' : undefined}
                style={{ '--court-count': section.courts.length || 1 } as CSSProperties}
              >
                {section.courts.map(group => (
                  <div key={group.courtName} className={styles.courtCard}>
                    <div
                      className={styles.courtHeader}
                      {...courtHeaderProps}
                      title={courtHeaderProps['data-draggable'] ? 'Click and drag to slide courts' : undefined}
                    >
                      <span className={styles.courtName}>{group.courtName}</span>
                      <span className={styles.courtCountDot}>·</span>
                      <span className={styles.courtCount}>
                        {group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'}
                      </span>
                    </div>

                    <div className={styles.matchList}>
                      {group.rows.map(row => {
                        if (row.kind === 'block') {
                          return <div key={row.key}>{gapStrip(row)}</div>;
                        }

                        const m = row.m;
                        const matchWinner = getMatchWinner(m);
                        const isWinnerA = matchWinner === 'A';
                        const isWinnerB = matchWinner === 'B';
                        const isLoserA = matchWinner === 'B';
                        const isLoserB = matchWinner === 'A';

                        return (
                          <div
                            key={m.id}
                            id={`match-card-${m.id}`}
                            className={[
                              styles.matchItem,
                              m.status === 'live' ? styles.matchItemLive : '',
                              m.status === 'done' ? styles.matchItemDone : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            data-div={divColorIndex.get(m.divisionLabel) ?? 0}
                          >
                            <div className={styles.matchItemTop}>
                              <span className={styles.matchTime}>
                                <span className={styles.matchTimeBtn}>{m.time}</span>
                                <span className={styles.matchDuration}>{m.durationMinutes || 45} m</span>
                                {m.status === 'live' && (
                                  <span className={styles.liveBadge}>
                                    <span className={styles.liveBadgeDot} aria-hidden="true" />
                                    Live
                                  </span>
                                )}
                              </span>
                              <span className={styles.badgeGroup}>
                                {m.roundName && <span className={styles.roundBadge}>{m.roundName}</span>}
                                <span className={styles.gridMatchNo} title={m.divisionLabel}>
                                  {m.matchNo}
                                </span>
                              </span>
                            </div>

                            <div className={styles.matchTeams}>
                              <div className={styles.teamRow}>
                                <span
                                  className={`${styles.teamRowName} ${
                                    isWinnerA ? styles.teamRowNameWinner : ''
                                  } ${isLoserA ? styles.teamRowNameLoser : ''}`}
                                >
                                  {m.teamA}
                                </span>
                                {m.scoreA && m.scoreA.length > 0 && (
                                  <div className={styles.teamScoreList}>
                                    {m.scoreA.map((s, idx) => (
                                      <span key={idx} className={styles.teamScoreCell}>
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className={styles.teamRow}>
                                <span
                                  className={`${styles.teamRowName} ${
                                    isWinnerB ? styles.teamRowNameWinner : ''
                                  } ${isLoserB ? styles.teamRowNameLoser : ''}`}
                                >
                                  {m.teamB}
                                </span>
                                {m.scoreB && m.scoreB.length > 0 && (
                                  <div className={styles.teamScoreList}>
                                    {m.scoreB.map((s, idx) => (
                                      <span key={idx} className={styles.teamScoreCell}>
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {group.courtName !== 'Unscheduled' && (
                      <div className={styles.courtEnds}>Ends {group.endText}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CourtSectionBlock>
        ))
      )}
    </div>
  );
}
