'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  Clock,
  Grid,
  List,
  MapPin,
  Printer,
  Save,
  Settings,
  SlidersHorizontal,
  Trophy,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision, type ScheduleConfig } from '../../../../../lib/data';
import {
  generateSchedule,
  autoDedicatedCourts,
  type SchedulableDivision,
  type ScheduleResult,
} from '../../../../../lib/schedule/generate';

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
  isPreview?: boolean;   // slot came from an unsaved generated preview
  unscheduled?: boolean; // no court/time assigned
}

// Sort "HH:MM" ascending; unscheduled placeholders sink to the end.
function timeKey(t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
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

  // Generator: config, per-division D_d overrides, unsaved preview.
  const [panelOpen, setPanelOpen] = useState(false);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [preview, setPreview] = useState<ScheduleResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancel = false;
    getTournamentDetail(slug)
      .then(res => {
        if (cancel || !res) {
          if (!cancel) setLoading(false);
          return;
        }
        setDetail(res);
        // Seed the generator config + per-division overrides from the load.
        setConfig(res.scheduleConfig);
        const ov: Record<string, number | null> = {};
        res.divisions.forEach(d => { ov[d.id] = d.dedicatedCourts; });
        setOverrides(ov);
        setLoading(false);
      })
      .catch(() => {
        if (!cancel) setLoading(false);
      });
    return () => { cancel = true; };
  }, [slug]);

  // Fast lookup of generated court/time by match id (only while previewing).
  const previewMap = useMemo(() => {
    const m = new Map<string, { court: string; time: string }>();
    preview?.assignments.forEach(a => m.set(a.matchId, { court: a.court, time: a.time }));
    return m;
  }, [preview]);

  const setConfigField = <K extends keyof ScheduleConfig>(key: K, value: ScheduleConfig[K]) => {
    setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  function handleGenerate() {
    if (!detail || !config) return;
    const divs: SchedulableDivision[] = detail.divisions.map(d => ({
      id: d.id,
      label: d.label,
      pools: d.drawConfig?.pools ?? 1,
      netHeight: d.netHeight,
      gender: d.gender,
      dedicatedCourts: overrides[d.id] ?? d.dedicatedCourts ?? null,
      matches: d.bracket.flatMap(r =>
        r.matches.map(m => ({
          id: m.id,
          teamA: m.teamAId,
          teamB: m.teamBId,
          isPool: r.format === 'round-robin',
        })),
      ),
    }));
    setPreview(generateSchedule(divs, config));
    setSaveMsg(null);
  }

  async function handleSave() {
    if (!detail || !config || !preview) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const divisionOverrides = detail.divisions.map(d => ({
        divisionId: d.id,
        dedicatedCourts: overrides[d.id] ?? null,
      }));
      const patchRes = await fetch(`/api/tournaments/${slug}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, divisionOverrides }),
      });
      if (!patchRes.ok) throw new Error((await patchRes.json().catch(() => ({}))).error || 'Failed to save config');

      const assignments = [
        ...preview.assignments.map(a => ({ matchId: a.matchId, court: a.court, time: a.time })),
        ...preview.overflow.map(o => ({ matchId: o.matchId, court: null, time: null })),
      ];
      const putRes = await fetch(`/api/tournaments/${slug}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!putRes.ok) throw new Error((await putRes.json().catch(() => ({}))).error || 'Failed to save schedule');

      const fresh = await getTournamentDetail(slug);
      setDetail(fresh);
      setPreview(null);
      setSaveMsg('Schedule saved.');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Aggregate matches from all divisions
  const allMatches = useMemo<ScheduleMatch[]>(() => {
    if (!detail) return [];
    const list: ScheduleMatch[] = [];

    detail.divisions.forEach((div: DetailDivision) => {
      div.bracket.forEach(round => {
        round.matches.forEach((m, idx) => {
          const pv = previewMap.get(m.id);
          const court = pv?.court ?? m.court ?? '';
          const time = pv?.time ?? m.time ?? '';
          list.push({
            id: m.id,
            divisionLabel: div.label,
            divisionId: div.id,
            roundName: round.round,
            matchNo: `M${idx + 1}`,
            court: court || 'Unscheduled',
            time: time || '—',
            teamA: m.teamAName || 'TBD',
            teamB: m.teamBName || 'TBD',
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            status: m.status,
            isPreview: !!pv,
            unscheduled: !court && !time,
          });
        });
      });
    });

    return list;
  }, [detail, previewMap]);

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
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([courtName, matches]) => ({
        courtName,
        matches: [...matches].sort((x, y) => timeKey(x.time) - timeKey(y.time)),
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
    return Array.from(map.entries())
      .sort((a, b) => timeKey(a[0]) - timeKey(b[0]))
      .map(([timeSlot, matches]) => ({
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
            <button
              type="button"
              className={styles.heroPrimaryBtn}
              onClick={() => setPanelOpen(o => !o)}
            >
              <Wand2 size={16} /> Generate Schedule
            </button>
            <Link href={`/dashboard/tournament/${slug}`} className={styles.heroGhostBtn}>
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
                onChange={e => setStatusFilter(e.target.value as 'all' | 'live' | 'upcoming' | 'done')}
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

      {/* ── Generator Panel ─────────────────────────────────── */}
      {panelOpen && config && (
        <div className={styles.genPanel}>
          <div className={styles.genInner}>
            <div className={styles.genHeaderRow}>
              <div className={styles.genTitle}><SlidersHorizontal size={18} /> Schedule Generator</div>
              <button type="button" className={styles.genClose} onClick={() => setPanelOpen(false)} aria-label="Close generator">
                <X size={16} />
              </button>
            </div>

            <div className={styles.genGrid}>
              <label className={styles.genField}>
                <span>Day start</span>
                <input type="time" value={config.startTime} onChange={e => setConfigField('startTime', e.target.value)} />
              </label>
              <label className={styles.genField}>
                <span>Day end</span>
                <input type="time" value={config.endTime} onChange={e => setConfigField('endTime', e.target.value)} />
              </label>
              <label className={styles.genField}>
                <span>Courts</span>
                <input type="number" min={1} max={64} value={config.courtCount} onChange={e => setConfigField('courtCount', Number(e.target.value))} />
              </label>
              <label className={styles.genField}>
                <span>Block (min)</span>
                <input type="number" min={5} max={240} step={5} value={config.blockMinutes} onChange={e => setConfigField('blockMinutes', Number(e.target.value))} />
              </label>
              <label className={styles.genField}>
                <span>Lunch start</span>
                <input type="time" value={config.lunchStart} onChange={e => setConfigField('lunchStart', e.target.value)} />
              </label>
              <label className={styles.genField}>
                <span>Lunch end</span>
                <input type="time" value={config.lunchEnd} onChange={e => setConfigField('lunchEnd', e.target.value)} />
              </label>
              <label className={styles.genField}>
                <span>Net buffer (min)</span>
                <input type="number" min={0} max={120} step={5} value={config.netBufferMinutes} onChange={e => setConfigField('netBufferMinutes', Number(e.target.value))} />
              </label>
            </div>

            <div className={styles.genDivisions}>
              <div className={styles.genSubhead}>Dedicated courts per division</div>
              <div className={styles.genDivGrid}>
                {detail?.divisions.map(d => {
                  const pools = d.drawConfig?.pools ?? 1;
                  const auto = autoDedicatedCourts(pools);
                  const val = overrides[d.id];
                  return (
                    <label key={d.id} className={styles.genDivRow}>
                      <span className={styles.genDivName}>{d.label}</span>
                      <span className={styles.genDivMeta}>{pools} pool{pools === 1 ? '' : 's'}</span>
                      <input
                        type="number"
                        min={1}
                        max={config.courtCount}
                        placeholder={`auto (${auto})`}
                        value={val ?? ''}
                        onChange={e => {
                          const raw = e.target.value;
                          setOverrides(prev => ({ ...prev, [d.id]: raw === '' ? null : Number(raw) }));
                        }}
                      />
                    </label>
                  );
                })}
              </div>
              <p className={styles.genHint}>
                Leave blank to auto-size (half the pool count, min 1). Net-height pivots and staggered rest cycles arrive in Phase 2.
              </p>
            </div>

            <div className={styles.genActions}>
              <button type="button" className={styles.genGenerateBtn} onClick={handleGenerate}>
                <Wand2 size={15} /> Generate Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview Save Bar ────────────────────────────────── */}
      {preview && (
        <div className={styles.previewBar}>
          <div className={styles.previewInner}>
            <div className={styles.previewInfo}>
              <span className={styles.previewTag}>Preview</span>
              <span className={styles.previewText}>
                {preview.assignments.length} matches placed · {preview.mode === 'wave' ? 'Rolling-wave' : 'Parallel'} mode
                {' '}(V<sub>R</sub> {preview.venueRatio.toFixed(2)})
                {preview.pivots > 0 && <> · {preview.pivots} net pivot{preview.pivots === 1 ? '' : 's'}</>}
                {preview.overflow.length > 0 && (
                  <span className={styles.previewWarn}>
                    <AlertTriangle size={13} /> {preview.overflow.length} won&apos;t fit before day end
                  </span>
                )}
              </span>
            </div>
            <div className={styles.previewButtons}>
              <button type="button" className={styles.previewDiscard} onClick={() => setPreview(null)} disabled={saving}>
                Discard
              </button>
              <button type="button" className={styles.previewSave} onClick={handleSave} disabled={saving}>
                <Save size={15} /> {saving ? 'Saving…' : 'Save Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
      {saveMsg && <div className={styles.saveMsg}>{saveMsg}</div>}

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
                        className={`${styles.matchItem} ${m.status === 'live' ? styles.matchItemLive : ''} ${m.isPreview ? styles.matchItemPreview : ''} ${m.unscheduled ? styles.matchItemUnscheduled : ''}`}
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
                        className={`${styles.matchItem} ${m.status === 'live' ? styles.matchItemLive : ''} ${m.isPreview ? styles.matchItemPreview : ''} ${m.unscheduled ? styles.matchItemUnscheduled : ''}`}
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
