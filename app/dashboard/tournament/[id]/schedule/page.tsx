'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  Table,
  Trophy,
  Users,
  Utensils,
  Wand2,
  X,
} from 'lucide-react';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision, type DetailMatch, type ScheduleConfig } from '../../../../../lib/data';
import {
  generateSchedule,
  scheduleInventory,
  autoDedicatedCourts,
  DEFAULT_MATCH_MINUTES,
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
  day: number;           // 0-based day offset (-1 = unscheduled)
  dateLabel: string;     // e.g. "Sat, Jul 26" ('' when unscheduled)
  isPreview?: boolean;   // slot came from an unsaved generated preview
  unscheduled?: boolean; // no court/time assigned
  overScheduled?: boolean; // couldn't fit in the tournament's days (preview overflow)
  durationMinutes: number; // match slot length, for sizing calendar blocks
}

// Sort by (day, "HH:MM") ascending; unscheduled placeholders sink to the end.
function timeKey(day: number, t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  const mins = m ? Number(m[1]) * 60 + Number(m[2]) : 1e6;
  const d = day < 0 ? 1e6 : day;
  return d * 1e7 + mins;
}

// Add `n` UTC days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'.
function addDaysUTC(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// Whole days between two 'YYYY-MM-DD' strings (UTC).
function dayIndexOf(startDate: string, dateStr: string): number {
  const toUTC = (v: string) => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUTC(dateStr) - toUTC(startDate)) / 86_400_000);
}

// Short human date label for a 'YYYY-MM-DD' string (UTC).
function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// An undecided side reads as the match that will decide it, e.g. "Winner of M3".
// `side` is 0 for the home team and 1 for the away team.
function teamOrPlaceholder(
  raw: string | null | undefined,
  roundIndex: number,
  matchIndex: number,
  prevRoundStartNo: number,
  side: 0 | 1,
): string {
  if (raw && raw !== 'TBD' && raw.trim() !== '') return raw;
  return roundIndex === 0
    ? `Winner of M${2 * matchIndex + 1 + side}`
    : `Winner of M${prevRoundStartNo + 2 * matchIndex + side}`;
}

// Minutes as a duration, e.g. 510 -> "8h 30m".
function hoursMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Minutes-since-midnight -> "HH:MM".
function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Vertical scale of the calendar grid: pixels per minute of match time.
const PX_PER_MIN = 2.3;

// A bye isn't played, so it is hidden from every view — and must not be handed
// to the generator either, or it silently eats a court slot that shows up as a
// gap in the schedule. One predicate so both uses can never drift apart.
function isByeMatch(roundName: string, m: DetailMatch): boolean {
  return (
    m.teamAName?.toUpperCase() === 'BYE' ||
    m.teamBName?.toUpperCase() === 'BYE' ||
    m.teamAId === 'bye' ||
    m.teamBId === 'bye' ||
    (roundName.toLowerCase().includes('round of') && m.status === 'done' && (!m.teamAName || !m.teamBName))
  );
}

