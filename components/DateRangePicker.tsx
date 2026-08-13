'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import styles from './DateRangePicker.module.css';

/* ── Tournament date range picker ─────────────────────────────────
 *
 * Two months side by side, pick a start then an end. Replaces a pair of
 * native date inputs, which couldn't show that the two fields are one
 * range — an organizer setting a three-day event had to hold the span in
 * their head across two controls.
 *
 * Everything here is UTC. The rest of the app reads scheduled dates in UTC
 * (see lib/data.ts formatMatchDate), and a picker running in local time
 * would hand back a date a day out for anyone west of Greenwich.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM-DD' → epoch ms at UTC midnight, or null if unparseable. */
function toUTC(iso: string): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The days of one month, with leading blanks so the 1st lands on its
 *  weekday. Blanks are null rather than the previous month's days: this
 *  calendar is for picking inside a month, not for browsing across one. */
function monthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}

export interface DateRangePickerProps {
  /** 'YYYY-MM-DD' */
  start: string;
  /** 'YYYY-MM-DD'; equal to start for a one-day event */
  end: string;
  /** Collapses the range to a single day. */
  singleDay?: boolean;
  onChange: (start: string, end: string) => void;
  /** Earliest selectable day, 'YYYY-MM-DD'. Past days are greyed out. */
  min?: string;
}

export default function DateRangePicker({
  start,
  end,
  singleDay = false,
  onChange,
  min,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* The panel is portalled to <body> and positioned by hand. It has to be:
     this picker lives inside a modal whose body scrolls and whose shell sets
     overflow:hidden, so an absolutely-positioned panel gets cut off at the
     modal's edge. Fixed positioning off the trigger's rect escapes both. */
  const [anchor, setAnchor] = useState<{ top: number; left: number; flip: boolean } | null>(null);

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const PANEL_H = 430;
    const PANEL_W = 570;
    const flip = r.bottom + PANEL_H > window.innerHeight && r.top > PANEL_H;
    // Keep it on screen when the trigger sits near the right edge.
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - PANEL_W - 8));
    setAnchor({ top: flip ? r.top - 8 : r.bottom + 8, left, flip });
  };

  const startMs = toUTC(start);
  const endMs = toUTC(end);
  const minMs = min ? toUTC(min) : null;

  /* Draft selection, kept separate from the committed value so backing out
     of a half-made range leaves the form as it was. */
  const [draftStart, setDraftStart] = useState<number | null>(startMs);
  const [draftEnd, setDraftEnd] = useState<number | null>(endMs);
  const [hover, setHover] = useState<number | null>(null);

  // The left-hand month; the right is always the one after it.
  const [view, setView] = useState(() => {
    const base = startMs ?? Date.now();
    const d = new Date(base);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  /* Opening re-syncs the draft to what's saved, so backing out of a
     half-made range and reopening starts from the committed value again.
     Done here rather than in an effect on `open`: an effect would set state
     during render-commit and cascade a second render for no reason. */
  const openPicker = () => {
    setDraftStart(startMs);
    setDraftEnd(endMs);
    setHover(null);
    const d = new Date(startMs ?? Date.now());
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel is outside the wrapper in the DOM now, so both count as
      // "inside" for the purposes of dismissing.
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    // Capture phase: the modal body scrolls, and scroll doesn't bubble.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const shift = (by: number) => {
    setView(v => {
      const d = new Date(Date.UTC(v.year, v.month + by, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  };

  const pick = (ms: number) => {
    if (singleDay) {
      setDraftStart(ms);
      setDraftEnd(ms);
      return;
    }
    // No start yet, or a complete range already: begin a new one.
    if (draftStart === null || draftEnd !== null) {
      setDraftStart(ms);
      setDraftEnd(null);
      return;
    }
    // Second click before the first: treat it as the new start rather than
    // an invalid backwards range.
    if (ms < draftStart) {
      setDraftStart(ms);
      return;
    }
    setDraftEnd(ms);
  };

  // While only the start is set, the day under the cursor previews the end.
  const previewEnd = draftEnd ?? (draftStart !== null && hover !== null && hover > draftStart ? hover : null);

  const dayCount = useMemo(() => {
    if (draftStart === null) return 0;
    const last = previewEnd ?? draftStart;
    return Math.round((last - draftStart) / 86_400_000) + 1;
  }, [draftStart, previewEnd]);

  const apply = () => {
    if (draftStart === null) return;
    const s = toISO(draftStart);
    const e = toISO(previewEnd ?? draftStart);
    onChange(s, e);
    setOpen(false);
  };

  const clear = () => {
    setDraftStart(null);
    setDraftEnd(null);
    setHover(null);
  };

  const label = start
    ? singleDay || !end || end === start
      ? formatLong(start)
      : `${formatLong(start)} – ${formatLong(end)}`
    : 'Select dates';

  const renderMonth = (year: number, month: number) => (
    <div className={styles.month}>
      <div className={styles.monthName}>{MONTHS[month]} {year}</div>
      <div className={styles.weekRow}>
        {WEEKDAYS.map(w => <span key={w} className={styles.weekday}>{w}</span>)}
      </div>
      <div className={styles.dayGrid}>
        {monthGrid(year, month).map((d, i) => {
          if (d === null) return <span key={`b${i}`} className={styles.blank} />;
          const ms = Date.UTC(year, month, d);
          const disabled = minMs !== null && ms < minMs;
          const isStart = draftStart === ms;
          const isEnd = previewEnd === ms;
          const inRange =
            draftStart !== null && previewEnd !== null && ms > draftStart && ms < previewEnd;
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => pick(ms)}
              onMouseEnter={() => setHover(ms)}
              className={[
                styles.day,
                disabled ? styles.dayDisabled : '',
                inRange ? styles.dayInRange : '',
                isStart ? styles.dayEdge : '',
                isEnd && !isStart ? styles.dayEdge : '',
                // Square off the inner side of each end so the band reads as
                // one continuous strip rather than two detached circles.
                isStart && previewEnd !== null && previewEnd !== ms ? styles.dayEdgeStart : '',
                isEnd && draftStart !== null && draftStart !== ms ? styles.dayEdgeEnd : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={isStart || isEnd}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );

  const nextMonth = new Date(Date.UTC(view.year, view.month + 1, 1));

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Calendar size={16} className={styles.triggerIcon} />
        <span className={start ? styles.triggerValue : styles.triggerPlaceholder}>{label}</span>
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label="Choose tournament dates"
          style={{
            top: anchor.top,
            left: anchor.left,
            transform: anchor.flip ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className={styles.panelHead}>
            <button type="button" className={styles.nav} onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className={styles.nav} onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className={styles.months} onMouseLeave={() => setHover(null)}>
            {renderMonth(view.year, view.month)}
            {renderMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth())}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.clear} onClick={clear}>Clear</button>
            <button
              type="button"
              className={styles.apply}
              onClick={apply}
              disabled={draftStart === null}
            >
              {dayCount > 0
                ? `Select ${dayCount} day${dayCount === 1 ? '' : 's'}`
                : 'Select dates'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** "3 Oct 2026" — UTC, matching how the app reads every other date. */
function formatLong(iso: string): string {
  const ms = toUTC(iso);
  if (ms === null) return iso;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
