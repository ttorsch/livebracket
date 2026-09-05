'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { tournamentStatus } from '../../../../../lib/tournamentStatus';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Grid,
  GripVertical,
  ImagePlus,
  MapPin,
  Minus,
  Plus,
  Printer,
  Save,
  Settings,
  Table,
  Trophy,
  Utensils,
  Wand2,
  X,
} from 'lucide-react';
import { planDrop, type DropTarget, type Placement } from '@/lib/schedule/dropPlan';
import { axisLabels, buildCalendarAxis, placeOnAxis, rowKind, rowStartMin, type CalendarAxis } from '@/lib/schedule/calendarAxis';
import { courtRoster } from '@/lib/schedule/types';
import { hasPlacement, isOffEventDay } from '@/lib/schedule/placedMatch';
import { scheduleSaveGate } from '@/lib/scheduleGate';
import { MAX_SETS, scoreProblem, type SetScore } from '@/lib/matchScore';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import styles from './page.module.css';
import { getTournamentDetail, type TournamentDetail, type DetailDivision, type ScheduleConfig } from '../../../../../lib/data';
import { fetchLiveScores } from '../../../../../lib/liveScores';
import { Badge, BracketIcon } from '../../../../../components/livebracket-ds';
import {
  generateSchedule,
  scheduleInventory,
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
import { type MatchLabel } from '../../../../../lib/divisionMatches';
import { labelDivisions, toSchedulableDivisions } from '../../../../../lib/schedule/schedulableDivisions';

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
  day: number;           // 0-based day offset (-1 = unscheduled or off the event's days)
  date: string;          // 'YYYY-MM-DD' the match sits on ('' when unscheduled)
  dateLabel: string;     // e.g. "Sat, Jul 26" ('' when unscheduled)
  isPreview?: boolean;   // slot came from an unsaved generated preview
  isEdited?: boolean;    // organizer moved this one by hand
  unscheduled?: boolean; // no court/time assigned
  overScheduled?: boolean; // couldn't fit in the tournament's days (preview overflow)
  durationMinutes: number; // match slot length, for sizing calendar blocks
}

/** Determines winner of a completed match, returning 'A', 'B', or null. */
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

