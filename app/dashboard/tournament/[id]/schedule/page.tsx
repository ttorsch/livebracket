'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  Calendar,
  ChevronDown,
  Clock,
  Grid,
  MapPin,
  Pencil,
  Plus,
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
import { getTournamentDetail, type TournamentDetail, type DetailDivision, type ScheduleConfig } from '../../../../../lib/data';
import {
  generateSchedule,
  scheduleInventory,
  autoDedicatedCourts,
  buildGraph,
  buildGrid,
  validateSchedule,
  DEFAULT_MATCH_MINUTES,
  type BlockedPeriod,
  type EditedPlacement,
  type SchedulableDivision,
  type ScheduleProblem,
  type ScheduleResult,
} from '../../../../../lib/schedule/generate';
import { labelDivisionMatches, loserFeedersOf, type MatchLabel } from '../../../../../lib/divisionMatches';

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
  day: number;           // 0-based day offset (-1 = unscheduled or off the event's days)
  date: string;          // 'YYYY-MM-DD' the match sits on ('' when unscheduled)
  dateLabel: string;     // e.g. "Sat, Jul 26" ('' when unscheduled)
  isPreview?: boolean;   // slot came from an unsaved generated preview
  isEdited?: boolean;    // organizer moved this one by hand
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

// What a broken promise means in the organizer's language. The generator gives
// up constraints in a fixed order when an event won't otherwise fit, and which
// one it gave up is the most useful thing it can tell you — a schedule that
// quietly stopped honouring a setting is worse than one that says so.
const RELAXATION_TEXT: Record<string, string> = {
  finalsOnLastDay: 'finals not all held for the last day',
  stageFinals: 'knockout rounds not staged — no room to run them side by side',
  restIsHard: 'some teams got less than the target rest',
  maxMatchesPerTeamPerDay: 'the per-day match cap was exceeded',
  dayQuota: 'divisions ran ahead of their day plan',
  backToBack: 'some teams played with no gap at all',
};

/** How long the break is. Pre-filled with the length of the match above it,
 *  which is the usual answer, and committed on Enter or the tick. */
function BufferPrompt({
  suggested,
  onConfirm,
  onCancel,
}: {
  suggested: number;
  onConfirm: (minutes: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(suggested));
  const commit = () => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) onConfirm(n);
    else onCancel();
  };
  return (
    <div className={styles.seamPrompt} onPointerDown={e => e.stopPropagation()}>
      <input
        type="number"
        min={5}
        step={5}
        value={value}
        autoFocus
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <span>min</span>
      <button type="button" onClick={commit} title="Insert this buffer">
        <Check size={13} />
      </button>
      <button type="button" onClick={onCancel} title="Cancel">
        <X size={13} />
      </button>
    </div>
  );
}

/** Marks a block as one that pushed the court down when it was inserted, so
 *  removing it knows to pull the court back up. Plain blocked time carries a
 *  different label and is left where it is. */
const BUFFER_LABEL = 'Buffer';

// Vertical scale of the calendar grid: pixels per minute of match time.
const PX_PER_MIN = 2.3;