export default function TournamentSchedulePage() {
  const params = useParams();
  const slug = (params?.id as string) || '';

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Controls
  const [activeDivisionId, setActiveDivisionId] = useState<string>('all');
  const [activeDay, setActiveDay] = useState<number | 'all'>('all');
  const [viewMode, setViewMode] = useState<'court' | 'timeline' | 'grid'>('court');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'upcoming' | 'done'>('all');

  // Generator: config, per-division D_d overrides, unsaved preview.
  const [panelOpen, setPanelOpen] = useState(false);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [preview, setPreview] = useState<ScheduleResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Height of the pinned control bar, published as --chrome-h. On mobile the
  // calendar sizes itself against this so it comes to rest exactly below the
  // bar instead of having its sticky court headers hidden underneath it. The
  // bar grows a row on multi-day events, hence measuring rather than guessing.
  const stickyRef = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState(0);

  useEffect(() => {
    const el = stickyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setChromeHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, detail]);

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

  // Fast lookup of generated court/time/day by match id (only while previewing).
  const previewMap = useMemo(() => {
    const m = new Map<string, { court: string; time: string; day: number }>();
    preview?.assignments.forEach(a => m.set(a.matchId, { court: a.court, time: a.time, day: a.day }));
    return m;
  }, [preview]);

  // Matches the generator couldn't fit before the last day ends — over-scheduled.
  const overflowIds = useMemo(() => new Set(preview?.overflow.map(o => o.matchId) ?? []), [preview]);

  const setConfigField = <K extends keyof ScheduleConfig>(key: K, value: ScheduleConfig[K]) => {
    setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  // Everything the generator needs, derived from the loaded bracket.
  const schedulableDivisions = useMemo<SchedulableDivision[]>(() => {
    if (!detail) return [];
    return detail.divisions.map(d => ({
      id: d.id,
      label: d.label,
      pools: d.drawConfig?.pools ?? 1,
      netHeight: d.netHeight,
      gender: d.gender,
      dedicatedCourts: overrides[d.id] ?? d.dedicatedCourts ?? null,
      matches: d.bracket.flatMap((r, rIdx) =>
        r.matches
          .filter(m => !isByeMatch(r.round, m)) // a bye is never played — don't reserve a court for it
          .map(m => ({
            id: m.id,
            teamA: m.teamAId,
            teamB: m.teamBId,
            isPool: r.format === 'round-robin',
            durationMinutes: r.durationMinutes, // per-round slot length declared in setup
            roundIndex: rIdx,                   // bracket is setup-round order; 0 = opening round
          })),
      ),
    }));
  }, [detail, overrides]);

  // Division whose full match list is open in the modal (null = closed).
  const [matchListDivId, setMatchListDivId] = useState<string | null>(null);

  // Every match of that division, grouped by round, numbered the same way the
  // schedule views number them and with byes left out — byes are never played,
  // so they are not part of what gets scheduled.
  const matchList = useMemo(() => {
    if (!detail || !matchListDivId) return null;
    const div = detail.divisions.find(d => d.id === matchListDivId);
    if (!div) return null;

    let cumulative = 1;
    const rounds = div.bracket.map((r, rIdx) => {
      const startNo = cumulative;
      const prevStartNo = rIdx > 0 ? cumulative - (div.bracket[rIdx - 1]?.matches.length || 0) : 1;
      cumulative += r.matches.length;
      return {
        name: r.round,
        format: r.format,
        durationMinutes: r.durationMinutes ?? DEFAULT_MATCH_MINUTES,
        matches: r.matches
          .map((m, idx) => ({
            id: m.id,
            no: `M${startNo + idx}`,
            teamA: teamOrPlaceholder(m.teamAName, rIdx, idx, prevStartNo, 0),
            teamB: teamOrPlaceholder(m.teamBName, rIdx, idx, prevStartNo, 1),
            status: m.status,
            bye: isByeMatch(r.round, m),
          }))
          .filter(m => !m.bye),
      };
    }).filter(r => r.matches.length > 0);

    const matches = rounds.reduce((s, r) => s + r.matches.length, 0);
    const minutes = rounds.reduce((s, r) => s + r.matches.length * r.durationMinutes, 0);
    return { id: div.id, label: div.label, netHeight: div.netHeight, rounds, matches, minutes };
  }, [detail, matchListDivId]);

  // Close the match list on Escape, the way a dialog is expected to behave.
  useEffect(() => {
    if (!matchListDivId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMatchListDivId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [matchListDivId]);

  // Court time on offer vs court time needed. Recomputed as the organizer edits
  // the config, so they can see whether the event fits before generating.
  const inventory = useMemo(() => {
    if (!detail || !config) return null;
    return scheduleInventory(schedulableDivisions, config, detail.dayCount);
  }, [schedulableDivisions, config, detail]);

  function handleGenerate() {
    if (!detail || !config) return;
    setPreview(generateSchedule(schedulableDivisions, config, detail.dayCount));
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
        ...preview.assignments.map(a => ({ matchId: a.matchId, court: a.court, time: a.time, day: a.day })),
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

  // Aggregate matches from all divisions (excluding BYE matches, formatting TBD as Winner of M...)
  const allMatches = useMemo<ScheduleMatch[]>(() => {
    if (!detail) return [];
    const list: ScheduleMatch[] = [];

    detail.divisions.forEach((div: DetailDivision) => {
      let cumulativeMatchNo = 1;

      div.bracket.forEach((round, rIdx) => {
        const roundStartMatchNo = cumulativeMatchNo;
        const prevRoundStartMatchNo = rIdx > 0 ? cumulativeMatchNo - (div.bracket[rIdx - 1]?.matches.length || 0) : 1;

        round.matches.forEach((m, idx) => {
          const currentMatchNoNum = roundStartMatchNo + idx;

          // Rule 2: Don't put BYE matches in the schedule!
          if (isByeMatch(round.round, m)) return;

          // Rule 1: Replace TBD with Winner of M...
          const formattedTeamA = teamOrPlaceholder(m.teamAName, rIdx, idx, prevRoundStartMatchNo, 0);
          const formattedTeamB = teamOrPlaceholder(m.teamBName, rIdx, idx, prevRoundStartMatchNo, 1);

          const pv = previewMap.get(m.id);
          const overScheduled = overflowIds.has(m.id);
          const court = overScheduled ? 'Unscheduled' : (pv?.court ?? m.court ?? '');
          const time = overScheduled ? '—' : (pv?.time ?? m.time ?? '');
          const day = overScheduled
            ? -1
            : pv
              ? pv.day
              : m.scheduledDate
                ? dayIndexOf(detail.startDate, m.scheduledDate)
                : -1;
          const dateStr = day >= 0 ? addDaysUTC(detail.startDate, day) : '';

          list.push({
            id: m.id,
            divisionLabel: div.label,
            divisionId: div.id,
            roundName: round.round,
            matchNo: `M${currentMatchNoNum}`,
            court: court || 'Unscheduled',
            time: time || '—',
            teamA: formattedTeamA,
            teamB: formattedTeamB,
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            status: m.status,
            day,
            dateLabel: dateStr ? shortDate(dateStr) : '',
            isPreview: !!pv,
            unscheduled: !court || court === 'Unscheduled' || !time || time === '—',
            overScheduled,
            durationMinutes: round.durationMinutes ?? 45,
          });
        });

        cumulativeMatchNo += round.matches.length;
      });
    });

    return list;
  }, [detail, previewMap, overflowIds]);

  const dayCount = detail?.dayCount ?? 1;

  // Filtered matches
  const filteredMatches = useMemo(() => {
    return allMatches.filter(m => {
      if (activeDivisionId !== 'all' && m.divisionId !== activeDivisionId) return false;
      if (activeDay !== 'all' && m.day !== activeDay) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      return true;
    });
  }, [allMatches, activeDivisionId, activeDay, statusFilter]);

  // Group matches by court
  const courtGroups = useMemo(() => {
    const map = new Map<string, ScheduleMatch[]>();
    filteredMatches.forEach(m => {
      const courtName = m.court;
      if (!map.has(courtName)) map.set(courtName, []);
      map.get(courtName)!.push(m);
    });
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === 'Unscheduled') return 1;
        if (b[0] === 'Unscheduled') return -1;
        return a[0].localeCompare(b[0], undefined, { numeric: true });
      })
      .map(([courtName, matches]) => ({
        courtName,
        matches: [...matches].sort((x, y) => timeKey(x.day, x.time) - timeKey(y.day, y.time)),
      }));
  }, [filteredMatches]);

  // Group matches by day + scheduled time (so identical clock times on
  // different days stay separate on a multi-day event).
  const timeGroups = useMemo(() => {
    const map = new Map<string, { day: number; time: string; dateLabel: string; matches: ScheduleMatch[] }>();
    filteredMatches.forEach(m => {
      const key = `${m.day} ${m.time}`;
      if (!map.has(key)) map.set(key, { day: m.day, time: m.time, dateLabel: m.dateLabel, matches: [] });
      map.get(key)!.matches.push(m);
    });
    return Array.from(map.values()).sort((a, b) => timeKey(a.day, a.time) - timeKey(b.day, b.time));
  }, [filteredMatches]);

  // Calendar grid: courts on the X axis (columns), time on the Y axis (rows) at
  // a fixed interval. Each match is a block sized by its duration; one section
  // per day; blocks are tinted by division. `pitch` is the row granularity in
  // minutes (the GCD of every match's start offset and length, so each block
  // lands on an exact row); PX_PER_MIN keeps the visual scale constant.
  const calendar = useMemo(() => {
    const parseMin = (t: string) => { const x = /^(\d{2}):(\d{2})$/.exec(t); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

    const scheduled = filteredMatches.filter(m => !m.unscheduled && m.day >= 0 && m.time !== '—');
    const unscheduled = filteredMatches.filter(m => m.unscheduled || m.court === 'Unscheduled');

    const scheduledCourts = [...new Set(scheduled.map(m => m.court))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const courts = unscheduled.length > 0 ? [...scheduledCourts, 'Unscheduled'] : scheduledCourts;
    const divOrder = [...new Set(filteredMatches.map(m => m.divisionLabel))];

    type Item = { m: ScheduleMatch; startMin: number; dur: number };
    const byDay = new Map<number, { day: number; dateLabel: string; items: Item[] }>();
    for (const m of scheduled) {
      const s = parseMin(m.time);
      if (s == null) continue;
      const dur = Math.max(5, Math.trunc(m.durationMinutes) || 45);
      if (!byDay.has(m.day)) byDay.set(m.day, { day: m.day, dateLabel: m.dateLabel, items: [] });
      byDay.get(m.day)!.items.push({ m, startMin: s, dur });
    }
    if (byDay.size === 0 && unscheduled.length > 0) {
      byDay.set(0, { day: 0, dateLabel: 'Day 1', items: [] });
    }
    const dayList = [...byDay.values()].sort((a, b) => a.day - b.day);

    // One global pitch so every day's rows line up on the same grid.
    let g = 0;
    for (const d of dayList) {
      const dayStart = d.items.length > 0 ? Math.min(...d.items.map(i => i.startMin)) : 480;
      for (const i of d.items) { g = gcd(g, i.startMin - dayStart); g = gcd(g, i.dur); }
    }
    const pitch = Math.max(5, g || 30);

    const days = dayList.map((d, dIdx) => {
      const startMin = d.items.length > 0 ? Math.min(...d.items.map(i => i.startMin)) : 480;
      const endMin = d.items.length > 0 ? Math.max(...d.items.map(i => i.startMin + i.dur)) : 720;

      // Stack unscheduled matches in the 'Unscheduled' column
      const unscheduledBlocks: { m: ScheduleMatch; court: string; startSlot: number; spanSlots: number }[] = [];
      if (unscheduled.length > 0) {
        let currentSlot = 0;
        unscheduled.forEach((u) => {
          const spanSlots = Math.max(1, Math.round((u.durationMinutes || 45) / pitch));
          unscheduledBlocks.push({
            m: u,
            court: 'Unscheduled',
            startSlot: currentSlot,
            spanSlots,
          });
          currentSlot += spanSlots;
        });
      }

      const maxUnscheduledSlot = unscheduledBlocks.reduce((max, b) => Math.max(max, b.startSlot + b.spanSlots), 0);
      const scheduledSlots = Math.max(1, Math.round((endMin - startMin) / pitch));
      const slots = Math.max(scheduledSlots, maxUnscheduledSlot);

      const blocks = [
        ...d.items.map(i => ({
          m: i.m,
          court: i.m.court,
          startSlot: Math.round((i.startMin - startMin) / pitch),
          spanSlots: Math.max(1, Math.round(i.dur / pitch)),
        })),
        ...(dIdx === 0 ? unscheduledBlocks : []),
      ];

      let lunchBlock: { startSlot: number; spanSlots: number; text: string } | null = null;
      if (config?.lunchStart && config?.lunchEnd) {
        const lStart = parseMin(config.lunchStart);
        const lEnd = parseMin(config.lunchEnd);
        if (lStart != null && lEnd != null && lEnd > lStart) {
          const lStartSlot = Math.round((lStart - startMin) / pitch);
          const lSpanSlots = Math.max(1, Math.round((lEnd - lStart) / pitch));
          if (lStartSlot >= 0 && lStartSlot < slots) {
            lunchBlock = {
              startSlot: lStartSlot,
              spanSlots: lSpanSlots,
              text: `Lunch Break (${config.lunchStart} – ${config.lunchEnd})`,
            };
          }
        }
      }

      // Time-axis labels only on full hours (every 60 minutes)
      const labelEvery = Math.max(1, Math.round(60 / pitch));
      const labels: { slot: number; time: string }[] = [];
      for (let s = 0; s <= slots; s += 1) {
        const totalMin = startMin + s * pitch;
        if (totalMin % 60 === 0) {
          labels.push({ slot: s, time: toHHMM(totalMin) });
        }
      }

      return { day: d.day, dateLabel: d.dateLabel, startMin, slots, blocks, labels, lunchBlock };
    });

    return { courts, days, pitch, divOrder, unscheduledCount: unscheduled.length };
  }, [filteredMatches]);

  // Division -> color index (0..5) for calendar tinting, by first appearance.
  const divColorIndex = useMemo(() => {
    const map = new Map<string, number>();
    calendar.divOrder.forEach((label, i) => map.set(label, i % 6));
    return map;
  }, [calendar.divOrder]);

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
    <div
      className={styles.page}
      style={chromeHeight ? ({ '--chrome-h': `${chromeHeight}px` } as CSSProperties) : undefined}
    >
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
      <div className={styles.stickyBar} ref={stickyRef}>
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
              <button
                type="button"
                className={`${styles.segBtn} ${viewMode === 'grid' ? styles.segBtnActive : ''}`}
                onClick={() => setViewMode('grid')}
              >
                <Table size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                Grid
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

        {/* Day Selector (multi-day tournaments only) */}
        {dayCount > 1 && (
          <div className={styles.dayBar}>
            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.segBtn} ${activeDay === 'all' ? styles.segBtnActive : ''}`}
                onClick={() => setActiveDay('all')}
              >
                All Days
              </button>
              {Array.from({ length: dayCount }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`${styles.segBtn} ${activeDay === i ? styles.segBtnActive : ''}`}
                  onClick={() => setActiveDay(i)}
                >
                  Day {i + 1} · {detail ? shortDate(addDaysUTC(detail.startDate, i)) : ''}
                </button>
              ))}
            </div>
          </div>
        )}
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
              <label className={styles.genField}>
                <span>Max matches / team / day</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  placeholder="No limit"
                  value={config.maxMatchesPerTeamPerDay > 0 ? config.maxMatchesPerTeamPerDay : ''}
                  onChange={e => {
                    // Blank (and anything below 1) means no cap, stored as 0.
                    const n = Number(e.target.value);
                    setConfigField('maxMatchesPerTeamPerDay', e.target.value === '' || !Number.isFinite(n) || n < 1 ? 0 : Math.trunc(n));
                  }}
                />
              </label>
            </div>

            {/* Step 1 & 2 of generating: what court time exists, and what has
                to fit into it. Live, so editing the config above updates it. */}
            {inventory && (
              <div className={styles.genDivisions}>
                <div className={styles.genSubhead}>Court time available vs needed</div>
                <div className={styles.capacityGrid}>
                  {inventory.capacity.map(c => (
                    <div key={c.day} className={styles.capacityCard}>
                      <span className={styles.capacityDay}>
                        Day {c.day + 1}
                        {detail ? ` · ${shortDate(addDaysUTC(detail.startDate, c.day))}` : ''}
                      </span>
                      <span className={styles.capacityValue}>{hoursMinutes(c.courtMinutes)}</span>
                      <span className={styles.capacityMeta}>
                        {config.courtCount} court{config.courtCount === 1 ? '' : 's'} × {hoursMinutes(c.playableMinutes)}
                      </span>
                    </div>
                  ))}
                  <div className={`${styles.capacityCard} ${styles.capacityTotal}`}>
                    <span className={styles.capacityDay}>Needed</span>
                    <span className={styles.capacityValue}>{hoursMinutes(inventory.demandMinutes)}</span>
                    <span className={styles.capacityMeta}>
                      {inventory.matches} match{inventory.matches === 1 ? '' : 'es'} ·{' '}
                      {inventory.demandMinutes <= inventory.supplyMinutes
                        ? `${hoursMinutes(inventory.supplyMinutes - inventory.demandMinutes)} spare`
                        : `${hoursMinutes(inventory.demandMinutes - inventory.supplyMinutes)} short`}
                    </span>
                  </div>
                </div>
                <p className={styles.genHint}>
                  Court time is the whole venue: {hoursMinutes(inventory.supplyMinutes)} across {dayCount} day
                  {dayCount === 1 ? '' : 's'}. Spare time doesn&apos;t guarantee a fit — a match still waits for its teams and
                  for the round before it.
                </p>
              </div>
            )}

            {inventory && inventory.demand.length > 0 && (
              <div className={styles.genDivisions}>
                <div className={styles.genSubhead}>Matches to schedule</div>
                <div className={styles.genDivGrid}>
                  {inventory.demand.map(d => (
                    <button
                      key={d.divisionId}
                      type="button"
                      className={`${styles.genDivRow} ${styles.demandCard}`}
                      onClick={() => setMatchListDivId(d.divisionId)}
                      aria-label={`Show all ${d.matches} matches for ${d.label}`}
                    >
                      <span className={styles.genDivName}>{d.label}</span>
                      <span className={styles.genDivMeta}>{d.netHeight != null ? `${d.netHeight}m net` : 'net n/a'}</span>
                      <span className={styles.demandValue}>
                        {d.matches} · {hoursMinutes(d.minutes)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                Each match uses the length set for its round in Setup. Leave <em>max matches / team / day</em> blank for no limit; set it and a team&apos;s
                remaining matches roll to the next day once it hits the cap (pool play only — a knockout match&apos;s teams aren&apos;t known until the round
                before it is played). Leave courts blank to auto-size (half the pool count, min 1).
                Divisions with no matches yet reserve no courts. Matches that can&apos;t fit within the tournament&apos;s {dayCount} day{dayCount === 1 ? '' : 's'} are flagged as over-scheduled.
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
                {' '}· {Math.floor(preview.dayCapacityMinutes / 60)}h {preview.dayCapacityMinutes % 60}m/court/day
                {preview.pivots > 0 && <> · {preview.pivots} net change{preview.pivots === 1 ? '' : 's'}</>}
                {' '}· {preview.backToBack === 0
                  ? 'no back-to-back'
                  : `${preview.backToBack} back-to-back`}
                {dayCount > 1 && (
                  preview.openingRoundSpill > 0 ? (
                    <span className={styles.previewWarn}>
                      <AlertTriangle size={13} /> {preview.openingRoundSpill} first-round match
                      {preview.openingRoundSpill === 1 ? '' : 'es'} rolled past day 1
                    </span>
                  ) : (
                    <> · first round fits day 1</>
                  )
                )}
                {preview.overflow.length > 0 && (
                  <span className={styles.previewWarn}>
                    <AlertTriangle size={13} /> {preview.overflow.length} over-scheduled (won&apos;t fit in {dayCount} day{dayCount === 1 ? '' : 's'})
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
            <div className={styles.courtsGrid} style={{ '--court-count': courtGroups.length || 1 } as CSSProperties}>
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
                        className={`${styles.matchItem} ${m.status === 'live' ? styles.matchItemLive : ''} ${m.isPreview ? styles.matchItemPreview : ''} ${m.unscheduled ? styles.matchItemUnscheduled : ''} ${m.overScheduled ? styles.matchItemOverflow : ''}`}
                      >
                        <div className={styles.matchItemTop}>
                          <span className={styles.matchTime}>
                            {m.overScheduled
                              ? <><AlertTriangle size={13} /> Over-scheduled · {m.matchNo}</>
                              : <><Clock size={13} /> {dayCount > 1 && m.dateLabel ? `${m.dateLabel} · ` : ''}{m.time} · {m.matchNo}</>}
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
        ) : viewMode === 'timeline' ? (
          <div>
            <h2 className={styles.sectionTitle}>
              <List size={22} color="var(--orange, #EE7A4C)" />
              Chronological Match Timeline
            </h2>
            <div className={styles.timelineFeed}>
              {timeGroups.map(group => (
                <div key={`${group.day} ${group.time}`} className={styles.timeSlotGroup}>
                  <div className={styles.timeSlotHeader}>
                    <Clock size={16} color="var(--orange, #EE7A4C)" />
                    {dayCount > 1 && group.dateLabel ? `${group.dateLabel} · ` : 'Scheduled Time: '}{group.time}
                  </div>
                  <div className={styles.timelineGrid} style={{ '--match-count': group.matches.length || 1 } as CSSProperties}>
                    {group.matches.map(m => (
                      <div
                        key={m.id}
                        className={`${styles.matchItem} ${m.status === 'live' ? styles.matchItemLive : ''} ${m.isPreview ? styles.matchItemPreview : ''} ${m.unscheduled ? styles.matchItemUnscheduled : ''} ${m.overScheduled ? styles.matchItemOverflow : ''}`}
                      >
                        <div className={styles.matchItemTop}>
                          <span className={styles.matchTime}>{m.overScheduled ? <><AlertTriangle size={13} /> Over-scheduled</> : m.court} · {m.matchNo}</span>
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
            <div className={styles.gridHeaderRow}>
              <div className={styles.gridHeaderLeft}>
                <div className={styles.gridHeaderIconBadge}>
                  <Table size={20} color="#FFFFFF" />
                </div>
                <div>
                  <div className={styles.gridHeaderEyebrow}>
                    {detail ? detail.title.toUpperCase() : 'TOURNAMENT'} · DAY 1
                  </div>
                  <h2 className={styles.gridHeaderTitle}>Court Schedule</h2>
                </div>
              </div>
              <div className={styles.gridHeaderRight}>
                {calendar.divOrder.map(label => (
                  <span key={label} className={styles.calLegendItem}>
                    <span className={styles.calSwatch} data-div={divColorIndex.get(label) ?? 0} />
                    {label}
                  </span>
                ))}
                <span className={styles.pendingPill}>Result pending</span>
              </div>
            </div>

            {calendar.courts.length === 0 ? (
              <p className={styles.gridNote}>No scheduled matches to show. Generate and save a schedule first.</p>
            ) : (
              calendar.days.map(day => (
                <div key={day.day} className={styles.calDaySection}>
                  {dayCount > 1 && day.dateLabel && <div className={styles.calDayHeading}>{day.dateLabel}</div>}
                  <div className={styles.calScroll}>
                    <div
                      className={styles.calGrid}
                      style={{
                        '--cal-courts': calendar.courts.length,
                        '--cal-rows': day.slots,
                      } as CSSProperties}
                    >
                      {/* Top-left corner cell */}
                      <div className={styles.calCorner} style={{ gridColumn: 1, gridRow: 1 } as CSSProperties} />

                      {/* Top Sticky Court Headers */}
                      {calendar.courts.map((court, ci) => {
                        const count = filteredMatches.filter(m => m.court === court).length;
                        return (
                          <div key={court} className={styles.calCourtHeadCard} style={{ gridColumn: ci + 2, gridRow: 1 } as CSSProperties}>
                            <span className={styles.courtName}>{court}</span>
                            <span className={styles.courtCount}>{count} matches</span>
                          </div>
                        );
                      })}

                      {/* Opaque backing for the sticky time column. Labels only
                          exist on the hour, so without this the match blocks
                          show through the gaps as courts scroll underneath. */}
                      <div
                        className={styles.calTimeGutter}
                        style={{ gridColumn: 1, gridRow: `2 / span ${Math.max(1, day.slots)}` } as CSSProperties}
                      />

                      {/* Y-axis Left Sticky Time Labels */}
                      {day.labels.map(l => (
                        <div key={`t${l.slot}`} className={styles.calTimeLabelCell} style={{ gridColumn: 1, gridRow: l.slot + 2 } as CSSProperties}>
                          <span>{l.time}</span>
                        </div>
                      ))}

                      {/* Horizontal Gridlines */}
                      {day.labels.map(l => (
                        <div key={`ln${l.slot}`} className={styles.calGridLine} style={{ gridColumn: `2 / ${calendar.courts.length + 2}`, gridRow: l.slot + 2 } as CSSProperties} />
                      ))}

                      {/* Lunch Break Slot Banner */}
                      {day.lunchBlock && (
                        <div
                          className={styles.lunchBreakSlot}
                          style={{
                            gridColumn: `2 / ${calendar.courts.filter(c => c !== 'Unscheduled').length + 2}`,
                            gridRow: `${day.lunchBlock.startSlot + 2} / span ${day.lunchBlock.spanSlots}`,
                          } as CSSProperties}
                        >
                          <div className={styles.lunchBreakContent}>
                            <Utensils size={15} />
                            <span>{day.lunchBlock.text}</span>
                          </div>
                        </div>
                      )}

                      {/* Match Block Cards placed at their exact Y-axis time row! */}
                      {day.blocks.map(b => {
                        const ci = calendar.courts.indexOf(b.court);
                        if (ci < 0) return null;
                        const divIdx = divColorIndex.get(b.m.divisionLabel) ?? 0;
                        return (
                          <div
                            key={b.m.id}
                            className={`${styles.gridMatchCard} ${b.m.status === 'live' ? styles.gridMatchCardLive : ''}`}
                            data-div={divIdx}
                            style={{
                              gridColumn: ci + 2,
                              gridRow: `${b.startSlot + 2} / span ${b.spanSlots}`,
                            } as CSSProperties}
                          >
                            <div className={styles.gridMatchTop}>
                              <div className={styles.gridMatchTimeWrap}>
                                <span className={styles.gridMatchTime}>{b.m.time}</span>
                                <span className={styles.gridMatchDot}>·</span>
                                <span className={styles.gridMatchDuration}>{b.m.durationMinutes || 45} m</span>
                              </div>
                              <span className={styles.gridMatchNo}>{b.m.matchNo}</span>
                            </div>
                            <div className={styles.gridTeamRow}>
                              <span className={styles.gridTeamName}>{b.m.teamA}</span>
                              <div className={styles.gridScores}>
                                {b.m.scoreA && b.m.scoreA.length > 0 ? (
                                  b.m.scoreA.map((s, idx) => (
                                    <span key={idx} className={styles.gridScoreBadgeWin}>{s}</span>
                                  ))
                                ) : (
                                  <>
                                    <span className={styles.gridScoreEmpty} />
                                    <span className={styles.gridScoreEmpty} />
                                  </>
                                )}
                              </div>
                            </div>
                            <div className={styles.gridVsRow}>
                              <span className={styles.gridVsLine} />
                              <span className={styles.gridVsText}>vs</span>
                              <span className={styles.gridVsLine} />
                            </div>
                            <div className={styles.gridTeamRow}>
                              <span className={styles.gridTeamName}>{b.m.teamB}</span>
                              <div className={styles.gridScores}>
                                {b.m.scoreB && b.m.scoreB.length > 0 ? (
                                  b.m.scoreB.map((s, idx) => (
                                    <span key={idx} className={styles.gridScoreBadge}>{s}</span>
                                  ))
                                ) : (
                                  <>
                                    <span className={styles.gridScoreEmpty} />
                                    <span className={styles.gridScoreEmpty} />
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* ── Division Match List ─────────────────────────────── */}
      {matchList && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={e => { if (e.target === e.currentTarget) setMatchListDivId(null); }}
        >
          <div className={styles.modalPanel} role="dialog" aria-modal="true" aria-labelledby="matchListTitle">
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalEyebrow}>
                  {matchList.matches} match{matchList.matches === 1 ? '' : 'es'} · {hoursMinutes(matchList.minutes)}
                  {matchList.netHeight ? ` · ${matchList.netHeight} net` : ''}
                </div>
                <h3 className={styles.modalTitle} id="matchListTitle">{matchList.label}</h3>
              </div>
              <button
                type="button"
                className={styles.genClose}
                onClick={() => setMatchListDivId(null)}
                aria-label="Close match list"
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {matchList.rounds.length === 0 ? (
                <p className={styles.gridNote}>This division has no matches drawn yet.</p>
              ) : (
                matchList.rounds.map(round => (
                  <div key={round.name} className={styles.roundBlock}>
                    <div className={styles.roundHead}>
                      <span className={styles.roundName}>{round.name}</span>
                      <span className={styles.roundMeta}>
                        {round.matches.length} match{round.matches.length === 1 ? '' : 'es'} · {round.durationMinutes} min
                        {round.matches.length === 1 ? '' : ' each'}
                      </span>
                    </div>
                    <div className={styles.roundMatches}>
                      {round.matches.map(m => (
                        <div key={m.id} className={styles.matchRow}>
                          <span className={styles.matchRowNo}>{m.no}</span>
                          <span className={styles.matchRowTeams}>
                            {m.teamA} <span className={styles.gridVsText}>vs</span> {m.teamB}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <p className={styles.genHint}>
                Byes are left out — they are never played, so they take no court time.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
