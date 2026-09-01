'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Grid,
  ImagePlus,
  MapPin,
  Minus,
  Pencil,
  Plus,
  Printer,
  Save,
  Settings,
  SlidersHorizontal,
  Table,
  Trophy,
  Utensils,
  Wand2,
  X,
} from 'lucide-react';
import { planDrop, type DropTarget, type Placement } from '@/lib/schedule/dropPlan';
import { axisLabels, buildCalendarAxis, placeOnAxis, rowKind, rowStartMin, type CalendarAxis } from '@/lib/schedule/calendarAxis';
import { courtRoster } from '@/lib/schedule/types';
import { scheduleSaveGate } from '@/lib/scheduleGate';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision, type ScheduleConfig } from '../../../../../lib/data';
import { Badge } from '../../../../../components/livebracket-ds';
import { divisionRegistrationState, isPublic, type Phase, PHASE } from '../../../../../lib/tournamentLifecycle';
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
/* Pixels per minute on the calendar's Y axis, on a screen with room to spare.
   This is what makes the grid a timeline rather than a table: every row is its
   own minutes tall, so a card spanning a 45-minute match is visibly longer than
   a 20-minute one, and a gap on court looks like the gap it is.

   The floor is set by the card, not by taste: the shortest match still has to
   fit a time, two team names and their score slots. Drop this below what that
   content needs and the shortest rows quietly stretch to fit — and a row
   stretches across *every* court, so one short match inflates that row for the
   whole venue. Re-measure it if the card's type scale changes. */
const PX_PER_MIN = 8.1;

/* What the *phone* card's content actually needs, measured rather than chosen:
   6px of padding top and bottom, a 20px top row (time, round, match number) and
   the 6px under it, and two 24px team rows — plus the 3px the card is inset
   from its row at each end. 92px, and none of it is slack.

   It is a floor in pixels rather than a scale in pixels-per-minute because on a
   phone the scale is *derived* from it — see `phonePxPerMin`. */
const PHONE_CARD_FLOOR_PX = 92;

/* The phone's pixels-per-minute, derived per tournament from the shortest match
   in it rather than fixed the way `PX_PER_MIN` is.

   `PX_PER_MIN` is one constant tuned so that a typical shortest card fits. That
   is a bet, and on a phone — where the whole problem is height — it is a bet
   that costs either legibility (too small, rows stretch) or two screens of
   scrolling (too large, every card carries slack it does not need). At 8.1 the
   phone was paying the second: a 30-minute card was drawn 237px tall around
   135px of content.

   Deriving removes the bet. The organizer never reads a pixels-per-minute
   figure; what the timeline promises them is *relative* — a 45-minute match
   reads as one and a half times a 30-minute one — and that holds at any
   absolute scale. So the scale can be pinned to the one thing that must not
   break, the card's content, and the grid is then always exactly as compact as
   its content allows. It also makes the stretching row unreachable by
   construction rather than merely unlikely.

   The cost is honest and is not clamped away: an event of short matches packs
   more play into an hour, so its day is genuinely taller. A clamp would buy
   compactness back by letting the shortest card stop fitting — reintroducing,
   rarely, exactly the failure this rule exists to make impossible, and rare
   failures are the ones nobody finds. Sub-20-minute matches are not real beach
   volleyball (a set to 21 runs about 20 minutes), so if this ever exceeds the
   desktop scale the event's durations are wrong, not the rule. Hence the warn
   rather than a `Math.min`. */
function phonePxPerMin(shortestMatchMinutes: number): number {
  const ppm = PHONE_CARD_FLOOR_PX / Math.max(1, shortestMatchMinutes);
  if (process.env.NODE_ENV !== 'production' && ppm > PX_PER_MIN) {
    console.warn(
      `[schedule] shortest match is ${shortestMatchMinutes}m, which puts the phone grid at `
      + `${ppm.toFixed(1)}px/min — taller than the desktop scale (${PX_PER_MIN}). `
      + 'Check the event\'s match durations.',
    );
  }
  return ppm;
}

/* The lunch row's collapsed height lives in the stylesheet as `--cal-lunch-h`,
   not here: like the scale, it differs on a phone, and a value set inline from
   here would out-specify the breakpoint that needs to change it. */

/* The grid's rows, written out one by one.
   They used to be a `repeat()` of one height, which they no longer are: lunch
   splits the day into two runs, so the axis has a lunch row and a scrap at the
   tail of each run that is shorter than a pitch. Anything past the axis is the
   Unscheduled tray, which is a stack rather than a timeline and gets the
   ordinary row height.

   Heights are `calc(minutes * var(--cal-px-per-min))` rather than pixels so
   this fixes the rows' *shape* and their relative proportions while leaving
   the scale a variable — which is what `06` retunes for a phone. */
function rowTemplate(axis: CalendarAxis, slots: number): string {
  const heights = Array.from({ length: slots }, (_, i) => {
    const row = axis.rows[i];
    if (!row) return 'minmax(var(--cal-slot-h), auto)';
    if (row.kind === 'lunch' && row.collapsed) return 'minmax(var(--cal-lunch-h), auto)';
    return `minmax(calc(${row.minutes} * var(--cal-px-per-min)), auto)`;
  });
  return ['auto', ...heights].join(' ');
}

/* A block that does not begin on a row boundary, drawn at the minute it really
   starts at. The rows are the frame — labels, gridlines, the lunch banner hang
   off them — but nothing obliges a match to start on one: an organizer can type
   any time, and inserting a buffer shifts a court's whole run by an arbitrary
   number of minutes. Rather than round such a match onto the nearest row and
   lie about its time, it is pushed down inside its row and given its true
   height, both at the same scale the rows themselves use.

   `undefined` when it does start on the boundary, so the ordinary case is
   rendered by the grid area alone, exactly as before.

   Both are `calc()` against `--cal-px-per-min` rather than pixels worked out
   here, because the scale is no longer one number: the phone derives its own
   (see `phonePxPerMin`) and a media query swaps it in. Multiplying in
   JavaScript would bake the desktop scale into an inline style, which no
   breakpoint can override — an off-pitch card would keep its wide-screen
   height on a phone and hang out of its row. */
function offsetStyle(offsetMinutes: number, minutes: number): CSSProperties | undefined {
  if (offsetMinutes <= 0) return undefined;
  return {
    marginTop: `calc(${offsetMinutes} * var(--cal-px-per-min))`,
    height: `calc(${minutes} * var(--cal-px-per-min))`,
  };
}

/* The digit for a court's badge. Courts are named "Court 3" by the generator,
   but an organizer can rename one, so fall back to its first character rather
   than rendering an empty circle. */