export default function TournamentSchedulePage() {
  const params = useParams();
  const slug = (params?.id as string) || '';

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Controls
  const [activeDivisionId, setActiveDivisionId] = useState<string>('all');
  const [activeDay, setActiveDay] = useState<number | 'all'>('all');
  const [viewMode, setViewMode] = useState<'court' | 'grid'>('court');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'upcoming' | 'done'>('all');

  // Generator: config, per-division D_d overrides, unsaved preview.
  const [panelOpen, setPanelOpen] = useState(false);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [preview, setPreview] = useState<ScheduleResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  /* Hand edits, layered over whatever the schedule currently is — the unsaved
     preview if there is one, otherwise what is saved. They are deliberately
     *not* pins: generating again starts from the solver's answer, not from
     these. Keeping them separate from both sources is what lets the organizer
     move things about, see what it broke, and still throw it all away. */
  const [edits, setEdits] = useState<Map<string, { court: string; day: number; time: string }>>(new Map());
  /** The schedule is read-only until the organizer asks to edit it.
   *
   *  A published schedule is something people are reading off a screen at the
   *  venue, and every card in it is a click away from moving. Making editing a
   *  mode you deliberately enter means a stray click cannot reshape the day —
   *  and it gives the editing tools somewhere to live rather than sitting on
   *  screen permanently for the ninety-nine percent of the time nobody is
   *  editing. */
  const [editMode, setEditMode] = useState(false);
  /** Clicking the grid drops a block rather than selecting a match. */
  const [blockMode, setBlockMode] = useState(false);
  /** The match a buffer is being inserted in front of, while its length is
   *  typed. Keyed by match rather than by court and time, because the handle
   *  belongs to a card. */
  const [insertAt, setInsertAt] = useState<{ matchId: string; suggested: number } | null>(null);
  /** Match being dragged, so the grid knows to show its drop targets. */
  const [dragging, setDragging] = useState<string | null>(null);
  /** Match whose time is being typed. */
  const [editingTime, setEditingTime] = useState<string | null>(null);

  /** Something on screen differs from what is stored — a hand move, a block,
   *  or a config change — so there is something worth saving. */
  const [dirty, setDirty] = useState(false);

  const moveMatch = (matchId: string, court: string, day: number, time: string) => {
    setEdits(prev => new Map(prev).set(matchId, { court, day, time }));
    setDirty(true);
    setSaveMsg(null);
  };
  const clearEdits = () => setEdits(new Map());

  /* Dragging a match, on pointer events rather than the HTML5 drag API.
   *
   * The native API looks like the obvious choice and is the wrong one here: it
   * does not exist on touch at all, so on a tablet the grid is simply inert with
   * nothing on screen to explain why. Pointer events are one path for mouse,
   * trackpad, pen and finger, and they also let the card follow the cursor
   * instead of relying on the browser's drag image.
   *
   * A drag only begins once the pointer has actually moved a few pixels, so a
   * plain click still reaches the card, and the time button still opens. */
  const drag = useRef<{ id: string; x: number; y: number; started: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  const beginDrag = (id: string, x: number, y: number) => {
    drag.current = { id, x, y, started: false };
  };

  useEffect(() => {
    const cellUnder = (x: number, y: number) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-key]') ?? null;

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.started) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
        d.started = true;
        setDragging(d.id);
      }
      // Stops a finger from scrolling the page while it is carrying a match.
      e.preventDefault();
      setDragPos({ x: e.clientX, y: e.clientY });
      setHoverCell(cellUnder(e.clientX, e.clientY)?.dataset.dropKey ?? null);
    };

    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (d?.started) {
        const cell = cellUnder(e.clientX, e.clientY);
        const { dropCourt, dropDay, dropTime } = cell?.dataset ?? {};
        if (dropCourt && dropTime && dropDay !== undefined) {
          moveMatch(d.id, dropCourt, Number(dropDay), dropTime);
        }
      }
      setDragging(null);
      setDragPos(null);
      setHoverCell(null);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);


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

  // Match numbers and slot names for every division, from the one place that
  // decides them — so the bracket, these views and the match list agree.
  const labelsByDivision = useMemo(() => {
    const out = new Map<string, Map<string, MatchLabel>>();
    detail?.divisions.forEach(d => out.set(d.id, labelDivisionMatches(d)));
    return out;
  }, [detail]);

  // Everything the generator needs, derived from the loaded bracket.
  const schedulableDivisions = useMemo<SchedulableDivision[]>(() => {
    if (!detail) return [];
    return detail.divisions.map(d => {
      // The play-off for 3rd is drawn from the two losing semifinals, and it is
      // drawn *after* the final — so the round order the scheduler would
      // otherwise infer its dependencies from is no help at all. Its feeders
      // are stated outright; every other match's are inferred as before.
      const losers = loserFeedersOf(d);

      return {
        id: d.id,
        label: d.label,
        pools: d.drawConfig?.pools ?? 1,
        netHeight: d.netHeight,
        gender: d.gender,
        dedicatedCourts: overrides[d.id] ?? d.dedicatedCourts ?? null,
        matches: d.bracket.flatMap((r, rIdx) =>
          r.matches
            // a bye is never played — don't reserve a court for it
            .filter(m => !labelsByDivision.get(d.id)?.get(m.id)?.bye)
            .map(m => ({
              id: m.id,
              teamA: m.teamAId,
              teamB: m.teamBId,
              isPool: r.format === 'round-robin',
              // Pool play is rotated a pool at a time, so the scheduler needs
              // to know which pool a match is in — it cannot infer that.
              pool: labelsByDivision.get(d.id)?.get(m.id)?.pool ?? null,
              durationMinutes: r.durationMinutes, // per-round slot length declared in setup
              roundIndex: rIdx,                   // bracket is setup-round order; 0 = opening round
              ...(losers[m.id] ? { isThirdPlace: true, dependsOn: losers[m.id] } : {}),
            })),
        ),
      };
    });
  }, [detail, overrides, labelsByDivision]);

  // Division whose full match list is open in the modal (null = closed).
  const [matchListDivId, setMatchListDivId] = useState<string | null>(null);

  // Every match of that division, grouped by round — and, in pool play, by
  // pool, since a round robin is really one small tournament per pool. Byes
  // are left out: they are never played, so they are not part of what gets
  // scheduled.
  const matchList = useMemo(() => {
    if (!detail || !matchListDivId) return null;
    const div = detail.divisions.find(d => d.id === matchListDivId);
    if (!div) return null;
    const labels = labelsByDivision.get(div.id) ?? new Map<string, MatchLabel>();

    const rounds = div.bracket.map(r => {
      const matches = r.matches
        .map(m => {
          const label = labels.get(m.id);
          return {
            id: m.id,
            no: label?.no ?? '',
            teamA: label?.teamA ?? 'TBD',
            teamB: label?.teamB ?? 'TBD',
            pool: label?.pool ?? null,
            status: m.status,
            bye: !!label?.bye,
          };
        })
        .filter(m => !m.bye);

      // One group per pool, in pool order; everything else stays a single list.
      const byPool = new Map<string, typeof matches>();
      matches.forEach(m => {
        const key = m.pool ?? '';
        const list = byPool.get(key);
        if (list) list.push(m);
        else byPool.set(key, [m]);
      });
      const groups = [...byPool.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, list]) => ({ name: name ? `Pool ${name}` : null, matches: list }));

      return {
        name: r.round,
        format: r.format,
        durationMinutes: r.durationMinutes ?? DEFAULT_MATCH_MINUTES,
        matches,
        groups,
      };
    }).filter(r => r.matches.length > 0);

    const matches = rounds.reduce((s, r) => s + r.matches.length, 0);
    const minutes = rounds.reduce((s, r) => s + r.matches.length * r.durationMinutes, 0);
    return { id: div.id, label: div.label, netHeight: div.netHeight, rounds, matches, minutes };
  }, [detail, matchListDivId, labelsByDivision]);

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
    // Hand moves describe the schedule that was on screen a moment ago, not
    // this one, so they go with it.
    clearEdits();
    setSaveMsg(null);
  }

  // Aggregate matches from all divisions. Byes are left out — never played —
  // and an undecided side reads as whatever the shared labelling calls it.
  const allMatches = useMemo<ScheduleMatch[]>(() => {
    if (!detail) return [];
    const list: ScheduleMatch[] = [];

    detail.divisions.forEach((div: DetailDivision) => {
      const labels = labelsByDivision.get(div.id) ?? new Map<string, MatchLabel>();

      div.bracket.forEach(round => {
        round.matches.forEach(m => {
          const label = labels.get(m.id);
          if (label?.bye) return;

          // A hand edit wins over the preview, which wins over what is saved.
          const ed = edits.get(m.id);
          const pv = previewMap.get(m.id);
          const overScheduled = overflowIds.has(m.id) && !ed;
          const court = overScheduled ? 'Unscheduled' : (ed?.court ?? pv?.court ?? m.court ?? '');
          const time = overScheduled ? '—' : (ed?.time ?? pv?.time ?? m.time ?? '');
          const day = overScheduled
            ? -1
            : ed
              ? ed.day
              : pv
                ? pv.day
                : m.scheduledDate
                  ? dayIndexOf(detail.startDate, m.scheduledDate)
                  : -1;
          // The date a match is actually on, which is not always one of the
          // event's days: a schedule saved before the organizer moved the
          // dates still points at the old ones, and that should read as the
          // date it is rather than as "unscheduled".
          const dateStr = overScheduled
            ? ''
            : ed
              ? addDaysUTC(detail.startDate, ed.day)
              : pv
                ? addDaysUTC(detail.startDate, pv.day)
                : (m.scheduledDate || '');

          list.push({
            id: m.id,
            divisionLabel: div.label,
            divisionId: div.id,
            roundName: round.round,
            matchNo: label?.no ?? '',
            court: court || 'Unscheduled',
            time: time || '—',
            teamA: label?.teamA ?? 'TBD',
            teamB: label?.teamB ?? 'TBD',
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            status: m.status,
            day,
            date: dateStr,
            dateLabel: dateStr ? shortDate(dateStr) : '',
            isPreview: !!pv,
            isEdited: !!ed,
            unscheduled: !court || court === 'Unscheduled' || !time || time === '—',
            overScheduled,
            durationMinutes: round.durationMinutes ?? 45,
          });
        });
      });
    });

    return list;
  }, [detail, previewMap, overflowIds, labelsByDivision, edits]);

  async function handleSave() {
    if (!detail || !config) return;
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

      // Save exactly what is on screen. `allMatches` is already the merge of
      // what is stored, the preview if there is one, and any hand moves on top
      // — so reading it here is the only way the saved schedule and the
      // schedule the organizer is looking at cannot disagree. It also means
      // editing a *saved* schedule saves, which reading the preview could not.
      const assignments = allMatches.map(m =>
        m.unscheduled || m.overScheduled || m.day < 0
          ? { matchId: m.id, court: null, time: null }
          : { matchId: m.id, court: m.court, time: m.time, day: m.day },
      );
      const putRes = await fetch(`/api/tournaments/${slug}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!putRes.ok) throw new Error((await putRes.json().catch(() => ({}))).error || 'Failed to save schedule');

      const fresh = await getTournamentDetail(slug);
      setDetail(fresh);
      setPreview(null);
      clearEdits();
      setDirty(false);
      setSaveMsg('Schedule saved.');
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const dayCount = detail?.dayCount ?? 1;

  /* What the schedule on screen actually breaks.
     Recomputed from the working placements rather than from the generator's
     own report, because after a hand edit the generator's report describes a
     schedule that no longer exists. */
  const problems = useMemo<ScheduleProblem[]>(() => {
    if (!detail || !config || schedulableDivisions.length === 0) return [];
    const placed = allMatches.filter(m => !m.unscheduled && m.day >= 0 && /^\d{2}:\d{2}$/.test(m.time));
    if (placed.length === 0) return [];

    const graph = buildGraph(schedulableDivisions, config.blockMinutes);
    const grid = buildGrid(
      config,
      detail.dayCount,
      schedulableDivisions.flatMap(d => d.matches.map(m => m.durationMinutes ?? config.blockMinutes)),
    );
    const labelOf = (id: string) => {
      for (const [, labels] of labelsByDivision) {
        const l = labels.get(id);
        if (l) return l.no;
      }
      return id;
    };
    const placements: EditedPlacement[] = placed.map(m => ({
      matchId: m.id,
      court: m.court,
      day: m.day,
      startMin: Number(m.time.slice(0, 2)) * 60 + Number(m.time.slice(3, 5)),
      durationMinutes: m.durationMinutes,
    }));
    // Team ids are UUIDs, so a problem that names a team has to be handed the
    // names or it reads as machine noise to the person meant to act on it.
    const teamNames = new Map(
      detail.divisions.flatMap(d => d.teamsList.map(t => [t.id, t.name] as const)),
    );

    return validateSchedule(placements, graph, grid, {
      targetRestMinutes: Math.max(0, config.minRestSlots) * config.blockMinutes,
      label: labelOf,
      teamLabel: id => teamNames.get(id) ?? id,
    });
  }, [allMatches, schedulableDivisions, config, detail, labelsByDivision]);

  /** The match being carried, for the preview that follows the pointer. */
  const draggedMatch = dragging ? allMatches.find(m => m.id === dragging) ?? null : null;

  /* Open a gap on one court and move everything below it down.
   *
   * Two halves, and both are needed. The gap itself becomes a blocked period,
   * so it is venue configuration and survives regenerating — a buffer that
   * vanished the next time you pressed Generate would be worse than useless.
   * The matches below it move by hand, because a hand move is exactly what this
   * is: the organizer overruling the solver about when they start.
   *
   * Only that court is touched. A buffer on court 1 says nothing about court 2,
   * and shifting the whole venue because one net needs re-rigging would be a
   * much bigger claim than the organizer made. */
  const insertBuffer = (court: string, day: number, atMin: number, minutes: number) => {
    const length = Math.max(5, Math.round(minutes));
    if (!Number.isFinite(length) || !config) return;

    const parse = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    for (const m of allMatches) {
      if (m.day !== day || m.court !== court || m.unscheduled) continue;
      if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
      const start = parse(m.time);
      if (start < atMin) continue;
      moveMatch(m.id, court, day, toHHMM(start + length));
    }

    setConfigField('blocks', [
      ...(config.blocks ?? []),
      { court, day, start: toHHMM(atMin), end: toHHMM(atMin + length), label: BUFFER_LABEL },
    ]);
    setDirty(true);
    setSaveMsg(null);
    setInsertAt(null);
  };

  const problemsByMatch = useMemo(() => {
    const map = new Map<string, ScheduleProblem[]>();
    for (const p of problems) {
      const list = map.get(p.matchId);
      if (list) list.push(p);
      else map.set(p.matchId, [p]);
    }
    return map;
  }, [problems]);

  // ── Blocked periods ──────────────────────────────────────────────────────
  const addBlock = (court: string, day: number, startMin: number) => {
    if (!config) return;
    const length = Math.max(5, Math.trunc(config.blockMinutes) || 45);
    const next: BlockedPeriod = {
      court,
      day,
      start: toHHMM(startMin),
      end: toHHMM(startMin + length),
      label: 'Blocked',
    };
    setConfigField('blocks', [...(config.blocks ?? []), next]);
    setDirty(true);
    setSaveMsg(null);
  };

  /* Taking a block away.
   *
   * A buffer is undone, not merely deleted: it pushed the court down when it
   * went in, so removing it pulls the court back up by the same amount and the
   * schedule closes over the gap. Anything else — a ceremony, a net repair —
   * never moved a match to get there, so removing it never moves one back. Each
   * is the exact inverse of how it was made, which is the only version an
   * organizer can predict. */
  const removeBlock = (index: number) => {
    if (!config) return;
    const list = config.blocks ?? [];
    const gone = list[index];
    if (!gone) return;

    setConfigField('blocks', list.filter((_, i) => i !== index));

    const parse = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const length = parse(gone.end) - parse(gone.start);
    if (gone.label === BUFFER_LABEL && gone.court && gone.day != null && length > 0) {
      for (const m of allMatches) {
        if (m.day !== gone.day || m.court !== gone.court || m.unscheduled) continue;
        if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
        const start = parse(m.time);
        if (start < parse(gone.end)) continue; // sits above the buffer; stays put
        moveMatch(m.id, gone.court, gone.day, toHHMM(start - length));
      }
    }

    setDirty(true);
    setSaveMsg(null);
  };


  // Filtered matches
  const filteredMatches = useMemo(() => {
    return allMatches.filter(m => {
      if (activeDivisionId !== 'all' && m.divisionId !== activeDivisionId) return false;
      if (activeDay !== 'all' && m.day !== activeDay) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      return true;
    });
  }, [allMatches, activeDivisionId, activeDay, statusFilter]);

  // A multi-day event viewed as a whole gets one block per day; on a single-day
  // event, or with one day selected, there is only ever one block and no
  // heading — every match on screen belongs to the same day.
  const splitByDay = dayCount > 1 && activeDay === 'all';

  /* The heading a block of matches sits under. Blocks are keyed by the date
     the matches are on rather than by day index, so a schedule still pointing
     at dates the event has since moved off reads as its own dated block
     instead of being lumped in with the matches that have no slot at all. */
  const sectionTitle = (date: string): string => {
    if (!date) return 'Not yet scheduled';
    if (!detail) return shortDate(date);
    const idx = dayIndexOf(detail.startDate, date);
    return idx >= 0 && idx < dayCount ? `Day ${idx + 1} · ${shortDate(date)}` : shortDate(date);
  };

  // Undated matches sort last; everything else runs in date order.
  const byDate = (a: string, b: string) => (!a ? 1 : !b ? -1 : a.localeCompare(b));

  // Group matches by court, within the day they are played.
  const courtSections = useMemo(() => {
    const sections = new Map<string, Map<string, ScheduleMatch[]>>();
    filteredMatches.forEach(m => {
      const key = splitByDay ? (m.court === 'Unscheduled' ? '' : m.date) : '';
      let courts = sections.get(key);
      if (!courts) { courts = new Map(); sections.set(key, courts); }
      const list = courts.get(m.court);
      if (list) list.push(m);
      else courts.set(m.court, [m]);
    });

    return Array.from(sections.entries())
      .sort(([a], [b]) => byDate(a, b))
      .map(([date, courts]) => ({
        key: date || 'undated',
        title: splitByDay ? sectionTitle(date) : null,
        courts: Array.from(courts.entries())
          .sort((a, b) => {
            if (a[0] === 'Unscheduled') return 1;
            if (b[0] === 'Unscheduled') return -1;
            return a[0].localeCompare(b[0], undefined, { numeric: true });
          })
          .map(([courtName, matches]) => ({
            courtName,
            matches: [...matches].sort((x, y) => timeKey(x.day, x.time) - timeKey(y.day, y.time)),
          })),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMatches, splitByDay, detail, dayCount]);

  // Distinct courts across the whole view, for the section heading.
  const courtCount = useMemo(
    () => new Set(filteredMatches.map(m => m.court)).size,
    [filteredMatches],
  );

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
      const labels: { slot: number; time: string }[] = [];
      for (let s = 0; s <= slots; s += 1) {
        const totalMin = startMin + s * pitch;
        if (totalMin % 60 === 0) {
          labels.push({ slot: s, time: toHHMM(totalMin) });
        }
      }

      // Court time taken off the board by hand, mapped onto this day's rows.
      // Kept beside the lunch banner rather than merged with it: lunch is a
      // rule, a block is something the organizer put there and can take away.
      const blocked = (config?.blocks ?? [])
        .map((b, index) => ({ b, index }))
        .filter(({ b }) => b.day == null || b.day === d.day)
        .flatMap(({ b, index }) => {
          const from = parseMin(b.start);
          const to = parseMin(b.end);
          if (from == null || to == null || to <= from) return [];
          const startSlot = Math.round((from - startMin) / pitch);
          const spanSlots = Math.max(1, Math.round((to - from) / pitch));
          if (startSlot + spanSlots <= 0 || startSlot >= slots) return [];
          const names = b.court == null ? courts.filter(c => c !== 'Unscheduled') : [b.court];
          return names.map(court => ({ index, court, startSlot, spanSlots, label: b.label ?? 'Blocked', from: b.start, to: b.end }));
        });

      return { day: d.day, dateLabel: d.dateLabel, startMin, slots, blocks, labels, lunchBlock, blocked };
    });

    return { courts, days, pitch, divOrder, unscheduledCount: unscheduled.length };
  }, [filteredMatches, config?.blocks, config?.lunchStart, config?.lunchEnd]);

  // Division -> color index (0..5). Taken from the tournament's own division
  // order, not from what is on screen, so a division keeps its color when the
  // view is filtered down to it.
  const divColorIndex = useMemo(() => {
    const map = new Map<string, number>();
    detail?.divisions.forEach((d, i) => map.set(d.label, i % 6));
    calendar.divOrder.forEach(label => {
      if (!map.has(label)) map.set(label, map.size % 6);
    });
    return map;
  }, [detail, calendar.divOrder]);

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
          {/* Division Selector — pill tabs on desktop, dropdown on mobile */}
          <div className={`${styles.segmented} ${styles.pointerOnly}`}>
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
          <div className={`${styles.selectWrap} ${styles.mobileOnly} ${styles.mobileSelectWide}`}>
            <select
              className={styles.select}
              aria-label="Filter by division"
              value={activeDivisionId}
              onChange={e => setActiveDivisionId(e.target.value)}
            >
              <option value="all">All Divisions</option>
              {detail?.divisions.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className={styles.selectChevron} />
          </div>

          {/* View Mode & Status Controls */}
          <div className={styles.controlsGroup}>
            {/* View Mode Toggle — pill tabs on desktop, dropdown on mobile */}
            <div className={`${styles.segmented} ${styles.pointerOnly}`}>
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
                className={`${styles.segBtn} ${viewMode === 'grid' ? styles.segBtnActive : ''}`}
                onClick={() => setViewMode('grid')}
              >
                <Table size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                Grid
              </button>
            </div>
            <label className={`${styles.viewSwitch} ${styles.mobileOnly}`}>
              <span className={styles.viewSwitchLabel}>
                <Table size={14} /> Grid view
              </span>
              <input
                type="checkbox"
                role="switch"
                className={styles.viewSwitchInput}
                checked={viewMode === 'grid'}
                onChange={e => setViewMode(e.target.checked ? 'grid' : 'court')}
              />
              <span className={styles.viewSwitchTrack} aria-hidden="true">
                <span className={styles.viewSwitchThumb} />
              </span>
            </label>

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

            <div className={styles.genToggles}>
              <label className={styles.genToggle}>
                <input
                  type="checkbox"
                  checked={config.stageFinals}
                  onChange={e => setConfigField('stageFinals', e.target.checked)}
                />
                <span>
                  <strong>Stage the knockout rounds</strong>
                  Run each division&apos;s semifinals, 3rd-place play-off and final as whole rounds — side by side across
                  courts, one division at a time — so a round can&apos;t drift apart and each division&apos;s wait is the rest
                  its finalists get. Off, every match is placed on its own.
                </span>
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
                {preview.relaxations.length > 0 && (
                  <span className={styles.previewWarn}>
                    <AlertTriangle size={13} /> To fit everything:{' '}
                    {preview.relaxations.map(r => RELAXATION_TEXT[r] ?? r).join('; ')}
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
              Court Match Schedules ({courtCount} Courts)
            </h2>
            {courtSections.map(section => (
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
            <div className={styles.courtsGrid} style={{ '--court-count': section.courts.length || 1 } as CSSProperties}>
              {section.courts.map(group => (
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
                        data-div={divColorIndex.get(m.divisionLabel) ?? 0}
                      >
                        <div className={styles.matchItemTop}>
                          <span className={styles.matchTime}>
                            {m.overScheduled
                              ? <><AlertTriangle size={13} /> Over-scheduled · {m.matchNo}</>
                              /* The block heading already says the date. */
                              : <><Clock size={13} /> {!splitByDay && dayCount > 1 && m.dateLabel ? `${m.dateLabel} · ` : ''}{m.time} · {m.matchNo}</>}
                          </span>
                          <span className={styles.badgeGroup}>
                            {m.roundName && <span className={styles.roundBadge}>{m.roundName}</span>}
                            <span className={styles.divisionBadge}>{m.divisionLabel}</span>
                          </span>
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
            </section>
            ))}
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
                <button
                  type="button"
                  className={`${styles.gridEditBtn} ${editMode ? styles.gridEditBtnOn : ''}`}
                  onClick={() => {
                    setEditMode(v => !v);
                    setBlockMode(false);
                    setEditingTime(null);
                    setInsertAt(null);
                  }}
                  title={
                    editMode
                      ? 'Lock the schedule so it cannot be changed by accident'
                      : 'Move matches, retime them, and insert buffer time'
                  }
                >
                  {editMode ? <Check size={14} /> : <Pencil size={14} />}
                  {editMode ? 'Done editing' : 'Edit schedule'}
                </button>
                {editMode && (
                  <button
                    type="button"
                    className={`${styles.gridToolBtn} ${blockMode ? styles.gridToolBtnOn : ''}`}
                    onClick={() => { setBlockMode(v => !v); setEditingTime(null); }}
                    title="Click any empty slot to take that court time off the board"
                  >
                    <Ban size={13} /> {blockMode ? 'Click a slot to block' : 'Block time'}
                  </button>
                )}
                {calendar.divOrder.map(label => (
                  <span key={label} className={styles.calLegendItem}>
                    <span className={styles.calSwatch} data-div={divColorIndex.get(label) ?? 0} />
                    {label}
                  </span>
                ))}
                <span className={styles.pendingPill}>Result pending</span>
              </div>
            </div>

            {(edits.size > 0 || problems.length > 0 || (!preview && dirty)) && (
              <div className={`${styles.editBar} ${problems.length > 0 ? styles.editBarFault : ''}`}>
                <span className={styles.editBarText}>
                  {edits.size > 0 && (
                    <>
                      <strong>{edits.size}</strong> match{edits.size === 1 ? '' : 'es'} moved by hand
                      {problems.length > 0 ? ' · ' : ''}
                    </>
                  )}
                  {problems.length > 0 && (
                    <>
                      <AlertTriangle size={13} /> <strong>{problems.length}</strong> problem
                      {problems.length === 1 ? '' : 's'} with this schedule
                    </>
                  )}
                  {edits.size > 0 && problems.length === 0 && ' · nothing broken'}
                </span>
                <span className={styles.editBarActions}>
                  {edits.size > 0 && (
                    <button type="button" className={styles.editBarUndo} onClick={clearEdits} disabled={saving}>
                      Undo all moves
                    </button>
                  )}
                  {!preview && dirty && (
                    <button type="button" className={styles.previewSave} onClick={handleSave} disabled={saving}>
                      <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  )}
                </span>
              </div>
            )}

            <p className={styles.gridNote}>
              {editMode ? (
                <>
                  Drag a match to another court or time, click its time to type a new one, or use the <strong>+</strong>{' '}
                  between two matches to open a gap — everything below it on that court moves down. Hand moves are
                  yours alone: the next Generate starts again from the solver. Buffers and blocked time are part of
                  the venue, so the generator works around them and they survive regenerating.
                </>
              ) : (
                <>The schedule is locked. Press <strong>Edit schedule</strong> to move matches, retime them, or add buffer time.</>
              )}
            </p>

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

                      {/* Drop targets.
                          Only mounted while a drag is in progress or the block
                          tool is armed — a cell per court per row is hundreds
                          of nodes, and they are worth nothing the rest of the
                          time. Each one knows its own court and slot, so the
                          drop needs no pointer arithmetic and does not care
                          that the rows are content-sized. */}
                      {editMode && (dragging || blockMode) &&
                        calendar.courts
                          .filter(c => c !== 'Unscheduled')
                          .map(court =>
                            Array.from({ length: day.slots }, (_, slot) => {
                              const startMin = day.startMin + slot * calendar.pitch;
                              const ci = calendar.courts.indexOf(court);
                              const key = `${day.day}|${court}|${startMin}`;
                              return (
                                <div
                                  key={`drop-${court}-${slot}`}
                                  className={[
                                    styles.calDropCell,
                                    blockMode ? styles.calDropCellBlock : '',
                                    hoverCell === key ? styles.calDropCellOver : '',
                                  ].filter(Boolean).join(' ')}
                                  style={{ gridColumn: ci + 2, gridRow: slot + 2 } as CSSProperties}
                                  title={`${court} · ${toHHMM(startMin)}`}
                                  /* The drag reads these off whatever is under the
                                     pointer, so a cell needs no handlers of its
                                     own — and the pointer path works the same for
                                     a mouse, a trackpad and a finger. */
                                  data-drop-key={key}
                                  data-drop-court={court}
                                  data-drop-day={day.day}
                                  data-drop-time={toHHMM(startMin)}
                                  onClick={() => { if (blockMode) addBlock(court, day.day, startMin); }}
                                />
                              );
                            }),
                          )}

                      {/* Court time the organizer has taken off the board. */}
                      {day.blocked.map(b => {
                        const ci = calendar.courts.indexOf(b.court);
                        if (ci < 0) return null;
                        return (
                          <button
                            key={`blk-${b.index}-${b.court}`}
                            type="button"
                            className={styles.calBlockedSlot}
                            style={{ gridColumn: ci + 2, gridRow: `${b.startSlot + 2} / span ${b.spanSlots}` } as CSSProperties}
                            onClick={() => { if (editMode) removeBlock(b.index); }}
                            disabled={!editMode}
                            title={
                              editMode
                                ? `${b.label} ${b.from}–${b.to} — click to remove`
                                : `${b.label} ${b.from}–${b.to}`
                            }
                          >
                            <span className={styles.calBlockedLabel}>{b.label}</span>
                            <span className={styles.calBlockedTime}>{b.from}–{b.to}</span>
                          </button>
                        );
                      })}

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
                        const faults = problemsByMatch.get(b.m.id) ?? [];
                        const movable = b.court !== 'Unscheduled';
                        return (
                          <div
                            key={b.m.id}
                            className={[
                              styles.gridMatchCard,
                              b.m.status === 'live' ? styles.gridMatchCardLive : '',
                              b.m.isEdited ? styles.gridMatchCardEdited : '',
                              faults.length > 0 ? styles.gridMatchCardFault : '',
                              dragging === b.m.id ? styles.gridMatchCardDragging : '',
                            ].filter(Boolean).join(' ')}
                            data-div={divIdx}
                            data-movable={editMode && movable && !blockMode ? 'true' : undefined}
                            onPointerDown={e => {
                              if (!editMode || !movable || blockMode) return;
                              if (e.pointerType === 'mouse' && e.button !== 0) return;
                              // The time is a button; let a click on it be a click.
                              if ((e.target as HTMLElement).closest('button,input,select,textarea')) return;
                              beginDrag(b.m.id, e.clientX, e.clientY);
                            }}
                            style={{
                              gridColumn: ci + 2,
                              gridRow: `${b.startSlot + 2} / span ${b.spanSlots}`,
                            } as CSSProperties}
                          >
                            {/* Buffer goes in *before* this match, so the handle
                                sits on the edge it would be inserted at. Hanging
                                off the card's top rather than living between two
                                cards means it belongs to a match you can point
                                at, and the first match on a court can have one
                                too — a late start is as real as a mid-day break. */}
                            {editMode && !blockMode && !dragging && movable && (
                              <div className={styles.cardBuffer}>
                                {insertAt?.matchId === b.m.id ? (
                                  <BufferPrompt
                                    suggested={insertAt.suggested}
                                    onCancel={() => setInsertAt(null)}
                                    onConfirm={minutes =>
                                      insertBuffer(
                                        b.court,
                                        day.day,
                                        day.startMin + b.startSlot * calendar.pitch,
                                        minutes,
                                      )
                                    }
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.cardBufferBtn}
                                    title={`Add buffer time before ${b.m.matchNo} (${b.m.time})`}
                                    aria-label={`Add buffer time before ${b.m.matchNo}`}
                                    onClick={() =>
                                      setInsertAt({
                                        matchId: b.m.id,
                                        suggested: b.m.durationMinutes || config?.blockMinutes || 45,
                                      })
                                    }
                                  >
                                    <Plus size={13} />
                                  </button>
                                )}
                              </div>
                            )}
                            <div className={styles.gridMatchTop}>
                              <div className={styles.gridMatchTimeWrap}>
                                {editingTime === b.m.id ? (
                                  <input
                                    className={styles.gridTimeInput}
                                    type="time"
                                    defaultValue={b.m.time}
                                    autoFocus
                                    onBlur={e => {
                                      const v = e.target.value;
                                      if (/^\d{2}:\d{2}$/.test(v) && v !== b.m.time) {
                                        moveMatch(b.m.id, b.m.court, b.m.day, v);
                                      }
                                      setEditingTime(null);
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                      if (e.key === 'Escape') setEditingTime(null);
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.gridMatchTime}
                                    onClick={() => { if (editMode && movable) setEditingTime(b.m.id); }}
                                    title={editMode && movable ? 'Click to set a new time' : undefined}
                                    data-editable={editMode && movable ? 'true' : undefined}
                                  >
                                    {b.m.time}
                                  </button>
                                )}
                                <span className={styles.gridMatchDot}>·</span>
                                <span className={styles.gridMatchDuration}>{b.m.durationMinutes || 45} m</span>
                              </div>
                              <span className={styles.gridMatchTags}>
                                {b.m.roundName && <span className={styles.gridMatchRound}>{b.m.roundName}</span>}
                                <span className={styles.gridMatchNo}>{b.m.matchNo}</span>
                              </span>
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
                            {faults.length > 0 && (
                              <ul className={styles.gridFaults}>
                                {faults.map((f, i) => (
                                  <li key={i}><AlertTriangle size={11} /> {f.message}</li>
                                ))}
                              </ul>
                            )}
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

      {/* The match being carried. Rendered at the page level and out of the
          pointer's way, so it can follow the cursor across day sections and
          out of the calendar's own scroll box. */}
      {draggedMatch && dragPos && (
        <div className={styles.dragGhost} style={{ left: dragPos.x, top: dragPos.y }}>
          <span className={styles.dragGhostNo}>{draggedMatch.matchNo}</span>
          <span>{draggedMatch.teamA} vs {draggedMatch.teamB}</span>
        </div>
      )}

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
                    {round.groups.map((group, gi) => (
                      <div key={group.name ?? gi} className={styles.roundGroup}>
                        {group.name && (
                          <div className={styles.poolHead}>
                            <span className={styles.poolHeadName}>{group.name}</span>
                            <span className={styles.poolHeadMeta}>
                              {group.matches.length} match{group.matches.length === 1 ? '' : 'es'}
                            </span>
                          </div>
                        )}
                        <div className={styles.roundMatches}>
                          {group.matches.map(m => (
                            <div key={m.id} className={styles.matchRow}>
                              <span className={styles.matchRowNo}>{m.no}</span>
                              <span className={styles.matchRowTeams}>
                                {m.teamA} <span className={styles.gridVsText}>vs</span> {m.teamB}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
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