// Sort by (day, "HH:MM") ascending; unscheduled placeholders sink to the end.
//
// The sink is having no *time*, not having a negative day. `day` is a signed
// offset from the start date, so a match on the day before the event sorts
// before day 0 and not after everything — it is early, not missing.
function timeKey(day: number, t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return day * 1e7 + Number(m[1]) * 60 + Number(m[2]);
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
const PX_PER_MIN = 3.8;

/* What the *phone* card's content actually needs, measured rather than chosen:
   6px of padding top and bottom, a 20px top row (time, round, match number) and
   the 6px under it, and two 24px team rows — plus the 3px the card is inset
   from its row at each end. 92px, and none of it is slack.

   It is a floor in pixels rather than a scale in pixels-per-minute because on a
   phone the scale is *derived* from it — see `phonePxPerMin`. */
const PHONE_CARD_FLOOR_PX = 52;

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
const NET_ADJUST_LABEL = 'Net Adjust';
const isBufferBlock = (label?: string) =>
  label === BUFFER_LABEL || label === NET_ADJUST_LABEL || (label ? /buffer|net\s*adjust/i.test(label) : false);

/** Droppable empty time slot cell in Grid View. */
function GridDroppableSlot({
  court,
  day,
  slot,
  startMin,
  ci,
}: {
  court: string;
  day: number;
  slot: number;
  startMin: number;
  ci: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop-slot-${court}-${day}-${slot}`,
    data: {
      type: 'slot',
      court,
      day,
      time: startMin,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`${styles.calDropSlotCell} ${isOver ? styles.calDropSlotCellOver : ''}`}
      style={{
        gridColumn: ci + 2,
        gridRow: slot + 2,
      } as CSSProperties}
    >
      {isOver && (
        <div className={styles.calDropGhostSlot}>
          <Clock size={12} />
          <span>{toHHMM(startMin)}</span>
        </div>
      )}
    </div>
  );
}

/** Draggable and Droppable match card in Grid View. */
function GridMatchCardItem({
  b,
  ci,
  divIdx,
  faults,
  movable,
  editMode,
  editingTime,
  insertAt,
  activeDragMatch,
  setEditingTime,
  setInsertAt,
  insertBuffer,
  bufferSuggestion,
  moveMatch,
  scoreCells,
  scoreNote,
  day,
  axis,
  netBufferMinutes,
  isPulsing,
}: {
  b: {
    m: ScheduleMatch;
    court: string;
    startSlot: number;
    spanSlots: number;
    offsetMinutes: number;
    minutes: number;
  };
  ci: number;
  divIdx: number;
  faults: ScheduleProblem[];
  movable: boolean;
  editMode: boolean;
  editingTime: string | null;
  insertAt: { matchId: string; suggested: number } | null;
  activeDragMatch: ScheduleMatch | null;
  setEditingTime: (id: string | null) => void;
  setInsertAt: (val: { matchId: string; suggested: number } | null) => void;
  insertBuffer: (court: string, day: number, atMin: number, minutes: number, label?: string) => void;
  bufferSuggestion: (m: ScheduleMatch) => number;
  moveMatch: (matchId: string, court: string, day: number, time: string) => void;
  /* Rendered by the page rather than here: the score cells are the same
     control in both views, and only the page holds what is being typed. */
  scoreCells: (m: ScheduleMatch, side: 'a' | 'b') => ReactNode;
  scoreNote: (m: ScheduleMatch) => ReactNode;
  day: number;
  axis: CalendarAxis;
  netBufferMinutes: number;
  isPulsing?: boolean;
}) {
  const isSelfDragging = activeDragMatch?.id === b.m.id;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: b.m.id,
    disabled: !movable,
    data: {
      type: 'match',
      match: b.m,
      court: b.court,
      day,
    },
  });

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `drop-match-${b.m.id}`,
    disabled: !editMode,
    data: {
      type: 'match',
      match: b.m,
      court: b.court,
      day,
    },
  });

  const setCardRef = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const showInsertionLine = isOver && activeDragMatch && activeDragMatch.id !== b.m.id;

  return (
    <div
      id={`match-card-${b.m.id}`}
      ref={setCardRef}
      {...(movable ? listeners : {})}
      {...(movable ? attributes : {})}
      className={[
        styles.gridMatchCard,
        movable ? styles.gridMatchCardDraggable : '',
        isDragging || isSelfDragging ? styles.gridMatchCardDragging : '',
        b.m.status === 'live' ? styles.gridMatchCardLive : '',
        b.m.status === 'done' ? styles.gridMatchCardDone : '',
        b.m.isEdited ? styles.gridMatchCardEdited : '',
        faults.length > 0 ? styles.gridMatchCardFault : '',
        isPulsing ? styles.matchCardPulse : '',
      ].filter(Boolean).join(' ')}
      data-div={divIdx}
      data-pickable={movable ? 'true' : undefined}
      style={{
        gridColumn: ci + 2,
        gridRow: `${b.startSlot + 2} / span ${b.spanSlots}`,
        ...offsetStyle(b.offsetMinutes, b.minutes),
      } as CSSProperties}
    >
      {showInsertionLine && (
        <div className={styles.calDropLineIndicator}>
          <span className={styles.calDropLineText}>Insert before {b.m.matchNo}</span>
        </div>
      )}

      {/* Buffer goes in *before* this match */}
      {editMode && movable && !isDragging && (
        <div
          className={styles.cardBuffer}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          {insertAt?.matchId === b.m.id ? (
            <BufferPrompt
              suggested={insertAt.suggested}
              onCancel={() => setInsertAt(null)}
              onConfirm={minutes => {
                const isNetFault = faults.some(p => p.kind === 'netChange');
                insertBuffer(
                  b.court,
                  day,
                  fromHHMM(b.m.time) ?? rowStartMin(axis, b.startSlot),
                  minutes,
                  isNetFault ? NET_ADJUST_LABEL : BUFFER_LABEL,
                );
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.cardBufferBtn}
              title={`Add buffer time before ${b.m.matchNo} (${b.m.time})`}
              aria-label={`Add buffer time before ${b.m.matchNo}`}
              onClick={e => {
                e.stopPropagation();
                setInsertAt({
                  matchId: b.m.id,
                  suggested: bufferSuggestion(b.m),
                });
              }}
            >
              <Plus size={16} strokeWidth={2.5} />
              <span className={styles.cardBufferTooltip}>Add buffer time</span>
            </button>
          )}
        </div>
      )}

      <div className={styles.gridMatchTop}>
        <div
          className={styles.gridMatchTimeWrap}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
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
              onClick={e => {
                e.stopPropagation();
                setEditingTime(b.m.id);
              }}
              title="Click to set a new time"
              data-editable="true"
            >
              {b.m.time}
            </button>
          ) : (
            <span className={styles.gridMatchTime}>{b.m.time}</span>
          )}
          <span className={styles.gridMatchDuration}>{b.m.durationMinutes || 45} m</span>
        </div>
        <span className={styles.gridMatchTags}>
          {b.m.roundName && <span className={styles.gridMatchRound}>{b.m.roundName}</span>}
          <span className={styles.gridMatchNo}>{b.m.matchNo}</span>
          {movable && editMode && (
            <span className={styles.gridGripIcon} title="Drag to reposition" aria-hidden="true">
              <GripVertical size={13} />
            </span>
          )}
        </span>
      </div>

      {(() => {
        const matchWinner = getMatchWinner(b.m);
        const isWinnerA = matchWinner === 'A';
        const isWinnerB = matchWinner === 'B';
        const isLoserA = matchWinner === 'B';
        const isLoserB = matchWinner === 'A';
        return (
          <div className={styles.gridMatchTeams}>
            <div className={styles.gridTeamRow}>
              <span className={`${styles.gridTeamName} ${isWinnerA ? styles.gridTeamNameWinner : ''} ${isLoserA ? styles.gridTeamNameLoser : ''}`}>{b.m.teamA}</span>
              {scoreCells(b.m, 'a')}
            </div>
            <div className={styles.gridTeamRow}>
              <span className={`${styles.gridTeamName} ${isWinnerB ? styles.gridTeamNameWinner : ''} ${isLoserB ? styles.gridTeamNameLoser : ''}`}>{b.m.teamB}</span>
              {scoreCells(b.m, 'b')}
            </div>
            {scoreNote(b.m)}
          </div>
        );
      })()}
      {faults.length > 0 && (
        <ul className={styles.gridFaults}>
          {faults.map((f, i) => (
            <li key={i}>
              <AlertTriangle size={11} />
              <div className={styles.gridFaultContent}>
                <span>{f.message}</span>
                {f.kind === 'netChange' && editMode && (
                  <button
                    type="button"
                    className={styles.gridFaultQuickBtn}
                    onClick={e => {
                      e.stopPropagation();
                      const at = fromHHMM(b.m.time) ?? rowStartMin(axis, b.startSlot);
                      insertBuffer(b.court, day, at, netBufferMinutes || 10, NET_ADJUST_LABEL);
                    }}
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    title={`Insert a ${netBufferMinutes || 10}-minute net adjust before ${b.m.matchNo}`}
                  >
                    <Plus size={11} /> Add {netBufferMinutes || 10}m net adjust
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Court section block that manages horizontal scroll and provides a small slide bar above court names */
function CourtSectionBlock({
  section,
  children,
}: {
  section: { key: string; title: string | null; courts: any[] };
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
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [thumbRatio, setThumbRatio] = useState(1);
  const [canScroll, setCanScroll] = useState(false);
  const isDragging = useRef(false);

  // Header drag-to-scroll state
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
            {section.courts.reduce((sum: number, c: any) => sum + c.matches.length, 0)} matches
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

/** Hand moves, keyed by match. */
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

  // Generator: venue config and the unsaved preview.
  const [panelOpen, setPanelOpen] = useState(false);
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [preview, setPreview] = useState<ScheduleResult | null>(null);
  const [problemListOpen, setProblemListOpen] = useState(false);
  const [pulsingMatchId, setPulsingMatchId] = useState<string | null>(null);
  const pulseTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

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
  const [editMode, setEditMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('edit') === '1';
    }
    return false;
  });
  /** The match a buffer is being inserted in front of, while its length is
   *  typed. Keyed by match rather than by court and time, because the handle
   *  belongs to a card. */
  const [insertAt, setInsertAt] = useState<{ matchId: string; suggested: number } | null>(null);
  /** Match whose time is being typed. */
  const [editingTime, setEditingTime] = useState<string | null>(null);

  /* ── Scores by hand ───────────────────────────────────────────────
   *
   * Hand Edit opens the score cells as well as the layout. The scorekeeper
   * screen is still the way a match *should* be scored, but a link that was
   * never opened, a phone that died, or a result that came in on paper all
   * end with a bracket the organizer has to fill in themselves — and a
   * referee who typed 21 for 12 leaves one they have to correct.
   *
   * A match being scored right now is the one thing left alone: the
   * referee's screen pushes whole state rather than deltas, so anything
   * typed here would be erased by their next point. `liveNow` is the set of
   * matches with live state in Redis, which is a tighter test than the
   * match's own `live` status — a scorekeeper session that was abandoned
   * hours ago leaves the status behind but no key, and that match is
   * exactly one an organizer needs to be able to score from here.
   */
  const [liveNow, setLiveNow] = useState<ReadonlySet<string>>(new Set());
  /** The match whose cells are being typed into, and what is in them.
   *  Strings, not numbers: a half-typed cell is empty, not zero. */
  const [scoreDraft, setScoreDraft] = useState<{ id: string; a: string[]; b: string[] } | null>(null);
  /* Handlers fire after the draft has already changed — Escape clears it and
   * the blur that follows would otherwise commit the render's stale copy —
   * so what gets saved is read from a ref, and the state is only for drawing. */
  const scoreDraftRef = useRef<{ id: string; a: string[]; b: string[] } | null>(null);
  const [scoreSavingId, setScoreSavingId] = useState<string | null>(null);
  const [scoreNote, setScoreNote] = useState<{ id: string; text: string; kind: 'error' | 'saved' } | null>(null);

  /* Which matches are on court right now. Re-read whenever editing is turned
   * on, so the answer is current at the moment it starts mattering. */
  useEffect(() => {
    if (!slug) return;
    let cancel = false;
    fetchLiveScores(slug).then(map => {
      if (!cancel) setLiveNow(new Set(Object.keys(map)));
    });
    return () => { cancel = true; };
  }, [slug, editMode]);

  // "Score saved" has said what it has to say after a couple of seconds; an
  // error stays until the organizer does something about it.
  useEffect(() => {
    if (scoreNote?.kind !== 'saved') return;
    const t = setTimeout(() => setScoreNote(null), 2400);
    return () => clearTimeout(t);
  }, [scoreNote]);

  const putDraft = (next: { id: string; a: string[]; b: string[] } | null) => {
    scoreDraftRef.current = next;
    setScoreDraft(next);
  };

  const [activeDragMatch, setActiveDragMatch] = useState<ScheduleMatch | null>(null);

  /** Something on screen differs from what is stored — a hand move, a block,
   *  or a config change — so there is something worth saving. */
  const [dirty, setDirty] = useState(false);

  const moveMatch = (matchId: string, court: string, day: number, time: string) => {
    setEdits(prev => new Map(prev).set(matchId, { court, day, time }));
    setDirty(true);
    setSaveMsg(null);
  };
  const clearEdits = () => setEdits(new Map());

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 4,
    },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 200,
      tolerance: 5,
    },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const collisionDetectionStrategy: CollisionDetection = args => {
    const selfDropId = `drop-match-${args.active.id}`;
    const pointerCollisions = pointerWithin(args).filter(c => c.id !== selfDropId && c.id !== args.active.id);
    if (pointerCollisions.length > 0) {
      const matchHit = pointerCollisions.find(c => String(c.id).startsWith('drop-match-'));
      if (matchHit) return [matchHit];
      return pointerCollisions;
    }
    const rectCollisions = rectIntersection(args).filter(c => c.id !== selfDropId && c.id !== args.active.id);
    const matchHit = rectCollisions.find(c => String(c.id).startsWith('drop-match-'));
    if (matchHit) return [matchHit];
    return rectCollisions;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const matchId = String(event.active.id);
    const m = allMatches.find(x => x.id === matchId);
    if (m) setActiveDragMatch(m);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragMatch(null);
    if (!over) return;

    const activeMatchId = String(active.id);
    const overData = over.data.current as
      | { type: 'match'; match: ScheduleMatch; court: string; day: number }
      | { type: 'slot'; court: string; day: number; time: number }
      | undefined;

    if (!overData) return;

    if (overData.type === 'match' && overData.match) {
      if (overData.match.id === activeMatchId) return;
      dropMatch(activeMatchId, overData.court, overData.day, { beforeId: overData.match.id });
    } else if (overData.type === 'slot' && overData.time != null) {
      dropMatch(activeMatchId, overData.court, overData.day, { time: overData.time });
    }
  };

  const handleDragCancel = () => {
    setActiveDragMatch(null);
  };

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
        // Seed the generator config from the load. Court appetite is read
        // off each division's draw, so there is nothing per-division to seed.
        setConfig(res.scheduleConfig);
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
  const labelsByDivision = useMemo(
    () => labelDivisions(detail?.divisions ?? []),
    [detail],
  );

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

  /* The whole handover to the generator, in lib/schedule/schedulableDivisions
     — a pure function with its own tests, because a fact mis-derived here
     (whether a match is pool play, above all) reshapes every later phase
     silently. */
  const schedulableDivisions = useMemo<SchedulableDivision[]>(
    () => toSchedulableDivisions(detail?.divisions ?? [], labelsByDivision),
    [detail, labelsByDivision],
  );

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

  // Same for the generator, which is a modal on a desktop and a bottom sheet
  // on a phone. It covers the schedule at both sizes, so the page behind it
  // stops scrolling for as long as it is up.
  useEffect(() => {
    if (!panelOpen) return;
    // The match list opens on top of the generator, so Escape belongs to it
    // first — otherwise one press would dismiss both.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !matchListDivId) setPanelOpen(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [panelOpen, matchListDivId]);

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
    const res = generateSchedule(schedulableDivisions, config, detail.dayCount);
    setPreview(res);
    if (res.blocks) {
      setConfigField('blocks', res.blocks);
    }
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
          const baseDate = detail.startDate || '2026-01-01';
          const dateStr = overScheduled
            ? ''
            : ed
              ? addDaysUTC(baseDate, ed.day)
              : pv
                ? addDaysUTC(baseDate, pv.day)
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
            winner: (m as any).winner ?? null,
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
      const patchRes = await fetch(`/api/tournaments/${slug}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
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
      //
      // "On screen" includes a match sitting on a day the event no longer
      // covers. `m.day < 0` used to be read here as "unscheduled", so saving
      // sent `court: null` for it and *deleted* a placement the grid was
      // drawing — the destructive half of the same mistake the validator was
      // making by ignoring those matches. It is the same question both times:
      // does this match have a placement, which is a matter of having a date
      // and not of the sign of the day offset.
      const assignments = allMatches.map(m =>
        hasPlacement(m)
          ? { matchId: m.id, court: m.court, time: m.time, day: m.day }
          : { matchId: m.id, court: null, time: null },
      );
      const putRes = await fetch(`/api/tournaments/${slug}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!putRes.ok) throw new Error((await putRes.json().catch(() => ({}))).error || 'Failed to save schedule');

      const fresh = await getTournamentDetail(slug);
      setDetail(fresh);
      if (fresh?.scheduleConfig) {
        setConfig(fresh.scheduleConfig);
      }
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
    // Exactly what the calendar grid draws. Asking `day >= 0` here checked
    // none of the matches on a day the event's configuration no longer covers
    // — the section that looks most like a normal day was the one nothing was
    // looking at. A match the grid draws is a match the validator checks.
    const placed = allMatches.filter(hasPlacement);
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
      netBufferMinutes: config.netBufferMinutes,
      label: labelOf,
      teamLabel: id => teamNames.get(id) ?? id,
    });
  }, [allMatches, schedulableDivisions, config, detail, labelsByDivision]);

  function jumpToProblem(p: ScheduleProblem) {
    setProblemListOpen(false);
    const targetMatch = allMatches.find(m => m.id === p.matchId);
    if (targetMatch) {
      if (activeDay !== 'all' && targetMatch.day >= 0 && targetMatch.day !== activeDay) {
        setActiveDay(targetMatch.day);
      }
      if (activeDivisionId !== 'all' && targetMatch.divisionId !== activeDivisionId) {
        setActiveDivisionId('all');
      }
    }
    setTimeout(() => {
      const el = document.getElementById(`match-card-${p.matchId}`);
      if (el) {
        const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        setPulsingMatchId(p.matchId);
        if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = setTimeout(() => setPulsingMatchId(null), 1500);
      }
    }, 60);
  }

  const updateBlocks = (nextBlocks: BlockedPeriod[]) => {
    setConfigField('blocks', nextBlocks);
    setPreview(prev => (prev ? { ...prev, blocks: nextBlocks } : null));
  };

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
  const insertBuffer = (
    court: string,
    day: number,
    atMin: number,
    minutes: number,
    label: string = BUFFER_LABEL,
  ) => {
    const length = Math.max(5, Math.round(minutes));
    if (!Number.isFinite(length)) return;

    const parse = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const moves: { id: string; court: string; day: number; time: string }[] = [];
    for (const m of allMatches) {
      if (m.day !== day || m.court !== court || m.unscheduled) continue;
      if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
      const start = parse(m.time);
      if (start < atMin) continue;
      moves.push({ id: m.id, court, day, time: toHHMM(start + length) });
    }

    if (moves.length > 0) {
      setEdits(prev => {
        const next = new Map(prev);
        for (const move of moves) {
          next.set(move.id, { court: move.court, day: move.day, time: move.time });
        }
        return next;
      });
    }

    const currentBlocks = preview?.blocks ?? config?.blocks ?? [];
    const nextBlocks = [
      ...currentBlocks,
      { court, day, start: toHHMM(atMin), end: toHHMM(atMin + length), label },
    ];
    updateBlocks(nextBlocks);
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

  /* What the buffer prompt should open at for a given match.
   *
   * Normally a whole match's worth — the reason to open a gap is usually to
   * make room. But a card carrying a net-change fault is the one case where
   * the right number is already known: it is exactly the buffer the venue says
   * a net takes. Only the default changes; the organizer still types whatever
   * they like. It matters because a Buffer is a blocked period, which is venue
   * configuration and survives the next generate — unlike the hand edit that
   * caused the fault in the first place. */
  const bufferSuggestion = (m: ScheduleMatch) => {
    const hasNetFault = (problemsByMatch.get(m.id) ?? []).some(p => p.kind === 'netChange');
    if (hasNetFault && config) return Math.max(5, config.netBufferMinutes);
    return m.durationMinutes || config?.blockMinutes || 45;
  };

  // ── Blocked periods ──────────────────────────────────────────────────────
  const addBlock = (court: string, day: number, startMin: number) => {
    const length = Math.max(5, Math.trunc(config?.blockMinutes ?? 45) || 45);
    const next: BlockedPeriod = {
      court,
      day,
      start: toHHMM(startMin),
      end: toHHMM(startMin + length),
      label: 'Blocked',
    };
    const currentBlocks = preview?.blocks ?? config?.blocks ?? [];
    updateBlocks([...currentBlocks, next]);
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
    const list = preview?.blocks ?? config?.blocks ?? [];
    const gone = list[index];
    if (!gone) return;

    const nextBlocks = list.filter((_, i) => i !== index);
    updateBlocks(nextBlocks);

    const parse = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const length = parse(gone.end) - parse(gone.start);
    if (isBufferBlock(gone.label) && gone.court && gone.day != null && length > 0) {
      const moves: { id: string; court: string; day: number; time: string }[] = [];
      for (const m of allMatches) {
        if (m.day !== gone.day || m.court !== gone.court || m.unscheduled) continue;
        if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
        const start = parse(m.time);
        if (start < parse(gone.end)) continue; // sits above the buffer; stays put
        moves.push({ id: m.id, court: gone.court, day: gone.day, time: toHHMM(start - length) });
      }
      if (moves.length > 0) {
        setEdits(prev => {
          const next = new Map(prev);
          for (const move of moves) {
            next.set(move.id, { court: move.court, day: move.day, time: move.time });
          }
          return next;
        });
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
    const list = preview?.blocks ?? config?.blocks ?? [];
    const block = list[index];
    if (!block) return;

    const parse = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const from = parse(block.start);
    const oldEnd = parse(block.end);
    const newEnd = Math.max(from + 5, oldEnd + deltaMinutes);
    const shift = newEnd - oldEnd;
    if (shift === 0) return;

    const nextBlocks = list.map((b, i) => (i === index ? { ...b, end: toHHMM(newEnd) } : b));
    updateBlocks(nextBlocks);

    if (isBufferBlock(block.label) && block.court && block.day != null) {
      const moves: { id: string; court: string; day: number; time: string }[] = [];
      for (const m of allMatches) {
        if (m.day !== block.day || m.court !== block.court || m.unscheduled) continue;
        if (!/^\d{2}:\d{2}$/.test(m.time)) continue;
        const start = parse(m.time);
        if (start < oldEnd) continue; // sits above the gap; stays put
        moves.push({ id: m.id, court: block.court, day: block.day, time: toHHMM(start + shift) });
      }
      if (moves.length > 0) {
        setEdits(prev => {
          const next = new Map(prev);
          for (const move of moves) {
            next.set(move.id, { court: move.court, day: move.day, time: move.time });
          }
          return next;
        });
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

    const activeBlocks = preview?.blocks ?? config?.blocks ?? [];
    const blocks = activeBlocks.map((b, index) => ({ b, index }));

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
            // The days this court actually has play on. A blocked period with
            // no day means "every day *of the event*" — an off-event day is
            // one the configuration does not describe, so it has none, which
            // is also the only answer the calendar grid can give (its
            // `blocked` array is indexed by event day).
            const days = new Set(
              matches.filter(hasPlacement).map(m => m.day).filter(d => !isOffEventDay(d, dayCount)),
            );
            const rows: CourtRow[] = matches.map(m => ({
              kind: 'match', key: m.id, sort: timeKey(m.day, m.time), m,
            }));

            if (courtName !== 'Unscheduled') {
              for (const { b, index } of blocks) {
                if (b.court != null && b.court !== courtName) continue;
                // Buffer blocks are hidden in By Court view
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
  }, [filteredMatches, splitByDay, detail, dayCount, config?.blocks, preview?.blocks]);

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
    const scheduled = filteredMatches.filter(hasPlacement);
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
        blocks: preview?.blocks ?? config?.blocks,
        /* The break is a seam to read and a target to drop onto. Only the
           second needs its true height. */
        editing: editMode,
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
      if (hasPlacement(m)) dayNumbers.add(m.day);
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

    const dayEndMin = fromHHMM(config?.endTime ?? '') ?? axis.endMin;

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

      const blocks = [
        ...d.items.map(i => ({ m: i.m, court: i.m.court, minutes: i.dur, ...placeOnAxis(axis, i.startMin, i.dur) })),
        ...(dIdx === 0 ? unscheduledBlocks : []),
      ];

      /* How tall this day is drawn.
         The axis is one ruler for the whole calendar so every day's rows line
         up — but its *length* is set by whichever day runs latest, and drawing
         all of them that tall gave a day that finished at five o'clock three
         hours of announced emptiness underneath it. So the ruler is shared and
         the height is not: a day stops at its own last match.
         A day with nothing on it still shows the configured day, because that
         is the one case where the empty rows are the answer rather than
         padding. And the Unscheduled column may make it taller — it is a stack
         rather than a timeline, and can be longer than the day it sits
         beside. */
      const closeRows = axis.rows.reduce(
        (last, row, i) => (row.startMin < dayEndMin ? i + 1 : last),
        1,
      );
      const usedRows = blocks.reduce((max, b) => Math.max(max, b.startSlot + b.spanSlots), 0);
      const maxUnscheduledSlot = unscheduledBlocks.reduce((max, b) => Math.max(max, b.startSlot + b.spanSlots), 0);
      const slots = Math.min(
        axis.slots,
        Math.max(usedRows === 0 ? closeRows : usedRows, maxUnscheduledSlot),
      );

      // Court time taken off the board by hand, mapped onto this day's rows.
      // Kept beside the lunch banner rather than merged with it: lunch is a
      // rule, a block is something the organizer put there and can take away.
      const rawBlocks = preview?.blocks ?? config?.blocks ?? [];
      const blocked = rawBlocks
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

      /* What each court's header counts: the cards drawn underneath it, in
         this section. Read off `d.items` — the day's own grouping — so the
         number and the column it heads cannot disagree. The header used to
         re-filter `filteredMatches`, which spans the whole event, so on a
         two-day tournament every section reported the same total and a court
         with nothing on it that day still read as busy.

         Only `d.items` is tallied, never the tray: an unplaced match is not
         on this day, or on any day. The By Court view already draws that line
         — it gives 'Unscheduled' a dateless section of its own. */
      const courtCounts = new Map<string, { total: number; played: number }>();
      for (const { m } of d.items) {
        const c = courtCounts.get(m.court);
        if (c) { c.total += 1; if (m.status === 'done') c.played += 1; }
        else courtCounts.set(m.court, { total: 1, played: m.status === 'done' ? 1 : 0 });
      }

      /* Nothing on the board at all — no cards, no blocked time. The day is
         still the event's, so it is still shown; it is just not worth a
         full-height grid until someone asks. */
      const isEmpty = blocks.length === 0 && blocked.length === 0;

      return {
        day: d.day, dateLabel: d.dateLabel, slots, blocks, lunchBlock, blocked, isEmpty,
        courtCounts,
        // The tray is drawn in one section only, so its header is a count of
        // that section's stack like every other column's — not of the event's.
        trayCount: dIdx === 0 ? unscheduledBlocks.length : 0,
      };
    });

    return { roster, offRoster, columns, hasUnscheduled, days, axis, labels, shortestMinutes, divOrder, unscheduledCount: unscheduled.length };
  }, [filteredMatches, allMatches, config, dayCount, activeDay, detail, preview]);

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

  const courtOrder = calendar.roster;

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
      <span className={styles.gapTooltip}>
        {b.label} {b.from}–{b.to}
      </span>
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

  /* One reader for the whole app — see lib/tournamentStatus. */
  const statusBadge = tournamentStatus({
    phase: detail?.phase,
    startDate: detail?.startDate,
    endDate: detail?.endDate,
    divisions: (detail?.divisions ?? []).map(d => ({
      registrationOpens: d.registrationOpens || '',
      registrationCloses: d.registrationCloses || '',
      cap: d.teams,
      filled: d.filled,
    })),
  });

  /* Editing belongs to the schedule, not to one way of looking at it, so the
     switch and the state of the edits ride along with both views. */
  const editToggle = (
    <button
      type="button"
      className={`${styles.gridEditBtn} ${editMode ? styles.gridEditBtnOn : ''}`}
      aria-pressed={editMode}
      onClick={() => {
        setEditMode(v => !v);
        setEditingTime(null);
        setInsertAt(null);
      }}
      title={
        editMode
          ? 'Lock the schedule so it cannot be changed by accident'
          : 'Drag matches, retime them, and insert buffer time'
      }
    >
      <span className={styles.gridEditSwitch} aria-hidden="true">
        <span className={styles.gridEditThumb} />
      </span>
      Hand Edit
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
          <button
            type="button"
            className={styles.editBarProblemBtn}
            onClick={() => setProblemListOpen(v => !v)}
            title="View schedule problems"
          >
            <AlertTriangle size={13} />{' '}
            <strong style={{ color: '#D64545' }}>
              {problems.length} problem{problems.length === 1 ? '' : 's'}
            </strong>
          </button>
        )}
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

  /* ── The score cells ──────────────────────────────────────────────
   *
   * The numbers already on a card become the fields you type into, rather
   * than opening a dialog over the schedule: correcting a result is usually
   * one digit, and the schedule around it is the context that says which
   * match you are looking at.
   */

  /** Whose result can be typed in here. A slot still waiting on an earlier
   *  round has nobody to award the match to, and one on court belongs to the
   *  referee scoring it. */
  const scoreEditable = (m: ScheduleMatch) =>
    editMode && !m.overScheduled && m.teamA !== 'TBD' && m.teamB !== 'TBD' && !liveNow.has(m.id);

  const savedCells = (m: ScheduleMatch) => ({
    a: (m.scoreA ?? []).map(String),
    b: (m.scoreB ?? []).map(String),
  });

  const draftOf = (m: ScheduleMatch) =>
    scoreDraft?.id === m.id ? scoreDraft : { id: m.id, ...savedCells(m) };

  /** Sets with something in them, on either side. */
  const usedSets = (d: { a: string[]; b: string[] }) => {
    let n = 0;
    for (let i = 0; i < MAX_SETS; i++) {
      if ((d.a[i] ?? '') !== '' || (d.b[i] ?? '') !== '') n = i + 1;
    }
    return n;
  };

  /** Cells to draw: the sets that exist, plus one empty one to type the next
   *  into — which is what a "+" button would otherwise be for. */
  const setColumns = (d: { a: string[]; b: string[] }) => Math.min(MAX_SETS, usedSets(d) + 1);

  const setScoreCell = (m: ScheduleMatch, side: 'a' | 'b', idx: number, raw: string) => {
    const base = scoreDraftRef.current?.id === m.id
      ? scoreDraftRef.current
      : { id: m.id, ...savedCells(m) };
    const next = { id: m.id, a: [...base.a], b: [...base.b] };
    const arr = next[side];
    while (arr.length <= idx) arr.push('');
    // Points only, and no number a set could not reach.
    arr[idx] = raw.replace(/[^\d]/g, '').slice(0, 3);
    putDraft(next);
    if (scoreNote?.id === m.id) setScoreNote(null);
  };

  /** The draft as sets to store, or the reason it is not one yet. The rules
   *  a set has to satisfy live in lib/matchScore, which the route reads too. */
  const draftSets = (d: { a: string[]; b: string[] }): { sets: SetScore[] } | { error: string } => {
    const sets: SetScore[] = [];
    for (let i = 0; i < usedSets(d); i++) {
      const a = (d.a[i] ?? '').trim();
      const b = (d.b[i] ?? '').trim();
      if (a === '' || b === '') return { error: 'Each set needs a score for both teams.' };
      sets.push({ a: Number(a), b: Number(b) });
    }
    const problem = scoreProblem(sets);
    return problem ? { error: problem } : { sets };
  };

  /** Put a saved result back into the loaded tournament, so the card, the
   *  winner styling and the status filter all agree without a refetch. */
  const applyMatchScore = (
    matchId: string,
    patch: { scoreA?: number[]; scoreB?: number[]; winner?: 'A' | 'B'; status: 'upcoming' | 'live' | 'done' },
  ) => {
    setDetail(prev =>
      prev
        ? {
            ...prev,
            divisions: prev.divisions.map(d => ({
              ...d,
              bracket: d.bracket.map(r => ({
                ...r,
                matches: r.matches.map(mm =>
                  mm.id === matchId
                    ? { ...mm, scoreA: patch.scoreA, scoreB: patch.scoreB, winner: patch.winner, status: patch.status }
                    : mm,
                ),
              })),
            })),
          }
        : prev,
    );
  };

  /* A result is not a placement: it goes to the server on its own, the
   * moment the organizer leaves the cells, rather than waiting behind the
   * Save button with the schedule's layout. It also isn't held back by the
   * locked-draw gate that guards placements — a match that has been played
   * has a score whatever state its division's draw is in. */
  const commitScore = async (m: ScheduleMatch) => {
    const d = scoreDraftRef.current;
    if (!d || d.id !== m.id || scoreSavingId === m.id) return;

    const built = draftSets(d);
    if ('error' in built) {
      setScoreNote({ id: m.id, text: built.error, kind: 'error' });
      return;
    }

    const before = m.scoreA ?? [];
    const beforeB = m.scoreB ?? [];
    const unchanged =
      built.sets.length === before.length &&
      built.sets.every((s, i) => s.a === before[i] && s.b === beforeB[i]);
    if (unchanged) {
      putDraft(null);
      return;
    }

    setScoreSavingId(m.id);
    try {
      const res = await fetch(`/api/tournaments/${slug}/matches/${m.id}/score`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sets: built.sets }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A 409 is the referee holding the match. Remember that, so the cells
        // close rather than inviting a second attempt that cannot land.
        if (res.status === 409) setLiveNow(prev => new Set(prev).add(m.id));
        setScoreNote({ id: m.id, text: body.error || 'Could not save that score.', kind: 'error' });
        return;
      }
      applyMatchScore(m.id, body.match);
      // The organizer may have moved on to another match's cells while this
      // was in flight; only the draft this saved is finished with.
      if (scoreDraftRef.current?.id === m.id) putDraft(null);
      setScoreNote({
        id: m.id,
        text: built.sets.length === 0 ? 'Score cleared' : 'Score saved',
        kind: 'saved',
      });
    } catch {
      setScoreNote({ id: m.id, text: 'Could not reach the server.', kind: 'error' });
    } finally {
      setScoreSavingId(null);
    }
  };

  /** One team's sets on a card: the numbers as they are, or the fields Hand
   *  Edit turns them into. `listClass`/`cellClass` are the view's own, so the
   *  cells stay exactly where they were and only gain a box. */
  const scoreCells = (m: ScheduleMatch, side: 'a' | 'b', listClass: string, cellClass: string) => {
    const values = side === 'a' ? m.scoreA : m.scoreB;

    if (!scoreEditable(m)) {
      if (!values || values.length === 0) return null;
      return (
        <div
          className={listClass}
          title={editMode && liveNow.has(m.id) ? 'Being scored live — use the scorekeeper screen' : undefined}
        >
          {values.map((sv, idx) => (
            <span key={idx} className={cellClass}>{sv}</span>
          ))}
        </div>
      );
    }

    const d = draftOf(m);
    const cells = side === 'a' ? d.a : d.b;
    const faulted = scoreNote?.id === m.id && scoreNote.kind === 'error';

    return (
      <div
        className={`${listClass} ${styles.scoreEditList}`}
        data-score-group={m.id}
        /* The calendar card is a drag handle; a pointer landing in a field
           has to stay in the field. */
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        {Array.from({ length: setColumns(d) }, (_, i) => (
          <input
            key={i}
            className={`${cellClass} ${styles.scoreInput} ${faulted ? styles.scoreInputFault : ''}`}
            value={cells[i] ?? ''}
            inputMode="numeric"
            autoComplete="off"
            placeholder="–"
            disabled={scoreSavingId === m.id}
            aria-label={`${side === 'a' ? m.teamA : m.teamB}, set ${i + 1} — match ${m.matchNo}`}
            title={`Set ${i + 1}`}
            onChange={e => setScoreCell(m, side, i, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                putDraft(null);
                setScoreNote(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={e => {
              // Moving between this match's own cells is not leaving them.
              const to = e.relatedTarget as HTMLElement | null;
              if (to?.closest('[data-score-group]')?.getAttribute('data-score-group') === m.id) return;
              commitScore(m);
            }}
          />
        ))}
      </div>
    );
  };

  /** What the cells could not say themselves: saving, a rejected result, or
   *  a match the referee still holds. */
  const scoreCellNote = (m: ScheduleMatch) => {
    if (!editMode) return null;
    if (liveNow.has(m.id)) {
      return <div className={styles.scoreNote}>Being scored live — use the scorekeeper screen.</div>;
    }
    if (scoreSavingId === m.id) return <div className={styles.scoreNote}>Saving…</div>;
    if (scoreNote?.id !== m.id) return null;
    return (
      <div
        className={`${styles.scoreNote} ${scoreNote.kind === 'error' ? styles.scoreNoteFault : styles.scoreNoteOk}`}
      >
        {scoreNote.kind === 'error' && <AlertTriangle size={11} />}
        {scoreNote.text}
      </div>
    );
  };

  /** A match the organizer can drag: only in edit mode, only once it has a
   *  court and a time to be moved away from. */
  const canMove = (m: ScheduleMatch) => editMode && !m.unscheduled && m.court !== 'Unscheduled';

  /* One heading for both views: the view's own name under it, and the
     editing switch and division key on the right. */
  const scheduleHeader = (title: string) => (
    <div className={styles.gridHeaderRow}>
      <div className={styles.gridHeaderLeft}>
        <div>
          <h2 className={styles.gridHeaderTitle}>{title}</h2>
        </div>
      </div>
      <div className={styles.gridHeaderRight}>
        {editToggle}
        {calendar.divOrder.map(label => (
          <span key={label} className={styles.calLegendItem}>
            <span className={styles.calSwatch} data-div={divColorIndex.get(label) ?? 0} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );

  /** How the two views explain editing. */
  const editHint = !editMode ? (
    <>The schedule is locked. Turn <strong>Hand Edit</strong> on to drag matches, retime them, add buffer time, or enter scores.</>
  ) : (
    <>
      Drag any match to reposition: drop onto another match to insert before it, or into an empty area to set the start time.
      <details className={styles.hintMore}>
        <summary className={styles.hintMoreSummary}>How moves work</summary>
        <p>
          Dropping onto a match inserts in front of it — everything below moves down by the match&apos;s length,
          and the court it left closes up behind it. Dropping into empty court space snaps directly to that time.
        </p>
        <p>
          Click a time to type a new one, or the <strong>+</strong>{' '}
          on a card&apos;s top edge to open a gap before it.
        </p>
        <p>
          Type into a card&apos;s score cells to enter a result the scorekeeper never recorded, or to correct one
          it got wrong — each match saves on its own as soon as you click away, and clearing every set takes the
          result back off the bracket. A match being scored live is left to the referee&apos;s screen.
        </p>
        <p>
          Hand moves are yours alone: the next Generate starts again from the solver. Buffers and blocked time are part
          of the venue, so they survive it.
        </p>
      </details>
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
      {/* ── Header ────────────────────────────────────────────────
           Eyebrow and page title on left, Bracket action on right,
           then the event card with Generate Schedule and Print Schedule buttons. */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.headerTitleRow}>
            <Link href="/dashboard" className={styles.headerBackBtn} aria-label="Back to Dashboard">
              <ArrowLeft size={18} />
            </Link>
            <div className={styles.headerTitleBlock}>
              <p className={styles.headerEyebrow}>Organizer</p>
              <h1 className={styles.heroTitle}>Schedule Generator</h1>
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
                  <Badge status={statusBadge.key}>{statusBadge.label}</Badge>
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
                  onClick={() => setPanelOpen(true)}
                >
                  <Wand2 size={14} /> Generate Schedule
                </button>
                <button
                  type="button"
                  className={`${styles.heroGhostBtn} ${styles.printBtn}`}
                  onClick={() => window.print()}
                >
                  <Printer size={14} /> Print Schedule
                </button>
                <Link
                  href={`/dashboard/tournament/${slug}`}
                  className={styles.heroGhostBtn}
                >
                  <BracketIcon size={14} /> Bracket
                </Link>
                <Link
                  href={`/dashboard/tournament/${slug}/setup`}
                  className={styles.heroGhostBtn}
                >
                  <Settings size={14} /> Setup
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

      {/* ── Generator Modal ─────────────────────────────────── */}
      {panelOpen && config && (
        <div
          className={styles.genOverlay}
          role="presentation"
          onClick={e => {
            // Backdrop only. On a phone the dialog is a bottom sheet and the
            // backdrop is the band above it; on a desktop it is the dimmed
            // page all around. Both dismiss.
            if (e.target === e.currentTarget) setPanelOpen(false);
          }}
        >
          <div
            className={styles.genDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="genDialogTitle"
          >
            {/* Phone-only grab handle. The sheet is draggable-looking rather
                than draggable — it reads as dismissible, which the backdrop
                and the close button both make true. */}
            <div className={styles.genGrabber} aria-hidden="true"><span /></div>

            <header className={styles.genHead}>
              <div className={styles.genHeadLeft}>
                <span className={styles.genHeadIcon} aria-hidden="true"><Calendar size={20} /></span>
                <div className={styles.genHeadText}>
                  <h2 id="genDialogTitle" className={styles.genHeadTitle}>Schedule Generator</h2>
                  <p className={styles.genHeadSub}>
                    {detail?.title ?? 'Untitled tournament'} · {dayCount} day{dayCount === 1 ? '' : 's'} ·{' '}
                    {config.courtCount} court{config.courtCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={styles.genHeadClose}
                onClick={() => setPanelOpen(false)}
                aria-label="Close generator"
              >
                <X size={16} />
              </button>
            </header>

            <div className={styles.genBody}>
              {/* ── Playing day ───────────────────────────────── */}
              <section className={styles.genCol}>
                <span className={styles.genEyebrow}>Playing day</span>

                <div className={styles.genCard}>
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
                      <span>Net buffer (min)</span>
                      <input type="number" min={0} max={120} step={5} value={config.netBufferMinutes} onChange={e => setConfigField('netBufferMinutes', Number(e.target.value))} />
                    </label>
                  </div>

                  <div className={styles.genRule} />

                  <div className={styles.genField}>
                    <span>Lunch break</span>
                    <div className={styles.genRangeRow}>
                      <input type="time" value={config.lunchStart} onChange={e => setConfigField('lunchStart', e.target.value)} />
                      <span className={styles.genRangeTo}>to</span>
                      <input type="time" value={config.lunchEnd} onChange={e => setConfigField('lunchEnd', e.target.value)} />
                    </div>
                  </div>

                  <div className={styles.genRule} />

                  <label className={`${styles.genField} ${styles.genFieldCap}`}>
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
                  <p className={styles.genNote}>
                    Pool play only. Once a team hits the cap, its remaining matches roll to the next day.
                  </p>
                </div>

                <label className={styles.genCheckCard}>
                  <input
                    type="checkbox"
                    checked={config.stageFinals}
                    onChange={e => setConfigField('stageFinals', e.target.checked)}
                  />
                  <span className={styles.genCheckBox} aria-hidden="true"><Check size={13} strokeWidth={3.5} /></span>
                  <span className={styles.genCheckText}>
                    <strong>Stage the knockout rounds</strong>
                    Semifinals, 3rd-place play-off and final run as whole rounds, one division at a time. Off, every
                    match is placed on its own.
                  </span>
                </label>
              </section>

              {/* ── Fit ───────────────────────────────────────── */}
              <section className={styles.genCol}>
                <span className={styles.genEyebrow}>Fit</span>

                {inventory && (
                  <div className={styles.genFitCard}>
                    <div className={styles.genFitHead}>
                      <span className={styles.genFitLabel}>Court time</span>
                      <span className={styles.genFitValue}>
                        {hoursMinutes(inventory.demandMinutes)} needed · {hoursMinutes(inventory.supplyMinutes)} available
                      </span>
                    </div>
                    {/* Demand against supply for the whole venue. Past 100% the
                        bar is full and turns red — the event does not fit. */}
                    <div
                      className={styles.genMeter}
                      role="progressbar"
                      aria-label="Court time used"
                      aria-valuemin={0}
                      aria-valuemax={inventory.supplyMinutes}
                      aria-valuenow={inventory.demandMinutes}
                    >
                      <div
                        className={`${styles.genMeterFill} ${inventory.demandMinutes > inventory.supplyMinutes ? styles.genMeterOver : ''}`}
                        style={{
                          width: `${inventory.supplyMinutes > 0
                            ? Math.min(100, (inventory.demandMinutes / inventory.supplyMinutes) * 100)
                            : 0}%`,
                        }}
                      />
                    </div>
                    <div className={styles.genFitDays}>
                      {inventory.capacity.map(c => (
                        <div key={c.day} className={styles.genFitDayRow}>
                          <span className={styles.genFitDayName}>
                            Day {c.day + 1}
                            {detail ? ` · ${shortDate(addDaysUTC(detail.startDate, c.day))}` : ''}
                          </span>
                          <span className={styles.genFitDayValue}>
                            {hoursMinutes(c.courtMinutes)}
                            <span className={styles.genFitDayBreakdown}>
                              {' '}· {config.courtCount} × {hoursMinutes(c.playableMinutes)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {inventory && inventory.demand.length > 0 && (
                  <div className={styles.genBlock}>
                    <span className={styles.genBlockTitle}>Matches to schedule</span>
                    <div className={styles.genList}>
                      {inventory.demand.map(d => (
                        <button
                          key={d.divisionId}
                          type="button"
                          className={`${styles.genListRow} ${styles.demandCard}`}
                          onClick={() => setMatchListDivId(d.divisionId)}
                          aria-label={`Show all ${d.matches} matches for ${d.label}`}
                        >
                          <span className={styles.genListName}>{d.label}</span>
                          <span className={styles.genListMeta}>{d.netHeight != null ? `${d.netHeight}m net` : 'net n/a'}</span>
                          <span className={styles.genListValue}>{d.matches} · {hoursMinutes(d.minutes)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className={styles.genNote}>
                  Spare time doesn&apos;t guarantee a fit — a match still waits for its teams and the round before it.
                  Anything that can&apos;t fit in {dayCount} day{dayCount === 1 ? '' : 's'} is flagged as over-scheduled.
                </p>
              </section>
            </div>

            <footer className={styles.genFoot}>
              <button type="button" className={styles.genCancelBtn} onClick={() => setPanelOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.genSubmitBtn}
                onClick={() => { handleGenerate(); setPanelOpen(false); }}
              >
                <Wand2 size={15} /> Generate Preview
              </button>
            </footer>
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
                {preview.backToBack > 0 ? (
                  <span className={styles.previewWarn}>
                    <AlertTriangle size={13} /> {preview.backToBack} back-to-back
                  </span>
                ) : (
                  <> · no back-to-back</>
                )}
                {problems.length > 0 && (
                  <button
                    type="button"
                    className={styles.previewProblemBtn}
                    onClick={() => setProblemListOpen(v => !v)}
                    title="View schedule problems"
                  >
                    <AlertTriangle size={13} />{' '}
                    {problems.length} problem{problems.length === 1 ? '' : 's'}
                  </button>
                )}
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

            <div className={`${styles.hintBanner} ${editMode ? styles.hintBannerOn : ''}`}>{editHint}</div>

            {courtSections.map(section => (
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
                        if (isBufferBlock(row.label)) return null;
                        return <div key={row.key}>{gapStrip(row)}</div>;
                      }

                      const m = row.m;
                      const movable = canMove(m);
                      const faults = problemsByMatch.get(m.id) ?? [];
                      return (
                        <div
                          key={m.id}
                          id={`match-card-${m.id}`}
                          className={[
                            styles.matchItem,
                            m.status === 'live' ? styles.matchItemLive : '',
                            m.status === 'done' ? styles.matchItemDone : '',
                            m.isPreview ? styles.matchItemPreview : '',
                            m.unscheduled ? styles.matchItemUnscheduled : '',
                            m.overScheduled ? styles.matchItemOverflow : '',
                            m.isEdited ? styles.matchItemEdited : '',
                            faults.length > 0 ? styles.matchItemFault : '',
                            pulsingMatchId === m.id ? styles.matchCardPulse : '',
                          ].filter(Boolean).join(' ')}
                          data-div={divColorIndex.get(m.divisionLabel) ?? 0}
                        >
                          {/* The buffer handle hangs off the edge the gap would
                              go in at, so the first match on a court can have
                              one too — a late start is as real as a mid-day
                              break. */}
                          {editMode && movable && (
                            <div className={styles.cardBuffer}>
                              {insertAt?.matchId === m.id ? (
                                <BufferPrompt
                                  suggested={insertAt.suggested}
                                  onCancel={() => setInsertAt(null)}
                                  onConfirm={minutes => {
                                    const at = fromHHMM(m.time);
                                    const isNetFault = faults.some(p => p.kind === 'netChange');
                                    if (at != null) insertBuffer(m.court, m.day, at, minutes, isNetFault ? NET_ADJUST_LABEL : BUFFER_LABEL);
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
                                      suggested: bufferSuggestion(m),
                                    })
                                  }
                                >
                                  <Plus size={16} strokeWidth={2.5} />
                                  <span className={styles.cardBufferTooltip}>Add buffer time</span>
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
                          {(() => {
                            const matchWinner = getMatchWinner(m);
                            const isWinnerA = matchWinner === 'A';
                            const isWinnerB = matchWinner === 'B';
                            const isLoserA = matchWinner === 'B';
                            const isLoserB = matchWinner === 'A';
                            return (
                              <div className={styles.matchTeams}>
                                <div className={styles.teamRow}>
                                  <span className={`${styles.teamRowName} ${isWinnerA ? styles.teamRowNameWinner : ''} ${isLoserA ? styles.teamRowNameLoser : ''}`}>{m.teamA}</span>
                                  {scoreCells(m, 'a', styles.teamScoreList, styles.teamScoreCell)}
                                </div>
                                <div className={styles.teamRow}>
                                  <span className={`${styles.teamRowName} ${isWinnerB ? styles.teamRowNameWinner : ''} ${isLoserB ? styles.teamRowNameLoser : ''}`}>{m.teamB}</span>
                                  {scoreCells(m, 'b', styles.teamScoreList, styles.teamScoreCell)}
                                </div>
                                {scoreCellNote(m)}
                              </div>
                            );
                          })()}
                          {faults.length > 0 && (
                            <ul className={styles.gridFaults}>
                              {faults.map((f, fi) => (
                                <li key={fi}>
                                  <AlertTriangle size={11} />
                                  <div className={styles.gridFaultContent}>
                                    <span>{f.message}</span>
                                    {f.kind === 'netChange' && editMode && (
                                      <button
                                        type="button"
                                        className={styles.gridFaultQuickBtn}
                                        onClick={e => {
                                          e.stopPropagation();
                                          const at = fromHHMM(m.time);
                                          if (at != null) {
                                            insertBuffer(m.court, m.day, at, config?.netBufferMinutes || 10, NET_ADJUST_LABEL);
                                          }
                                        }}
                                        title={`Insert a ${config?.netBufferMinutes || 10}-minute net adjust before ${m.matchNo}`}
                                      >
                                        <Plus size={11} /> Add {config?.netBufferMinutes || 10}m net adjust
                                      </button>
                                    )}
                                  </div>
                                </li>
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
                )}
              </CourtSectionBlock>
            ))}
          </div>
        ) : (
          <div>
            {scheduleHeader('Court Schedule')}

            {editBar}

            <div className={`${styles.hintBanner} ${editMode ? styles.hintBannerOn : ''}`}>{editHint}</div>

            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetectionStrategy}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
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
                        {isOffEventDay(day.day, dayCount) ? 'Outside the event' : `Day ${day.day + 1}`}
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
                          '--cal-ppm-wide': `${PX_PER_MIN}px`,
                          '--cal-ppm-phone': `${phonePxPerMin(calendar.shortestMinutes).toFixed(2)}px`,
                          '--cal-pitch': calendar.axis.pitch,
                          gridTemplateRows: rowTemplate(calendar.axis, day.slots),
                        } as CSSProperties}
                      >
                        {/* Top-left corner: which day this grid is. */}
                        <div className={styles.calCorner} style={{ gridColumn: 1, gridRow: 1 } as CSSProperties}>
                          {isOffEventDay(day.day, dayCount) ? (
                            <span className={styles.calCornerOffEvent}>Outside the event</span>
                          ) : (
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
                        </div>

                        {/* Top Sticky Court Headers */}
                        {calendar.columns.map((court, ci) => {
                          const { total, played } = day.courtCounts.get(court) ?? { total: 0, played: 0 };
                          const pct = total > 0 ? Math.round((played / total) * 100) : 0;
                          const stranded = calendar.offRoster.includes(court);
                          const isTray = court === 'Unscheduled';
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
                                      Not on this venue · {total} match{total === 1 ? '' : 'es'}
                                    </span>
                                  ) : isTray ? (
                                    day.trayCount > 0 && (
                                      <span className={styles.calCourtPlayed}>
                                        {day.trayCount} waiting
                                      </span>
                                    )
                                  ) : (
                                    <>
                                      <span className={styles.calCourtProgress}>
                                        <span className={styles.calCourtProgressFill} style={{ width: `${pct}%` }} />
                                      </span>
                                      <span className={styles.calCourtPlayed}>
                                        {played}/{total} played
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Opaque backing for the sticky time column. It covers the
                            header row too, so the corner above it can stop painting
                            over the first gridline — where the 09:00 label now sits —
                            and still have the gutter's own sand behind it rather than
                            whatever the scrollport happens to be. */}
                        <div
                          className={styles.calTimeGutter}
                          style={{ gridColumn: 1, gridRow: `1 / span ${Math.max(1, day.slots) + 1}` } as CSSProperties}
                        />

                        {/* Y-axis Left Sticky Time Labels.
                            Clipped to this day's own rows. The axis is one ruler
                            for the whole event, so its labels run to whichever
                            day finishes latest — and a grid item placed past the
                            explicit template does not overflow, it makes CSS
                            grow an *implicit* row for itself. A day that ended
                            at 17:40 was handed the whole event's evening back as
                            ten auto-height strips carrying nothing but a label
                            and a gridline: `--cal-rows` said 21, the DOM drew
                            31. Trimming here is what makes day.slots mean
                            something. */}
                        {calendar.labels.filter(l => l.slot < day.slots).map(l => (
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

                        {/* Horizontal Gridlines — clipped with the labels, and
                            for the same reason. */}
                        {calendar.labels.filter(l => l.slot < day.slots).map(l => (
                          <div key={`ln${l.slot}`} className={styles.calGridLine} style={{ gridColumn: `2 / ${calendar.columns.length + 2}`, gridRow: l.slot + 2 } as CSSProperties} />
                        ))}

                        {/* Empty droppable slot cells for dragging to empty spaces */}
                        {editMode &&
                          calendar.columns.map(court =>
                            Array.from({ length: day.slots }, (_, slot) => {
                              if (rowKind(calendar.axis, slot) === 'lunch') return null;
                              const startMin = rowStartMin(calendar.axis, slot);
                              const ci = calendar.columns.indexOf(court);
                              return (
                                <GridDroppableSlot
                                  key={`drop-slot-${court}-${day.day}-${slot}`}
                                  court={court}
                                  day={day.day}
                                  slot={slot}
                                  startMin={startMin}
                                  ci={ci}
                                />
                              );
                            }),
                          )}

                        {/* Court time the organizer has taken off the board */}
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
                                ...(b.offsetMinutes <= 0
                                  ? { height: `calc(${b.minutes} * var(--cal-px-per-min))` }
                                  : {}),
                              } as CSSProperties}
                            >
                              {gapStrip(
                                { index: b.index, label: b.label, from: b.from, to: b.to, minutes: b.minutes },
                                styles.gapStripFill,
                              )}
                            </div>
                          );
                        })}

                        {/* Lunch Break Slot Banner. Only when this day is drawn
                            long enough to reach the break — a day that stops
                            before it would otherwise grow an implicit row to
                            hold the banner, announcing a lunch below its own
                            last match. */}
                        {day.lunchBlock && day.lunchBlock.startSlot < day.slots && (
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

                        {/* Match Block Cards placed at their exact Y-axis time row */}
                        {day.blocks.map(b => {
                          const ci = calendar.columns.indexOf(b.court);
                          if (ci < 0) return null;
                          const divIdx = divColorIndex.get(b.m.divisionLabel) ?? 0;
                          const faults = problemsByMatch.get(b.m.id) ?? [];
                          const movable = canMove(b.m) && b.court !== 'Unscheduled';
                          return (
                            <GridMatchCardItem
                              key={b.m.id}
                              b={b}
                              ci={ci}
                              divIdx={divIdx}
                              faults={faults}
                              movable={movable}
                              editMode={editMode}
                              editingTime={editingTime}
                              insertAt={insertAt}
                              activeDragMatch={activeDragMatch}
                              setEditingTime={setEditingTime}
                              setInsertAt={setInsertAt}
                              insertBuffer={insertBuffer}
                              bufferSuggestion={bufferSuggestion}
                              moveMatch={moveMatch}
                              scoreCells={(m, side) => scoreCells(m, side, styles.gridScoreList, styles.gridScoreCell)}
                              scoreNote={scoreCellNote}
                              day={day.day}
                              axis={calendar.axis}
                              netBufferMinutes={config?.netBufferMinutes || 15}
                              isPulsing={pulsingMatchId === b.m.id}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))
              )}

              <DragOverlay dropAnimation={null}>
                {activeDragMatch ? (
                  <div
                    className={`${styles.gridMatchCard} ${styles.dragOverlayCard} ${activeDragMatch.status === 'done' ? styles.gridMatchCardDone : ''}`}
                    data-div={divColorIndex.get(activeDragMatch.divisionLabel) ?? 0}
                  >
                    <div className={styles.gridMatchTop}>
                      <div className={styles.gridMatchTimeWrap}>
                        <span className={styles.gridMatchTime}>{activeDragMatch.time}</span>
                        <span className={styles.gridMatchDuration}>{activeDragMatch.durationMinutes || 45} m</span>
                      </div>
                      <span className={styles.gridMatchTags}>
                        {activeDragMatch.roundName && <span className={styles.gridMatchRound}>{activeDragMatch.roundName}</span>}
                        <span className={styles.gridMatchNo}>{activeDragMatch.matchNo}</span>
                        <span className={styles.gridGripIcon} aria-hidden="true">
                          <GripVertical size={13} />
                        </span>
                      </span>
                    </div>
                    {(() => {
                      const dragWinner = getMatchWinner(activeDragMatch);
                      const isWinnerA = dragWinner === 'A';
                      const isWinnerB = dragWinner === 'B';
                      const isLoserA = dragWinner === 'B';
                      const isLoserB = dragWinner === 'A';
                      return (
                        <div className={styles.gridMatchTeams}>
                          <div className={styles.gridTeamRow}>
                            <span className={`${styles.gridTeamName} ${isWinnerA ? styles.gridTeamNameWinner : ''} ${isLoserA ? styles.gridTeamNameLoser : ''}`}>{activeDragMatch.teamA}</span>
                            {activeDragMatch.scoreA && activeDragMatch.scoreA.length > 0 && (
                              <div className={styles.gridScoreList}>
                                {activeDragMatch.scoreA.map((s, idx) => (
                                  <span key={idx} className={styles.gridScoreCell}>{s}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className={styles.gridTeamRow}>
                            <span className={`${styles.gridTeamName} ${isWinnerB ? styles.gridTeamNameWinner : ''} ${isLoserB ? styles.gridTeamNameLoser : ''}`}>{activeDragMatch.teamB}</span>
                            {activeDragMatch.scoreB && activeDragMatch.scoreB.length > 0 && (
                              <div className={styles.gridScoreList}>
                                {activeDragMatch.scoreB.map((s, idx) => (
                                  <span key={idx} className={styles.gridScoreCell}>{s}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
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
                className={styles.genHeadClose}
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

      {problemListOpen && (
        <div
          className={styles.problemPopoverOverlay}
          role="presentation"
          onClick={e => { if (e.target === e.currentTarget) setProblemListOpen(false); }}
        >
          <div
            className={styles.problemPopover}
            role="dialog"
            aria-modal="true"
            aria-labelledby="problemPopoverTitle"
          >
            <div className={styles.problemPopoverHeader}>
              <div>
                <h3 className={styles.problemPopoverTitle} id="problemPopoverTitle">
                  <AlertTriangle size={15} color="#D64545" /> Schedule Problems ({problems.length})
                </h3>
                <div className={styles.problemPopoverSubtitle}>
                  Click a problem to jump to its card on the schedule
                </div>
              </div>
              <button
                type="button"
                className={styles.problemPopoverClose}
                onClick={() => setProblemListOpen(false)}
                aria-label="Close problems list"
              >
                <X size={15} />
              </button>
            </div>
            <div className={styles.problemPopoverBody}>
              {problems.map((p, idx) => {
                const m = allMatches.find(match => match.id === p.matchId);
                const matchLabel = m?.matchNo || p.matchId;
                const divLabel = m?.divisionLabel;
                return (
                  <button
                    key={`${p.matchId}-${p.kind}-${idx}`}
                    type="button"
                    className={styles.problemPopoverItem}
                    onClick={() => jumpToProblem(p)}
                  >
                    <AlertTriangle size={14} className={styles.problemPopoverIcon} />
                    <div className={styles.problemPopoverText}>
                      <div>{p.message}</div>
                      <span className={styles.problemPopoverMeta}>
                        {divLabel ? `${divLabel} · ` : ''}Match {matchLabel}
                        {m?.court && m.court !== 'Unscheduled' ? ` · ${m.court}` : ''}
                        {m?.time && m.time !== '—' ? ` @ ${m.time}` : ''}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