function courtNumber(court: string): string {
  const digits = court.match(/\d+/);
  return digits ? digits[0] : court.trim().charAt(0).toUpperCase();
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "HH:MM" -> minutes since midnight. Null for anything else, which includes the
// "—" an unscheduled match carries.
function fromHHMM(time: string): number | null {
  const x = /^(\d{2}):(\d{2})$/.exec(time);
  return x ? Number(x[1]) * 60 + Number(x[2]) : null;
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

/** Hand moves, keyed by match. Snapshotted when the navigator opens so that
 *  cancelling it puts every arrow press back. */
type Edits = Map<string, { court: string; day: number; time: string }>;

export default function TournamentSchedulePage() {
  const params = useParams();
  const slug = (params?.id as string) || '';

  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Controls
  const [activeDivisionId, setActiveDivisionId] = useState<string>('all');
  const [activeDay, setActiveDay] = useState<number | 'all'>('all');
  // Days of the event with nothing on them are collapsed until asked for.
  const [expandedDays, setExpandedDays] = useState<ReadonlySet<number>>(new Set());
  // Grid first: an organizer opening this page wants the whole schedule at
  // once, and drops into a single court only when they go looking for one.
  const [viewMode, setViewMode] = useState<'court' | 'grid'>('grid');
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
  const [edits, setEdits] = useState<Edits>(new Map());
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
  /** Match whose time is being typed. */
  const [editingTime, setEditingTime] = useState<string | null>(null);

  /* The navigator: the match it is open on, and the edits as they stood when it
     opened.

     Moving a match used to be a drag, and a drag is the wrong verb for this
     job. It needs a pointer, so it was never the whole story on a phone; it
     needs the destination to be on screen, which on a calendar showing one
     court at a time it often is not; and it asks the organizer to be accurate
     with a card at the moment they are least able to see where it will land.
     An arrow is none of those things. Pressing one is a whole move — the match
     goes in front of its neighbour and the schedule closes and opens around it
     — so the answer is on screen before the next press, and the ✕ puts the
     entire excursion back. */
  const [nav, setNav] = useState<{ id: string; edits: Edits; dirty: boolean } | null>(null);

  /** Something on screen differs from what is stored — a hand move, a block,
   *  or a config change — so there is something worth saving. */
  const [dirty, setDirty] = useState(false);

  const moveMatch = (matchId: string, court: string, day: number, time: string) => {
    setEdits(prev => new Map(prev).set(matchId, { court, day, time }));
    setDirty(true);
    setSaveMsg(null);
  };
  const clearEdits = () => setEdits(new Map());

  /* Picking a match up, putting it down, and changing your mind.
     `dirty` rides along with the snapshot: a cancel that left the save bar
     showing would be claiming there was something to save when there is not. */
  const pickUp = (m: ScheduleMatch) => {
    setNav(prev => (prev?.id === m.id ? null : { id: m.id, edits, dirty }));
    setEditingTime(null);
    setInsertAt(null);
  };
  const keepMove = () => setNav(null);
  const cancelMove = () => {
    if (nav) {
      setEdits(nav.edits);
      setDirty(nav.dirty);
      setSaveMsg(null);
    }
    setNav(null);
  };

  // Escape is the same as the ✕ — the move goes back and the navigator closes.
  useEffect(() => {
    if (!nav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setEdits(nav.edits);
      setDirty(nav.dirty);
      setNav(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

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
  /* Whether the placements on screen may be committed. Derived from the
     draw locks rather than tracked separately, so it cannot drift from what
     the bracket page did. Generating is untouched — a preview costs nobody
     anything — and so is the venue configuration, which is exactly what an
     organizer is testing when they generate one before the draw is settled. */
  const saveGate = useMemo(
    () => scheduleSaveGate((detail?.divisions ?? []).map(d => ({
      id: d.id,
      label: d.label,
      drawLocked: !!d.drawConfig?.isLocked,
    }))),
    [detail],
  );

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

  // Same for the generator, which is a sheet over the schedule on a phone.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

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

      // The venue configuration is saved either way; the placements are not.
      // Stopping here leaves an organizer who is still testing capacity with
      // the courts and day they typed, and without a schedule pinned to a
      // draw that can still be regenerated out from under it.
      if (!saveGate.open) {
        setDirty(false);
        setSaveMsg(
          `Courts and day settings saved. The schedule itself was not: ${saveGate.reason} ` +
          `Lock the draw in every division to save it.`,
        );
        return;
      }

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

  /* Making a gap longer or shorter, in five-minute steps.
   *
   * Same bargain as inserting one: a buffer owns the court time below it, so
   * growing it pushes that court down and shrinking it pulls it back up.
   * Blocked time that the organizer put on the board by hand is a statement
   * about the venue, not about the queue, so resizing it moves nothing. */
  const resizeBlock = (index: number, deltaMinutes: number) => {
    if (!config) return;
    const list = config.blocks ?? [];
    const block = list[index];
    if (!block) return;

    const parse = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const from = parse(block.start);
    const oldEnd = parse(block.end);
    const newEnd = Math.max(from + 5, oldEnd + deltaMinutes);
    const shift = newEnd - oldEnd;
    if (shift === 0) return;

    setConfigField('blocks', list.map((b, i) => (i === index ? { ...b, end: toHHMM(newEnd) } : b)));

    if (block.label === BUFFER_LABEL && block.court && block.day != null) {
      for (const m of allMatches) {
        if (m.day !== block.day || m.court !== block.court || m.unscheduled) continue;
        if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
        const start = parse(m.time);
        if (start < oldEnd) continue; // sits above the gap; stays put
        moveMatch(m.id, block.court, block.day, toHHMM(start + shift));
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

  /* Group matches by court, within the day they are played — and put the
     court's gaps back in among them.
     A buffer is a row in the queue, not an annotation on it: it takes court
     time exactly as a match does, and a column that showed only the matches
     would have unexplained jumps in its clock. Blocks are folded in on the
     same (day, start) key the matches sort on, so the column reads top to
     bottom as the court actually runs. */
  const courtSections = useMemo(() => {
    type CourtRow =
      | { kind: 'match'; key: string; sort: number; m: ScheduleMatch }
      | { kind: 'block'; key: string; sort: number; index: number; court: string; day: number; label: string; from: string; to: string; minutes: number };

    const sections = new Map<string, Map<string, ScheduleMatch[]>>();
    filteredMatches.forEach(m => {
      const key = splitByDay ? (m.court === 'Unscheduled' ? '' : m.date) : '';
      let courts = sections.get(key);
      if (!courts) { courts = new Map(); sections.set(key, courts); }
      const list = courts.get(m.court);
      if (list) list.push(m);
      else courts.set(m.court, [m]);
    });

    const blocks = (config?.blocks ?? []).map((b, index) => ({ b, index }));

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
          .map(([courtName, matches]) => {
            const days = new Set(matches.map(m => m.day).filter(d => d >= 0));
            const rows: CourtRow[] = matches.map(m => ({
              kind: 'match', key: m.id, sort: timeKey(m.day, m.time), m,
            }));

            if (courtName !== 'Unscheduled') {
              for (const { b, index } of blocks) {
                if (b.court != null && b.court !== courtName) continue;
                const onDays = b.day == null ? [...days] : days.has(b.day) ? [b.day] : [];
                const from = fromHHMM(b.start);
                const to = fromHHMM(b.end);
                if (from == null || to == null || to <= from) continue;
                for (const day of onDays) {
                  rows.push({
                    kind: 'block',
                    key: `blk-${index}-${day}`,
                    sort: timeKey(day, b.start),
                    index, court: courtName, day,
                    label: b.label ?? 'Blocked',
                    from: b.start, to: b.end, minutes: to - from,
                  });
                }
              }
            }

            // The court's clock: the end of whatever runs latest on it.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMatches, splitByDay, detail, dayCount, config?.blocks]);

  /* Calendar grid: courts on the X axis (columns), time on the Y axis (rows).
     One section per day; each match is a block sized by its duration and tinted
     by division.

     The axis itself lives in lib/schedule/calendarAxis.ts, and is built from the
     *configured* day and from `allMatches` — never from `filteredMatches`. That
     is the whole point of it: filtering by division changes which cards are on
     the grid, not where the grid's rows are. PX_PER_MIN turns axis minutes into
     pixels, which is what makes a row's height mean something.

     Depends on the whole `config` rather than six picked fields: the grid reads
     the day's start and end, the block size, lunch and the blocked periods, and
     recomputing this is cheap next to keeping that list honest. */
  const calendar = useMemo(() => {
    const parseMin = (t: string) => { const x = /^(\d{2}):(\d{2})$/.exec(t); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };

    /* Anything with a real date and a real time belongs on the grid — keyed
     * off the date, not off whether the day index lands inside the event's
     * declared range. A schedule saved before the organizer moved the
     * tournament's dates has negative day indices, and filtering on
     * `day >= 0` silently emptied the whole view while the By Court list
     * (which groups by the actual date) went on showing every match. */
    const scheduled = filteredMatches.filter(m => !m.unscheduled && m.date !== '' && m.time !== '—');
    const unscheduled = filteredMatches.filter(m => m.unscheduled || m.court === 'Unscheduled');

    /* Columns are the venue, in the order it is configured — not the courts
       the visible matches happen to sit on. Filtering to one division used to
       drop every court that division does not play on, which hid exactly the
       free court time this view exists to find.

       Read off `courtRoster` so the grid and the solver agree on what a court
       is. With no config loaded yet there is no roster to show, and every
       court falls through to the off-roster list below — which is the old
       behaviour, and the right one while the page is still loading. */
    const roster = config ? courtRoster(config).map(c => c.name) : [];
    const onRoster = new Set(roster);

    /* A saved schedule can name a court the venue no longer has: court names
       live on the match row, so dropping `courtCount` from 6 to 4 strands
       whatever was on Court 5. Those columns are drawn past the roster and
       marked, never quietly dropped — a stranded match is a problem to show,
       not to resolve behind the organizer's back. Read off every match rather
       than the visible ones, so a filter cannot move the frame. */
    const offRoster = [...new Set(
      allMatches
        .filter(m => !m.unscheduled && m.court && m.court !== 'Unscheduled' && !onRoster.has(m.court))
        .map(m => m.court),
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const courts = [...roster, ...offRoster];

    /* What the grid actually draws, left to right. The tray is a readout of
       what has no slot, not a court, so it is kept out of `courts` — but it is
       still a column, and a column that came and went with the filters would
       shift the grid exactly the way this ticket is stopping the courts from
       doing. So it stands whenever the *tournament* has anything unplaced, and
       filtering only empties it. */
    const hasUnscheduled = allMatches.some(m => m.unscheduled || m.court === 'Unscheduled');
    const columns = hasUnscheduled ? [...courts, 'Unscheduled'] : courts;
    const divOrder = [...new Set(filteredMatches.map(m => m.divisionLabel))];

    /* One axis for the whole calendar, read off every match in the tournament
       rather than the visible ones. Every day's rows therefore line up, and
       nothing an organizer does to the filters can move them. */
    const axis = buildCalendarAxis(
      {
        startTime: config?.startTime ?? '09:00',
        endTime: config?.endTime ?? '18:00',
        blockMinutes: config?.blockMinutes ?? DEFAULT_MATCH_MINUTES,
        /* Lunch is part of the frame, not something drawn over it: the day is
           two runs and the afternoon's rows start at `lunchEnd`. The blocks
           come along only so the axis can tell whether anything is inside the
           break — an empty lunch row collapses to a seam. */
        lunchStart: config?.lunchStart,
        lunchEnd: config?.lunchEnd,
        blocks: config?.blocks,
      },
      allMatches.flatMap(m => {
        if (m.unscheduled) return [];
        const s = parseMin(m.time);
        return s == null ? [] : [{ startMin: s, durationMinutes: m.durationMinutes }];
      }),
    );
    const labels = axisLabels(axis);

    /* The shortest match in the tournament, which is what the phone's scale is
       derived from — see `phonePxPerMin`. Read off `allMatches` for the same
       reason the axis is: the scale is a property of the event, and a division
       filter that hid the short matches would otherwise re-scale the whole grid
       under the organizer while they were only trying to look at one division.
       Falls back to the configured block length while the page is still
       loading and there is nothing to measure. */
    const shortestMinutes = allMatches.reduce(
      (min, m) => (m.durationMinutes > 0 ? Math.min(min, m.durationMinutes) : min),
      config?.blockMinutes ?? DEFAULT_MATCH_MINUTES,
    );

    /* The lunch banner *is* a row now, rather than a card floating over rows
       that pretend the break is not there — so it needs no placement, only the
       row's index, and it is the same row on every day. It fills its row, which
       is a seam while nothing is inside the break and the true hour once
       something is. */
    const lunchSlot = axis.rows.findIndex(r => r.kind === 'lunch');
    const lunchRow = lunchSlot < 0 ? null : axis.rows[lunchSlot];
    const lunchBlock = lunchRow == null ? null : {
      startSlot: lunchSlot,
      text: `Lunch Break (${toHHMM(lunchRow.startMin)} – ${toHHMM(lunchRow.startMin + lunchRow.minutes)})`,
    };

    type Item = { m: ScheduleMatch; startMin: number; dur: number };
    const itemsByDay = new Map<number, Item[]>();
    for (const m of scheduled) {
      const s = parseMin(m.time);
      if (s == null) continue;
      const dur = Math.max(5, Math.trunc(m.durationMinutes) || 45);
      const list = itemsByDay.get(m.day);
      if (list) list.push({ m, startMin: s, dur });
      else itemsByDay.set(m.day, [{ m, startMin: s, dur }]);
    }

    /* Day sections are the event's days for the same reason the columns are
       the venue's courts: a three-day event has a third day whether or not
       anything is scheduled on it, and a division filter must not be able to
       make a day disappear. Days outside the event's range are added on top
       rather than dropped — a schedule saved before the organizer moved the
       dates points at real dates, and hiding it is the defect `02` fixed for
       the time axis. Choosing a day in the filter bar is different: that is
       picking which frame to look at, so it does narrow the sections. */
    const dayNumbers = new Set<number>();
    for (let i = 0; i < dayCount; i += 1) dayNumbers.add(i);
    for (const m of allMatches) {
      if (!m.unscheduled && m.date !== '' && m.time !== '—') dayNumbers.add(m.day);
    }
    const dayList = [...dayNumbers]
      .filter(d => activeDay === 'all' || d === activeDay)
      .sort((a, b) => a - b)
      .map(day => ({
        day,
        // Computed from the event's start rather than read off a match, so a
        // day with nothing on it still knows what date it is.
        dateLabel: detail?.startDate ? shortDate(addDaysUTC(detail.startDate, day)) : '',
        items: itemsByDay.get(day) ?? [],
      }));

    const days = dayList.map((d, dIdx) => {
      // Stack unscheduled matches in the 'Unscheduled' column
      const unscheduledBlocks: { m: ScheduleMatch; court: string; startSlot: number; spanSlots: number; offsetMinutes: number; minutes: number }[] = [];
      if (unscheduled.length > 0) {
        let currentSlot = 0;
        unscheduled.forEach((u) => {
          const spanSlots = Math.max(1, Math.round((u.durationMinutes || 45) / axis.pitch));
          unscheduledBlocks.push({
            m: u,
            court: 'Unscheduled',
            startSlot: currentSlot,
            spanSlots,
            offsetMinutes: 0,
            minutes: spanSlots * axis.pitch,
          });
          currentSlot += spanSlots;
        });
      }

      /* The axis sets the height of the day. The one thing allowed to make it
         taller is the Unscheduled column, which is a stack rather than a
         timeline and can be longer than the day it sits beside. */
      const maxUnscheduledSlot = unscheduledBlocks.reduce((max, b) => Math.max(max, b.startSlot + b.spanSlots), 0);
      const slots = Math.max(axis.slots, maxUnscheduledSlot);

      const blocks = [
        ...d.items.map(i => ({ m: i.m, court: i.m.court, minutes: i.dur, ...placeOnAxis(axis, i.startMin, i.dur) })),
        ...(dIdx === 0 ? unscheduledBlocks : []),
      ];

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
          const placed = placeOnAxis(axis, from, to - from);
          if (placed.startSlot + placed.spanSlots <= 0 || placed.startSlot >= slots) return [];
          // A block with no court named is the whole venue — which an
          // off-roster court is not part of. One that names a court still
          // paints on it, wherever it is.
          const names = b.court == null ? roster : [b.court];
          return names.map(court => ({ index, court, ...placed, minutes: to - from, label: b.label ?? 'Blocked', from: b.start, to: b.end }));
        });

      /* Nothing on the board at all — no cards, no blocked time. The day is
         still the event's, so it is still shown; it is just not worth a
         full-height grid until someone asks. */
      const isEmpty = blocks.length === 0 && blocked.length === 0;

      return { day: d.day, dateLabel: d.dateLabel, slots, blocks, lunchBlock, blocked, isEmpty };
    });

    return { roster, offRoster, columns, hasUnscheduled, days, axis, labels, shortestMinutes, divOrder, unscheduledCount: unscheduled.length };
  }, [filteredMatches, allMatches, config, dayCount, activeDay, detail]);

  /* Applying a move: turn what is on screen into placements, ask the planner
     what has to shift, and write the answer back as hand edits. The rules live
     in lib/schedule/dropPlan.ts, where they can be reasoned about on their own
     — which is why losing the drag cost nothing: the arrows ask the same
     planner the same question. */
  const dropMatch = (matchId: string, court: string, day: number, target: DropTarget) => {
    const placements: Placement[] = allMatches.map(m => ({
      id: m.id,
      court: m.court,
      day: m.day,
      start: m.unscheduled ? null : fromHHMM(m.time),
      durationMinutes: m.durationMinutes,
    }));
    /* What time an empty court starts at. The configured opening — not the
       first match on screen, which is where this used to read it and which made
       a drop onto an empty court land differently depending on the filters. */
    const dayStart = fromHHMM(config?.startTime ?? '') ?? calendar.axis.startMin;

    const plan = planDrop(placements, matchId, court, day, target, dayStart);
    if (plan.length === 0) return;

    setEdits(prev => {
      const next = new Map(prev);
      for (const move of plan) next.set(move.id, { court: move.court, day: move.day, time: toHHMM(move.start) });
      return next;
    });
    setDirty(true);
    setSaveMsg(null);
  };

  /* The navigator: an insertion at a time.
   *
   * Up and down walk the queue on the match's own court — each press puts it in
   * front of its neighbour, which is a swap when the two are the same length
   * and the right answer when they are not. Left and right cross to the next
   * court and keep the hour the match already had, slotting in before the first
   * match there that starts at or after it, because a match moved sideways is
   * being moved to another court, not to another time of day. */
  /* The arrows travel the roster and nothing else: widening the columns to the
     configured venue must not turn the off-roster strays into places a match
     can be *put*. A match already stranded on one can still step left into the
     venue, which makes the arrows the way back out of exactly the mess the
     off-roster columns expose. */
  const courtOrder = calendar.roster;

  const runOnCourt = (court: string, day: number) =>
    allMatches
      .filter(m => m.court === court && m.day === day && !m.unscheduled && fromHHMM(m.time) != null)
      .sort((a, b) => (fromHHMM(a.time) ?? 0) - (fromHHMM(b.time) ?? 0));

  type NavDir = 'up' | 'down' | 'left' | 'right';

  /** Which way this match can go from where it is. */
  const navOptions = (m: ScheduleMatch) => {
    const run = runOnCourt(m.court, m.day);
    const i = run.findIndex(x => x.id === m.id);
    const ci = courtOrder.indexOf(m.court);
    // Off the roster: the only way is back in, and the venue sits to the left.
    const stranded = ci < 0;
    return {
      up: i > 0,
      down: i >= 0 && i < run.length - 1,
      left: stranded ? courtOrder.length > 0 : ci > 0,
      right: !stranded && ci < courtOrder.length - 1,
    };
  };

  const navMove = (m: ScheduleMatch, dir: NavDir) => {
    const run = runOnCourt(m.court, m.day);
    const i = run.findIndex(x => x.id === m.id);
    if (i < 0) return;

    if (dir === 'up') {
      const before = run[i - 1];
      if (before) dropMatch(m.id, m.court, m.day, { beforeId: before.id });
      return;
    }
    if (dir === 'down') {
      if (i >= run.length - 1) return;
      // Past the next match means in front of the one after it — or, if the
      // next match is the last, onto the end of the court.
      const after = run[i + 2];
      dropMatch(m.id, m.court, m.day, after ? { beforeId: after.id } : { append: true });
      return;
    }

    const ci = courtOrder.indexOf(m.court);
    const court = ci < 0
      // Stranded on a court the venue no longer has. The strays are drawn past
      // the roster, so 'left' means back onto the last real court.
      ? (dir === 'left' ? courtOrder[courtOrder.length - 1] : undefined)
      : courtOrder[dir === 'left' ? ci - 1 : ci + 1];
    if (!court) return;
    const start = fromHHMM(m.time) ?? 0;
    const landing = runOnCourt(court, m.day).find(x => (fromHHMM(x.time) ?? 0) >= start);
    dropMatch(m.id, court, m.day, landing ? { beforeId: landing.id } : { append: true });
  };

  /* The navigator itself, drawn over the card it is moving.
     It covers the card rather than sitting beside it because the card is the
     only place on screen that is certainly near the match, in both views and at
     every width — and because frosting the card out makes it obvious which of
     the fifty on screen is the one currently in hand. */
  const navigator = (m: ScheduleMatch) => {
    const can = navOptions(m);
    const go = (dir: NavDir) => (e: ReactMouseEvent) => { e.stopPropagation(); navMove(m, dir); };
    return (
      <div className={styles.navOverlay} onClick={e => e.stopPropagation()}>
        <div className={styles.navBar}>
          <button
            type="button"
            className={styles.navCancel}
            onClick={e => { e.stopPropagation(); cancelMove(); }}
            title="Cancel — put it back where it was"
            aria-label="Cancel move"
          >
            <X size={14} />
          </button>
          <div className={styles.navPad}>
            <button type="button" className={styles.navLeft} onClick={go('left')} disabled={!can.left} title="Previous court" aria-label="Move to the court on the left">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className={styles.navUp} onClick={go('up')} disabled={!can.up} title="Earlier slot" aria-label="Move one slot earlier">
              <ChevronUp size={16} />
            </button>
            <button type="button" className={styles.navDown} onClick={go('down')} disabled={!can.down} title="Later slot" aria-label="Move one slot later">
              <ChevronDown size={16} />
            </button>
            <button type="button" className={styles.navRight} onClick={go('right')} disabled={!can.right} title="Next court" aria-label="Move to the court on the right">
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            className={styles.navSave}
            onClick={e => { e.stopPropagation(); keepMove(); }}
            title="Keep this position"
            aria-label="Keep this position"
          >
            <Check size={15} />
          </button>
        </div>
      </div>
    );
  };

  /* A gap in a court's run, as the design draws it: hatched, obviously not a
     match, and carrying its own length. In edit mode it can be stretched,
     shrunk or taken out; the rest of the time it just says what it is. */
  const gapStrip = (
    b: { index: number; label: string; from: string; to: string; minutes: number },
    className?: string,
  ) => (
    <div className={[styles.gapStrip, className].filter(Boolean).join(' ')} title={`${b.label} ${b.from}–${b.to}`}>
      <div className={styles.gapText}>
        <span className={styles.gapLabel}>{b.label}</span>
        <span className={styles.gapMinutes}>{b.minutes} m</span>
      </div>
      {editMode && (
        <div className={styles.gapControls}>
          <button type="button" onClick={() => resizeBlock(b.index, -5)} title="Five minutes shorter" aria-label={`Shorten ${b.label}`}>
            <Minus size={12} />
          </button>
          <button type="button" onClick={() => resizeBlock(b.index, 5)} title="Five minutes longer" aria-label={`Lengthen ${b.label}`}>
            <Plus size={12} />
          </button>
          <button type="button" onClick={() => removeBlock(b.index)} title={`Remove this ${b.label.toLowerCase()}`} aria-label={`Remove ${b.label}`}>
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );

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

  const isLive = allMatches.some(m => m.status === 'live');

  /* The same badge the Bracket Generator header shows, so one tournament
     reads the same on both screens. Registration state belongs to a
     division, so it follows the selected one and falls back to the first
     while "All Divisions" is active. */
  const badgeDivision =
    detail?.divisions.find(d => d.id === activeDivisionId) ?? detail?.divisions[0] ?? null;

  const statusBadge = ((): { label: string; variant: 'live' | 'open' | 'highlight' | 'status' | 'outline' } => {
    if (!detail || detail.phase === PHASE.draft || !isPublic(detail.phase as Phase)) {
      return { label: 'Draft', variant: 'status' };
    }
    if (detail.phase === 3 || isLive) return { label: 'Live', variant: 'live' };
    if (detail.phase === 4) return { label: 'Completed', variant: 'status' };
    if (!badgeDivision) return { label: 'Announced', variant: 'highlight' };
    const regState = divisionRegistrationState(
      {
        registrationOpens: badgeDivision.registrationOpens || '',
        registrationCloses: badgeDivision.registrationCloses || '',
      },
      new Date(),
    );
    if (regState === 'opens-soon') return { label: 'Announced', variant: 'highlight' };
    if (regState === 'closed') return { label: 'Registration Closed', variant: 'status' };
    if (badgeDivision.teams > 0 && badgeDivision.filled >= badgeDivision.teams) {
      return { label: 'Waitlist Open', variant: 'highlight' };
    }
    return { label: 'Registration Open', variant: 'open' };
  })();

  /* Editing belongs to the schedule, not to one way of looking at it, so the
     switch and the state of the edits ride along with both views. */
  const editToggle = (
    <button
      type="button"
      className={`${styles.gridEditBtn} ${editMode ? styles.gridEditBtnOn : ''}`}
      onClick={() => {
        setEditMode(v => !v);
        setBlockMode(false);
        setEditingTime(null);
        setInsertAt(null);
        // Locking the schedule takes the arrows away with it. The move itself
        // stands — it is the edit bar's to undo, not the navigator's.
        setNav(null);
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
  );

  /* Why the schedule cannot be saved, and where to go about it. Shown
     beside the Save button rather than hidden in a disabled button's
     tooltip: a dead control with no reason is worse than no gate, and the
     lock lives on another page, so the reason has to carry the route. */
  const gateNotice = !saveGate.open && (
    <span className={styles.gateNotice}>
      <AlertTriangle size={13} />
      {saveGate.reason}{' '}
      <Link href={`/dashboard/tournament/${slug}`} className={styles.gateNoticeLink}>
        Lock {saveGate.unlocked.length === 1 ? 'it' : 'them'} on the bracket page
      </Link>
    </span>
  );

  const editBar = (edits.size > 0 || problems.length > 0 || (!preview && dirty)) && (
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
        {gateNotice}
        {!preview && dirty && (
          <button type="button" className={styles.previewSave} onClick={handleSave} disabled={saving}>
            <Save size={14} />{' '}
            {saving ? 'Saving…' : saveGate.open ? 'Save changes' : 'Save settings'}
          </button>
        )}
      </span>
    </div>
  );

  /** A match the organizer can pick up: only in edit mode, only once it has a
   *  court and a time to be moved away from, and never while the block tool is
   *  armed and a press means "take this slot off the board". */
  const canMove = (m: ScheduleMatch) => editMode && !blockMode && !m.unscheduled && m.court !== 'Unscheduled';

  /* One heading for both views: a coral eyebrow saying which event and which
     slice of it you are looking at, the view's own name under it, and the
     editing tools and division key on the right. */
  /* No eyebrow: the tournament name, location and court count are all in
     the page header a few rows up, so repeating them here was noise. */
  const scheduleHeader = (title: string, tools?: ReactNode) => (
    <div className={styles.gridHeaderRow}>
      <div className={styles.gridHeaderLeft}>
        <div>
          <h2 className={styles.gridHeaderTitle}>{title}</h2>
        </div>
      </div>
      <div className={styles.gridHeaderRight}>
        {editToggle}
        {tools}
        {calendar.divOrder.map(label => (
          <span key={label} className={styles.calLegendItem}>
            <span className={styles.calSwatch} data-div={divColorIndex.get(label) ?? 0} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );

  /** How the two views say the same thing about editing. */
  const editHint = !editMode ? (
    <>The schedule is locked. Press <strong>Edit schedule</strong> to move matches, retime them, or add buffer time.</>
  ) : (
    <>
      Click a match to pick it up, then walk it with the arrows: <strong>↑</strong> and <strong>↓</strong> along its own
      court, <strong>←</strong> and <strong>→</strong>{' '}
      onto the next one. It goes in front of whatever it moves towards — everything below that moves down by the
      match&apos;s length, and the court it left closes up behind it. Keep the move with the tick, or drop it with the ✕
      and it goes back exactly as it was. Click a time to type a new one, or the <strong>+</strong>{' '}
      on a card&apos;s top edge to open a gap before it. Hand moves are yours alone: the next Generate starts again from
      the solver. Buffers and blocked time are part of the venue, so they survive it.
    </>
  );

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

      {/* ── Header ────────────────────────────────────────────────
           Eyebrow and page title on left, Bracket action on right,
           then the event card with Generate Schedule and Print Schedule buttons. */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.headerTitleRow}>
            {/* Phone-only twin of the fixed back link. The Bracket Generator
                seats it inline beside the title instead of floating it over
                the hero, which lets the header start at the top of the page
                rather than reserving a band of padding to clear it. */}
            <Link href="/dashboard" className={styles.mobileBackBtn} aria-label="Back to Dashboard">
              <ArrowLeft size={18} />
            </Link>
            <div className={styles.headerTitleBlock}>
              <p className={styles.headerEyebrow}>ORGANIZER</p>
              <h1 className={styles.heroTitle}>Schedule Generator</h1>
            </div>
            <div className={styles.headerActions}>
              <Link href={`/dashboard/tournament/${slug}`} className={styles.heroGhostBtn}>
                <Trophy size={16} /> Bracket
              </Link>
            </div>
          </div>

          <div className={styles.eventCard}>
            <div className={styles.eventCardBody}>
              {detail?.imageUrl ? (
                <img src={detail.imageUrl} alt="" className={styles.eventPoster} />
              ) : (
                <div className={styles.eventPosterPlaceholder}>
                  <ImagePlus size={28} opacity={0.6} />
                </div>
              )}

              <div className={styles.eventTextCol}>
                <div className={styles.eventBadgeRow}>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>
                <h2 className={styles.eventTitle}>{detail?.title ?? 'Untitled tournament'}</h2>
                <div className={styles.eventMetaCol}>
                  {detail?.date && (
                    <div className={styles.eventMetaItem}><Calendar size={16} /><span>{detail.date}</span></div>
                  )}
                  {detail?.location && (
                    <div className={styles.eventMetaItem}><MapPin size={16} /><span>{detail.location}</span></div>
                  )}
                </div>
              </div>

              <div className={styles.eventCardActions}>
                <button
                  type="button"
                  className={styles.heroPrimaryBtn}
                  onClick={() => setPanelOpen(o => !o)}
                >
                  <Wand2 size={16} /> Generate Schedule
                </button>
                <button
                  type="button"
                  className={`${styles.heroGhostBtn} ${styles.printBtn}`}
                  onClick={() => window.print()}
                >
                  <Printer size={16} /> Print Schedule
                </button>
                {/* Phone-only, in the slot Print Schedule gives up: the header's
                    Bracket action is hidden at this width and Setup has no home
                    on this page at all, while printing is a desk job. */}
                <Link
                  href={`/dashboard/tournament/${slug}`}
                  className={styles.cardNavBtn}
                  aria-label="Bracket"
                  title="Bracket"
                >
                  <Trophy size={16} />
                </Link>
                <Link
                  href={`/dashboard/tournament/${slug}/setup`}
                  className={styles.cardNavBtn}
                  aria-label="Tournament setup"
                  title="Tournament setup"
                >
                  <Settings size={16} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sticky Control Bar ───────────────────────────────── */}
      <div className={styles.stickyBar} ref={stickyRef}>
        <div className={styles.stickyInner}>
          {/* What you are looking at: division, day, status. The view
              control lives apart from these on the right — it changes how
              the same matches are drawn, it does not filter them. */}
          <div className={styles.filterGroup}>
            {/* Division — a dropdown at every width. A division list grows
                with the event, and pills for six of them outran the row. */}
            <div className={`${styles.selectWrap} ${styles.divisionSelectWrap}`}>
              <select
                className={styles.select}
                aria-label="Filter by division"
                value={activeDivisionId}
                onChange={e => setActiveDivisionId(e.target.value)}
              >
                <option value="all">Divisions</option>
                {detail?.divisions.map(d => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className={styles.selectChevron} />
            </div>

            {/* Day Selector (multi-day tournaments only) */}
            {dayCount > 1 && (
              <>
                <span className={styles.filterDivider} aria-hidden="true" />
                <div className={`${styles.segmented} ${styles.daySegmented}`}>
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
                      <span className={styles.dayPillNum}>Day {i + 1}</span>
                      {/* The ordinal is what you pick; the date is what
                          confirms the pick. Sized and weighted apart so the
                          eye lands on "Day 2" and reads the date second. */}
                      <span className={styles.dayPillDate}>
                        {detail ? shortDate(addDaysUTC(detail.startDate, i)) : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Status Filter */}
            <div className={`${styles.selectWrap} ${styles.statusSelectWrap}`}>
              <select
                className={styles.select}
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | 'live' | 'upcoming' | 'done')}
              >
                <option value="all">All matches</option>
                <option value="live">Live Matches</option>
                <option value="upcoming">Upcoming Matches</option>
                <option value="done">Completed Matches</option>
              </select>
              <ChevronDown size={14} className={styles.selectChevron} />
            </div>
          </div>

          {/* View Mode — how the matches are drawn, not which ones */}
          <div className={styles.controlsGroup}>
            {/* Two segments on a wide screen. */}
            <div className={styles.segmented} role="group" aria-label="View mode">
              <button
                type="button"
                className={`${styles.segBtn} ${viewMode === 'court' ? styles.segBtnActive : ''}`}
                onClick={() => setViewMode('court')}
                aria-pressed={viewMode === 'court'}
              >
                <Grid size={14} className={styles.segBtnIcon} />
                By Court
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${viewMode === 'grid' ? styles.segBtnActive : ''}`}
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
              >
                <Table size={14} className={styles.segBtnIcon} />
                Grid
              </button>
            </div>
            {/* On a phone the same choice is one button, because grid is the
                resting state: press it to drop into a single court, and it
                goes orange to say that is where you are. */}
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === 'court' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode(viewMode === 'court' ? 'grid' : 'court')}
              aria-pressed={viewMode === 'court'}
            >
              <Grid size={14} className={styles.viewToggleIcon} />
              View by Court
            </button>
          </div>
        </div>
      </div>

      {/* ── Generator Panel ─────────────────────────────────── */}
      {panelOpen && config && (
        <div
          className={styles.genPanel}
          role="presentation"
          onClick={e => {
            // Only a tap on the backdrop closes it, and only where there is
            // one: on a wide screen this element is an inline band whose
            // gutters are not a dismiss target.
            if (e.target !== e.currentTarget) return;
            if (window.matchMedia('(max-width: 860px)').matches) setPanelOpen(false);
          }}
        >
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
              {gateNotice}
              <button type="button" className={styles.previewDiscard} onClick={() => setPreview(null)} disabled={saving}>
                Discard
              </button>
              <button type="button" className={styles.previewSave} onClick={handleSave} disabled={saving}>
                <Save size={15} />{' '}
                {saving ? 'Saving…' : saveGate.open ? 'Save Schedule' : 'Save settings'}
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
            {scheduleHeader('Court Schedule')}

            {editBar}

            <p className={`${styles.hintBanner} ${editMode ? styles.hintBannerOn : ''}`}>{editHint}</p>

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
                    {group.rows.map(row => {
                      if (row.kind === 'block') return <div key={row.key}>{gapStrip(row)}</div>;

                      const m = row.m;
                      const movable = canMove(m);
                      const picked = nav?.id === m.id;
                      const faults = problemsByMatch.get(m.id) ?? [];
                      return (
                        <div
                          key={m.id}
                          className={[
                            styles.matchItem,
                            m.status === 'live' ? styles.matchItemLive : '',
                            m.isPreview ? styles.matchItemPreview : '',
                            m.unscheduled ? styles.matchItemUnscheduled : '',
                            m.overScheduled ? styles.matchItemOverflow : '',
                            m.isEdited ? styles.matchItemEdited : '',
                            faults.length > 0 ? styles.matchItemFault : '',
                            picked ? styles.matchItemPicked : '',
                          ].filter(Boolean).join(' ')}
                          data-div={divColorIndex.get(m.divisionLabel) ?? 0}
                          data-pickable={movable ? 'true' : undefined}
                          onClick={e => {
                            if (!movable) return;
                            if ((e.target as HTMLElement).closest('button,input,select,textarea')) return;
                            pickUp(m);
                          }}
                        >
                          {picked && movable && navigator(m)}

                          {/* The buffer handle hangs off the edge the gap would
                              go in at, so the first match on a court can have
                              one too — a late start is as real as a mid-day
                              break. */}
                          {editMode && !blockMode && !picked && movable && (
                            <div className={styles.cardBuffer}>
                              {insertAt?.matchId === m.id ? (
                                <BufferPrompt
                                  suggested={insertAt.suggested}
                                  onCancel={() => setInsertAt(null)}
                                  onConfirm={minutes => {
                                    const at = fromHHMM(m.time);
                                    if (at != null) insertBuffer(m.court, m.day, at, minutes);
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className={styles.cardBufferBtn}
                                  title={`Add buffer time before ${m.matchNo} (${m.time})`}
                                  aria-label={`Add buffer time before ${m.matchNo}`}
                                  onClick={() =>
                                    setInsertAt({
                                      matchId: m.id,
                                      suggested: m.durationMinutes || config?.blockMinutes || 45,
                                    })
                                  }
                                >
                                  <Plus size={13} />
                                </button>
                              )}
                            </div>
                          )}

                          <div className={styles.matchItemTop}>
                            <span className={styles.matchTime}>
                              {m.overScheduled ? (
                                <><AlertTriangle size={13} /> Over-scheduled · {m.matchNo}</>
                              ) : editingTime === m.id ? (
                                <input
                                  className={styles.gridTimeInput}
                                  type="time"
                                  defaultValue={m.time}
                                  autoFocus
                                  onBlur={e => {
                                    const v = e.target.value;
                                    if (/^\d{2}:\d{2}$/.test(v) && v !== m.time) moveMatch(m.id, m.court, m.day, v);
                                    setEditingTime(null);
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                    if (e.key === 'Escape') setEditingTime(null);
                                  }}
                                />
                              ) : (
                                <>
                                  <Clock size={13} />
                                  {/* The block heading already says the date. */}
                                  {!splitByDay && dayCount > 1 && m.dateLabel ? `${m.dateLabel} · ` : ''}
                                  <button
                                    type="button"
                                    className={styles.matchTimeBtn}
                                    onClick={() => { if (movable) setEditingTime(m.id); }}
                                    title={movable ? 'Click to set a new time' : undefined}
                                    data-editable={movable ? 'true' : undefined}
                                  >
                                    {m.time}
                                  </button>
                                  <span className={styles.matchDuration}>{m.durationMinutes || 45} m</span>
                                </>
                              )}
                            </span>
                            {/* Round, then the match number in its division's
                                colour — the same chip the calendar uses, so a
                                division is one colour wherever you meet it and
                                the card needs no second badge to say so. */}
                            <span className={styles.badgeGroup}>
                              {m.roundName && <span className={styles.roundBadge}>{m.roundName}</span>}
                              <span className={styles.gridMatchNo} title={m.divisionLabel}>{m.matchNo}</span>
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
                          {faults.length > 0 && (
                            <ul className={styles.gridFaults}>
                              {faults.map((f, fi) => (
                                <li key={fi}><AlertTriangle size={11} /> {f.message}</li>
                              ))}
                            </ul>
                          )}
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
            </section>
            ))}
          </div>
        ) : (
          <div>
            {scheduleHeader(
              'Court Schedule',
              editMode ? (
                <button
                  type="button"
                  className={`${styles.gridToolBtn} ${blockMode ? styles.gridToolBtnOn : ''}`}
                  onClick={() => { setBlockMode(v => !v); setEditingTime(null); setNav(null); }}
                  title="Click any empty slot to take that court time off the board"
                >
                  <Ban size={13} /> {blockMode ? 'Click a slot to block' : 'Block time'}
                </button>
              ) : null,
            )}

            {editBar}

            <p className={`${styles.hintBanner} ${editMode ? styles.hintBannerOn : ''}`}>{editHint}</p>

            {calendar.columns.length === 0 ? (
              <p className={styles.gridNote}>No scheduled matches to show. Generate and save a schedule first.</p>
            ) : (
              calendar.days.map(day => (day.isEmpty && !expandedDays.has(day.day)) ? (
                /* A day the event has, with nothing on it. It stays on the
                   page — an organizer needs to see that Day 3 exists and is
                   empty — but a full-height grid of nothing is the same
                   vertical cost `06` is trying to win back, so it collapses to
                   a strip that opens on a tap. */
                <div key={day.day} className={styles.calDaySection}>
                  <button
                    type="button"
                    className={styles.calEmptyDay}
                    onClick={() => setExpandedDays(prev => new Set(prev).add(day.day))}
                  >
                    <span className={styles.calEmptyDayName}>
                      {day.day >= 0 && day.day < dayCount ? `Day ${day.day + 1}` : 'Outside the event'}
                      {day.dateLabel ? ` · ${day.dateLabel}` : ''}
                    </span>
                    <span className={styles.calEmptyDayNote}>Nothing scheduled</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div key={day.day} className={styles.calDaySection}>
                  {dayCount > 1 && day.dateLabel && <div className={styles.calDayHeading}>{day.dateLabel}</div>}
                  <div className={styles.calScroll}>
                    <div
                      className={styles.calGrid}
                      style={{
                        '--cal-courts': calendar.columns.length,
                        '--cal-rows': day.slots,
                        /* Rows are minutes made visible — see PX_PER_MIN. Both
                           scales are handed over as data and the stylesheet
                           chooses between them at its breakpoint; `.calGrid`
                           reads one into `--cal-px-per-min` and everything else
                           (row heights, `--cal-slot-h`, an off-pitch card's
                           offset) is a calc against that. Setting the live
                           scale here instead would win on specificity and no
                           media query could ever retune it. */
                        '--cal-ppm-wide': `${PX_PER_MIN}px`,
                        '--cal-ppm-phone': `${phonePxPerMin(calendar.shortestMinutes).toFixed(2)}px`,
                        '--cal-pitch': calendar.axis.pitch,
                        /* Written out row by row rather than repeated, because
                           the rows stopped being uniform when the day became
                           two runs: lunch is its own row and each run leaves a
                           scrap at its tail. Every height is a multiple of
                           `--cal-px-per-min`, so the *shape* is fixed here and
                           the *scale* stays a variable anyone can retune. */
                        gridTemplateRows: rowTemplate(calendar.axis, day.slots),
                      } as CSSProperties}
                    >
                      {/* Top-left corner: which day this grid is, and how much
                          of the event sits under it. */}
                      <div className={styles.calCorner} style={{ gridColumn: 1, gridRow: 1 } as CSSProperties}>
                        {/* Only a day *of the event* gets a number. A schedule
                            still sitting on dates the organizer has since moved
                            away from is shown by its date alone, the same way
                            the By Court headings read it. */}
                        {day.day >= 0 && day.day < dayCount && (
                          <span className={styles.calCornerDay}>Day {day.day + 1}</span>
                        )}
                        {day.dateLabel && (
                          <>
                            <span className={styles.calCornerWeekday}>{day.dateLabel.split(',')[0]}</span>
                            <span className={styles.calCornerDate}>
                              {day.dateLabel.split(',').slice(1).join(',').trim() || day.dateLabel}
                            </span>
                          </>
                        )}
                        <span className={styles.calCornerCount}>{day.blocks.length} matches</span>
                      </div>

                      {/* Top Sticky Court Headers */}
                      {calendar.columns.map((court, ci) => {
                        const onCourt = filteredMatches.filter(m => m.court === court);
                        const played = onCourt.filter(m => m.status === 'done').length;
                        const pct = onCourt.length > 0 ? Math.round((played / onCourt.length) * 100) : 0;
                        // A column holding matches on a court the venue no
                        // longer has. Named plainly rather than styled into a
                        // warning: it is a fact about the schedule, and the
                        // organizer fixes it by moving the matches left.
                        const stranded = calendar.offRoster.includes(court);
                        return (
                          <div key={court} className={styles.calCourtHead} style={{ gridColumn: ci + 2, gridRow: 1 } as CSSProperties}>
                            <div className={`${styles.calCourtHeadCard} ${stranded ? styles.calCourtHeadOff : ''}`}>
                              <div className={styles.calCourtHeadTop}>
                                <span className={styles.calCourtBadge}>{courtNumber(court)}</span>
                                <span className={styles.calCourtName}>{court}</span>
                              </div>
                              <div className={styles.calCourtHeadBottom}>
                                {stranded ? (
                                  <span className={styles.calCourtOffNote} title={`${court} is not one of this venue's courts. Move these matches onto a court that is.`}>
                                    Not on this venue · {onCourt.length} match{onCourt.length === 1 ? '' : 'es'}
                                  </span>
                                ) : (
                                  <>
                                    <span className={styles.calCourtProgress}>
                                      <span className={styles.calCourtProgressFill} style={{ width: `${pct}%` }} />
                                    </span>
                                    <span className={styles.calCourtPlayed}>
                                      {played}/{onCourt.length} played
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
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

                      {/* Y-axis Left Sticky Time Labels. Hours are set in the
                          display face with a rule and a dot; match starts in
                          between are quieter, so the hour still reads as the
                          anchor. */}
                      {calendar.labels.map(l => (
                        <div
                          key={`t${l.slot}`}
                          className={`${styles.calTimeLabelCell} ${l.isHour ? styles.calTimeHour : styles.calTimeMinor}`}
                          style={{ gridColumn: 1, gridRow: l.slot + 2 } as CSSProperties}
                        >
                          <span className={styles.calTimeText}>{l.time}</span>
                          <span className={styles.calTimeRule} aria-hidden="true" />
                          {l.isHour && <span className={styles.calTimeDot} aria-hidden="true" />}
                        </div>
                      ))}

                      {/* Horizontal Gridlines */}
                      {calendar.labels.map(l => (
                        <div key={`ln${l.slot}`} className={styles.calGridLine} style={{ gridColumn: `2 / ${calendar.columns.length + 2}`, gridRow: l.slot + 2 } as CSSProperties} />
                      ))}

                      {/* Slots to click while the block tool is armed. A cell
                          per court per row is hundreds of nodes, and they are
                          worth nothing the rest of the time — so they are only
                          mounted once a press actually means something. */}
                      {editMode && blockMode &&
                        calendar.roster
                          .map(court =>
                            Array.from({ length: day.slots }, (_, slot) => {
                              /* Lunch already takes this time off the board on
                                 every court, so there is nothing to block. It
                                 used to offer one anyway, labelled 12:45 —
                                 the ladder's row time, not the day's. */
                              if (rowKind(calendar.axis, slot) === 'lunch') return null;
                              const startMin = rowStartMin(calendar.axis, slot);
                              const ci = calendar.columns.indexOf(court);
                              return (
                                <div
                                  key={`drop-${court}-${slot}`}
                                  className={`${styles.calDropCell} ${styles.calDropCellBlock}`}
                                  style={{ gridColumn: ci + 2, gridRow: slot + 2 } as CSSProperties}
                                  title={`${court} · ${toHHMM(startMin)}`}
                                  onClick={() => addBlock(court, day.day, startMin)}
                                />
                              );
                            }),
                          )}

                      {/* Court time the organizer has taken off the board. */}
                      {day.blocked.map(b => {
                        const ci = calendar.columns.indexOf(b.court);
                        if (ci < 0) return null;
                        return (
                          <div
                            key={`blk-${b.index}-${b.court}`}
                            className={styles.calBlockedSlot}
                            style={{
                              gridColumn: ci + 2,
                              gridRow: `${b.startSlot + 2} / span ${b.spanSlots}`,
                              ...offsetStyle(b.offsetMinutes, b.minutes),
                            } as CSSProperties}
                          >
                            {gapStrip(
                              { index: b.index, label: b.label, from: b.from, to: b.to, minutes: b.minutes },
                              styles.gapStripFill,
                            )}
                          </div>
                        );
                      })}

                      {/* Lunch Break Slot Banner */}
                      {day.lunchBlock && (
                        <div
                          className={styles.lunchBreakSlot}
                          style={{
                            gridColumn: `2 / ${calendar.roster.length + 2}`,
                            gridRow: day.lunchBlock.startSlot + 2,
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
                        const ci = calendar.columns.indexOf(b.court);
                        if (ci < 0) return null;
                        const divIdx = divColorIndex.get(b.m.divisionLabel) ?? 0;
                        const faults = problemsByMatch.get(b.m.id) ?? [];
                        const movable = canMove(b.m) && b.court !== 'Unscheduled';
                        const picked = nav?.id === b.m.id;
                        return (
                          <div
                            key={b.m.id}
                            className={[
                              styles.gridMatchCard,
                              b.m.status === 'live' ? styles.gridMatchCardLive : '',
                              b.m.isEdited ? styles.gridMatchCardEdited : '',
                              faults.length > 0 ? styles.gridMatchCardFault : '',
                              picked ? styles.gridMatchCardPicked : '',
                            ].filter(Boolean).join(' ')}
                            data-div={divIdx}
                            data-pickable={movable ? 'true' : undefined}
                            onClick={e => {
                              if (!movable) return;
                              // The time is a button; let a click on it be a click.
                              if ((e.target as HTMLElement).closest('button,input,select,textarea')) return;
                              pickUp(b.m);
                            }}
                            style={{
                              gridColumn: ci + 2,
                              gridRow: `${b.startSlot + 2} / span ${b.spanSlots}`,
                              ...offsetStyle(b.offsetMinutes, b.minutes),
                            } as CSSProperties}
                          >
                            {picked && movable && navigator(b.m)}

                            {/* Buffer goes in *before* this match, so the handle
                                sits on the edge it would be inserted at. Hanging
                                off the card's top rather than living between two
                                cards means it belongs to a match you can point
                                at, and the first match on a court can have one
                                too — a late start is as real as a mid-day break. */}
                            {editMode && !blockMode && !picked && movable && (
                              <div className={styles.cardBuffer}>
                                {insertAt?.matchId === b.m.id ? (
                                  <BufferPrompt
                                    suggested={insertAt.suggested}
                                    onCancel={() => setInsertAt(null)}
                                    onConfirm={minutes =>
                                      insertBuffer(
                                        b.court,
                                        day.day,
                                        fromHHMM(b.m.time) ?? rowStartMin(calendar.axis, b.startSlot),
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
                                ) : movable ? (
                                  <button
                                    type="button"
                                    className={styles.gridMatchTime}
                                    onClick={() => setEditingTime(b.m.id)}
                                    title="Click to set a new time"
                                    data-editable="true"
                                  >
                                    {b.m.time}
                                  </button>
                                ) : (
                                  /* Locked, so the time is just the time — a
                                     button here would draw a control the
                                     organizer can't use. */
                                  <span className={styles.gridMatchTime}>{b.m.time}</span>
                                )}
                                <span className={styles.gridMatchDuration}>{b.m.durationMinutes || 45} m</span>
                              </div>
                              <span className={styles.gridMatchTags}>
                                {b.m.roundName && <span className={styles.gridMatchRound}>{b.m.roundName}</span>}
                                <span className={styles.gridMatchNo}>{b.m.matchNo}</span>
                              </span>
                            </div>
                            <div className={`${styles.gridTeamRow} ${styles.gridTeamRowA}`}>
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
                            <div className={`${styles.gridTeamRow} ${styles.gridTeamRowB}`}>
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
