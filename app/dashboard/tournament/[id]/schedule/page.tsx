'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Clock,
  Filter,
  Grid,
  List,
  MapPin,
  Printer,
  QrCode,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision } from '../../../../../lib/data';

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
  status: 'upcoming' | 'live' | 'done';
}

export default function TournamentSchedulePage() {
  const params = useParams();
  const slug = (params?.id as string) || '';

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Controls
  const [activeDivisionId, setActiveDivisionId] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'court' | 'timeline'>('court');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'upcoming' | 'done'>('all');

  useEffect(() => {
    if (!slug) return;
    let cancel = false;
    getTournamentDetail(slug)
      .then(res => {
        if (!cancel) {
          setDetail(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancel) setLoading(false);
      });
    return () => { cancel = true; };
  }, [slug]);

  // Aggregate matches from all divisions
  const allMatches = useMemo<ScheduleMatch[]>(() => {
    if (!detail) return [];
    const list: ScheduleMatch[] = [];

    detail.divisions.forEach((div: DetailDivision) => {
      div.bracket.forEach(round => {
        round.matches.forEach((m, idx) => {
          list.push({
            id: m.id,
            divisionLabel: div.label,
            divisionId: div.id,
            roundName: round.round,
            matchNo: `M${idx + 1}`,
            court: m.court || `Court ${(idx % 4) + 1}`,
            time: m.time || '10:00 AM',
            teamA: m.teamAName || 'TBD',
            teamB: m.teamBName || 'TBD',
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            status: m.status,
          });
        });
      });
    });

    return list;
  }, [detail]);

  // Filtered matches
  const filteredMatches = useMemo(() => {
    return allMatches.filter(m => {
      if (activeDivisionId !== 'all' && m.divisionId !== activeDivisionId) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      return true;
    });
  }, [allMatches, activeDivisionId, statusFilter]);

  // Group matches by court
  const courtGroups = useMemo(() => {
    const map = new Map<string, ScheduleMatch[]>();
    filteredMatches.forEach(m => {
      const courtName = m.court;
      if (!map.has(courtName)) map.set(courtName, []);
      map.get(courtName)!.push(m);
    });
    return Array.from(map.entries()).map(([courtName, matches]) => ({
      courtName,
      matches,
    }));
  }, [filteredMatches]);

  // Group matches by scheduled time
  const timeGroups = useMemo(() => {
    const map = new Map<string, ScheduleMatch[]>();
    filteredMatches.forEach(m => {
      const timeSlot = m.time;
      if (!map.has(timeSlot)) map.set(timeSlot, []);
      map.get(timeSlot)!.push(m);
    });
    return Array.from(map.entries()).map(([timeSlot, matches]) => ({
      timeSlot,
      matches,
    }));
  }, [filteredMatches]);

  const heroImage = 'https://images.unsplash.com/photo-1519766304817-4f37bda74a29?auto=format&fit=crop&w=1600&q=80';
  const totalTeams = detail?.divisions.reduce((acc, d) => acc + d.filled, 0) ?? 0;
  const isLive = allMatches.some(m => m.status === 'live');

  if (loading) {
    return (
      <div className={styles.page} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ color: 'var(--ink-600)', fontSize: 16, fontWeight: 600 }}>Loading Schedule...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Fixed Back Link ───────────────────────────────────── */}
      <Link href="/dashboard" className={styles.backLink} aria-label="Back to Dashboard">
        <ArrowLeft size={18} />
      </Link>

      {/* ── Hero Banner ───────────────────────────────────────── */}
      <section
        className={styles.hero}
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(20,24,30,0.12) 0%, rgba(20,24,30,0.40) 45%, rgba(20,24,30,0.75) 100%), url('${heroImage}')`,
        }}
      >
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            <div className={styles.heroTopRow}>
              {isLive && (
                <span className={styles.livePill}>
                  <span className={styles.livePillDot} aria-hidden="true" />
                  Live Tournament Schedule
                </span>
              )}
            </div>
            <h1 className={styles.heroTitle}>{detail?.title ?? 'Tournament Schedule'}</h1>
            <div className={styles.heroMeta}>
              {detail?.date && <span className={styles.heroMetaPill}><Calendar size={15} /> {detail.date}</span>}
              {detail?.location && <span className={styles.heroMetaPill}><MapPin size={15} /> {detail.location}</span>}
              <span className={styles.heroMetaPill}>
                <Users size={15} /> {detail?.divisions.length ?? 0} Divisions · {totalTeams} Teams
              </span>
            </div>
          </div>

          <div className={styles.heroActions}>
            <Link href={`/dashboard/tournament/${slug}`} className={styles.heroPrimaryBtn}>
              <Trophy size={16} /> Open Bracket
            </Link>
            <Link href={`/dashboard/tournament/${slug}/setup`} className={styles.heroGhostBtn}>
              <Settings size={16} /> Manage Setup
            </Link>
            <button
              type="button"
              className={styles.heroGhostBtn}
              onClick={() => window.print()}
            >
              <Printer size={16} /> Print Schedule
            </button>
          </div>
        </div>
      </section>

      {/* ── Sticky Control Bar ───────────────────────────────── */}
      <div className={styles.stickyBar}>
        <div className={styles.stickyInner}>
          {/* Division Selector Tabs */}
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segBtn} ${activeDivisionId === 'all' ? styles.segBtnActive : ''}`}
              onClick={() => setActiveDivisionId('all')}
            >
              All Divisions
            </button>
            {detail?.divisions.map(d => (
              <button
                key={d.id}
                type="button"
                className={`${styles.segBtn} ${activeDivisionId === d.id ? styles.segBtnActive : ''}`}
                onClick={() => setActiveDivisionId(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* View Mode & Status Controls */}
          <div className={styles.controlsGroup}>
            {/* View Mode Toggle */}
            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.segBtn} ${viewMode === 'court' ? styles.segBtnActive : ''}`}
                onClick={() => setViewMode('court')}
              >
                <Grid size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                By Court
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${viewMode === 'timeline' ? styles.segBtnActive : ''}`}
                onClick={() => setViewMode('timeline')}
              >
                <List size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                Timeline
              </button>
            </div>

            {/* Status Filter */}
            <div className={styles.selectWrap}>
              <select
                className={styles.select}
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
              >
                <option value="all">All Match Statuses</option>
                <option value="live">Live Matches</option>
                <option value="upcoming">Upcoming Matches</option>
                <option value="done">Completed Matches</option>
              </select>
              <ChevronDown size={14} className={styles.selectChevron} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Schedule Content ───────────────────────────── */}
      <main className={styles.main}>
        {viewMode === 'court' ? (
          <div>
            <h2 className={styles.sectionTitle}>
              <Grid size={22} color="var(--orange, #EE7A4C)" />
              Court Match Schedules ({courtGroups.length} Courts)
            </h2>
            <div className={styles.courtsGrid}>
              {courtGroups.map(group => (
                <div key={group.courtName} className={styles.courtCard}>
                  <div className={styles.courtHeader}>
                    <span className={styles.courtName}>{group.courtName}</span>
                    <span className={styles.courtCount}>{group.matches.length} matches</span>
                  </div>
                  <div className={styles.matchList}>
                    {group.matches.map(m => (
                      <div
                        key={m.id}
                        className={`${styles.matchItem} ${m.status === 'live' ? styles.matchItemLive : ''}`}
                      >
                        <div className={styles.matchItemTop}>
                          <span className={styles.matchTime}>
                            <Clock size={13} /> {m.time} · {m.matchNo}
                          </span>
                          <span className={styles.divisionBadge}>{m.divisionLabel}</span>
                        </div>
                        <div className={styles.matchTeams}>
                          <div className={styles.teamRow}>
                            <span>{m.teamA}</span>
                            {m.scoreA && m.scoreA.length > 0 && (
                              <span className={styles.teamScore}>{m.scoreA.join(' · ')}</span>
                            )}
                          </div>
                          <div className={styles.teamRow}>
                            <span>{m.teamB}</span>
                            {m.scoreB && m.scoreB.length > 0 && (
                              <span className={styles.teamScore}>{m.scoreB.join(' · ')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <h2 className={styles.sectionTitle}>
              <List size={22} color="var(--orange, #EE7A4C)" />
              Chronological Match Timeline
            </h2>
            <div className={styles.timelineFeed}>
              {timeGroups.map(group => (
                <div key={group.timeSlot} className={styles.timeSlotGroup}>
                  <div className={styles.timeSlotHeader}>
                    <Clock size={16} color="var(--orange, #EE7A4C)" />
                    Scheduled Time: {group.timeSlot}
                  </div>
                  <div className={styles.timelineGrid}>
                    {group.matches.map(m => (
                      <div
                        key={m.id}
                        className={`${styles.matchItem} ${m.status === 'live' ? styles.matchItemLive : ''}`}
                      >
                        <div className={styles.matchItemTop}>
                          <span className={styles.matchTime}>{m.court} · {m.matchNo}</span>
                          <span className={styles.divisionBadge}>{m.divisionLabel}</span>
                        </div>
                        <div className={styles.matchTeams}>
                          <div className={styles.teamRow}>
                            <span>{m.teamA}</span>
                            {m.scoreA && m.scoreA.length > 0 && (
                              <span className={styles.teamScore}>{m.scoreA.join(' · ')}</span>
                            )}
                          </div>
                          <div className={styles.teamRow}>
                            <span>{m.teamB}</span>
                            {m.scoreB && m.scoreB.length > 0 && (
                              <span className={styles.teamScore}>{m.scoreB.join(' · ')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
