'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  Check, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Settings, 
  Pencil,
  Globe, 
  Calendar, 
  Users,
  BookOpen, 
  Info, 
  Sparkles, 
  Gift, 
  ListPlus,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Trash,
  Clock,
  Award,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  X,
  MapPin,
  Eye,
  UploadCloud,
  UserPlus,
  FileSpreadsheet,
  Download,
  Search,
  Link2, Share2, RotateCcw, Archive
} from 'lucide-react';
import styles from './page.module.css';
import DateRangePicker from '../../../../../components/DateRangePicker';
import PublishTournamentModal from '@/components/PublishTournamentModal';
import {
  getTournamentBasicInfo, type TournamentBasicInfo, getSetupDivisions, type SetupDivisionRow,
  getDivisionTeams, type RegisteredTeamRow, getSetupOverview, type SetupOverview,
} from '../../../../../lib/data';
import { computeReadiness, type ReadinessItem } from '../../../../../lib/setupReadiness';
import {
  PHASE, PHASE_LABEL, registrationCloseDefault, canDelete, DELETE_COPY, isPublic, type Phase,
  divisionRegistrationState, getOrganizerDivisionBadge,
} from '../../../../../lib/tournamentLifecycle';
import { joinTeamName } from '../../../../../lib/teamName';
import {
  DIVISION_GENDERS, AGE_LIMITS, ageLimitLabel, normalizeGender, normalizeAgeLimit,
  type DivisionGender, type AgeLimit,
} from '../../../../../lib/divisionEligibility';
import { Button, Card, Badge, Icon } from '@/components/livebracket-ds';
import RosterFields, { type RosterPlayer } from '@/components/registration/RosterFields';
import { SKILL_LEVELS } from '@/lib/registrationFields';
import {
  BASE_REG_FIELDS, FORMAT_PLAYERS, targetFor, type RegField, type RegFieldType, type PresetKey,
} from '../../../../../lib/registrationFields';


// The registration schema types live in lib/registrationFields because the
// public registration page renders the very list this page authors.
type OnSandFormat = '2v2' | '3v3' | '4v4' | '6v6';
type RoundFormat = 'round-robin' | 'single' | 'double';

interface TournamentRound {
  id: string;
  format: RoundFormat | null; // null until the organizer picks one
  scoring: ScoringRules;      // each round can have its own scoring (e.g. round robin to 21, single elim best of 3)
  durationMinutes: number;    // match slot length for this round, used by the scheduler
}

const DEFAULT_MATCH_MINUTES = 45;

const ROUND_FORMATS: { value: RoundFormat; label: string }[] = [
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'single', label: 'Single Elimination' },
  { value: 'double', label: 'Double Elimination' },
];

const ROUND_FORMAT_CARDS: { value: RoundFormat; label: string; desc: string }[] = [
  {
    value: 'round-robin',
    label: 'Round Robin',
    desc: 'Every team plays every team in its pool.',
  },
  {
    value: 'single',
    label: 'Single Elimination',
    desc: 'One loss and a team is out.',
  },
  {
    value: 'double',
    label: 'Double Elimination',
    desc: 'A loss drops teams to the lower bracket.',
  },
];

const roundLabel = (i: number) => `Round ${i + 1}`;

const roundBadgeLabel = (i: number) => `R${i + 1}`;

const getRoundSummaryText = (round: TournamentRound): string => {
  if (!round.format) return 'click to choose format';
  const formatCard = ROUND_FORMAT_CARDS.find(c => c.value === round.format);
  const formatName = formatCard ? formatCard.label : 'Round Robin';

  const sets = round.scoring?.setsBestOf || 3;
  const pts = round.scoring?.pointsPerSet || 21;
  const setsText = sets === 1 ? `1 set to ${pts} pts` : `best of ${sets} sets to ${pts} pts`;
  const durText = `${round.durationMinutes || DEFAULT_MATCH_MINUTES} min`;
  return `${formatName} · ${setsText} · ${durText}`;
};

interface ScoringRules {
  setsBestOf: number;        // best of 1 / 3 / 5
  pointsPerSet: number;      // Sets 1 & 2 target
  winBy2: boolean;           // must win by two
  hardCap: number;           // hard cap ceiling (0 = none)
  decidingSetPoints: number; // deciding (final) set target
}

interface SetupDivision {
  id: string;
  name: string;
  // A. Basics & dynamic capacity
  divisionTeamCap: number;          // flips public button to "Waitlist Full"
  formatTypeOnSand: OnSandFormat;   // dictates the scoring engine
  maxRosterSize: number;            // defaults to format, allows alternates
  genderEligibility: DivisionGender; // who the division is for
  ageLimit: AgeLimit;               // youth cap, or '' for no limit
  // B. Staggered timing & fees
  registrationFee: number;          // flat per-team-slot, can be 0
  currency: string;                 // ISO code the fee is priced in
  registrationOpenDate: string;     // datetime-local string, staggered windows
  registrationCloseDate: string;    // 'YYYY-MM-DD'; when this division stops taking teams
  // C. Rules & formats
  rounds: TournamentRound[];        // ordered tournament rounds, each with its own format + scoring
  /* How many teams leave each pool for the round that follows. Set here, at
     division setup, so the format is fully described before anyone registers;
     the draw screen reads it as its starting value rather than inventing one.
     Only meaningful when a group round is followed by another round. */
  advancePerPool: number;
  /* How pool finishers are seeded into the knockout round. Defined here with
     the rest of the format so the whole competition is settled before
     registration opens; the draw applies it rather than asking again. */
  crossing: string;
  rules: string;
  // Per-division (isolated) registration schema
  regFields: RegField[];
  // Advanced options (recommended)
  allowMulti: boolean;
  prizePool: string;
  netHeight: string;
  minTeams: number;
  waitlistCap: number;
  // Post-registration response (shown after a player successfully registers)
  confirmationMessage: string;
  confirmationImage: string; // data URL or '' — e.g. WhatsApp QR / flyer
}

// The Base Form block: three mandatory core inputs, injected into every new
// division and non-deletable. Cloned so editing one division's form can't
// reach back into the shared definition.
const makeBaseFields = (): RegField[] => BASE_REG_FIELDS.map(f => ({ ...f }));

// Quick-Add presets: one-click toggle chips that append standard fields.
const PRESETS: { key: PresetKey; label: string; build: () => RegField }[] = [
  {
    key: 'apparel',
    label: 'Apparel Size',
    build: () => ({ id: 'preset-apparel', label: 'Apparel Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], required: false, preset: 'apparel' }),
  },
  {
    key: 'skill',
    label: 'Skill Level',
    build: () => ({ id: 'preset-skill', label: 'Skill Level', type: 'select', options: [...SKILL_LEVELS], required: false, preset: 'skill' }),
  },
  {
    key: 'hometown',
    label: 'Home Town / Club',
    build: () => ({ id: 'preset-hometown', label: 'Home Town / Club', type: 'text', required: false, preset: 'hometown' }),
  },
  {
    key: 'nationality',
    label: 'Nationality',
    build: () => ({ id: 'preset-nationality', label: 'Nationality', type: 'text', required: false, preset: 'nationality' }),
  },
];

const defaultScoringRules = (): ScoringRules => ({
  setsBestOf: 3,
  pointsPerSet: 21,
  winBy2: true,
  hardCap: 0,
  decidingSetPoints: 15,
});

// Map a division row loaded from the database (lib/data.ts) into the shape
// this page works with, filling in defaults for any settings jsonb keys
// that predate a given field (or were never set by the organizer).
const mapDbDivision = (row: SetupDivisionRow): SetupDivision => {
  const settings = row.settings ?? {};
  const formatTypeOnSand = row.formatTypeOnSand as OnSandFormat;
  return {
    id: row.id,
    name: row.name,
    divisionTeamCap: row.divisionTeamCap,
    formatTypeOnSand,
    maxRosterSize: typeof settings.maxRosterSize === 'number' ? settings.maxRosterSize : FORMAT_PLAYERS[formatTypeOnSand] ?? 2,
    genderEligibility: normalizeGender(settings.genderEligibility),
    ageLimit: normalizeAgeLimit(settings.ageLimit),
    registrationFee: row.registrationFee,
    currency: normalizeCurrency(settings.currency),
    registrationOpenDate: typeof settings.registrationOpenDate === 'string' ? settings.registrationOpenDate : '',
    registrationCloseDate: typeof settings.registrationCloseDate === 'string' ? settings.registrationCloseDate : '',
    rounds: row.rounds.map((r) => ({
      id: r.id,
      format: r.format as RoundFormat,
      scoring: (r.scoringRules as unknown as ScoringRules) && Object.keys(r.scoringRules).length
        ? (r.scoringRules as unknown as ScoringRules)
        : defaultScoringRules(),
      durationMinutes: typeof r.durationMinutes === 'number' ? r.durationMinutes : DEFAULT_MATCH_MINUTES,
    })),
    advancePerPool: typeof settings.advancePerPool === 'number' ? settings.advancePerPool : 2,
    crossing: typeof settings.crossing === 'string' && settings.crossing ? settings.crossing : 'fivb',
    rules: typeof settings.rules === 'string' ? settings.rules : 'Standard FIVB Beach Volleyball rules apply.',
    regFields: (row.regFields as RegField[]) ?? makeBaseFields(),
    allowMulti: typeof settings.allowMulti === 'boolean' ? settings.allowMulti : true,
    prizePool: typeof settings.prizePool === 'string' ? settings.prizePool : '',
    netHeight: typeof settings.netHeight === 'string' ? settings.netHeight : '2.24m',
    minTeams: typeof settings.minTeams === 'number' ? settings.minTeams : 4,
    waitlistCap: typeof settings.waitlistCap === 'number' ? settings.waitlistCap : 5,
    confirmationMessage: typeof settings.confirmationMessage === 'string' ? settings.confirmationMessage : '',
    confirmationImage: typeof settings.confirmationImage === 'string' ? settings.confirmationImage : '',
  };
};

// Create Division modal is split into three navigable steps.
const MODAL_STEPS = ['Basics & Fee', 'Format & Rules', 'Registration'];

/* Currencies an organizer can price a division in. The symbol is display
   only — the fee is stored as a plain number and the code alongside it. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  THB: '\u0e3f', USD: '$', EUR: '\u20ac', GBP: '\u00a3', AUD: 'A$', SGD: 'S$',
};
const CURRENCIES = Object.keys(CURRENCY_SYMBOLS);
const normalizeCurrency = (v: unknown): string =>
  typeof v === 'string' && CURRENCIES.includes(v) ? v : 'THB';

/* The teams table's segmented filter. "Waitlist" is a status rather than a
 * payment state, which is why this is one control and not two. */
const TEAM_FILTERS = ['All', 'Paid', 'Unpaid', 'Waitlist'] as const;
type TeamFilter = (typeof TEAM_FILTERS)[number];

/* One row of the registered-teams table.
 *
 * The row itself opens the full registration; the payment chip, Move Up and
 * the remove button are actions in their own right, so each stops the click
 * from reaching the row behind it. */
function TeamRow({
  team, index, waitlisted = false, busy,
  onOpen, onTogglePayment, onPromote, onRemove,
}: {
  team: RegisteredTeamRow;
  index: number;
  waitlisted?: boolean;
  busy: boolean;
  onOpen: () => void;
  onTogglePayment?: () => void;
  onPromote?: () => void;
  onRemove: () => void;
}) {
  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <tr
      className={`${styles.teamRowClickable} ${busy ? styles.teamRowBusy : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      title="View full registration"
    >
      <td className={waitlisted ? styles.teamRowNoWait : styles.teamRowNo}>{index}</td>
      <td>
        <div className={styles.teamRowName}>
          {team.players.length > 0 ? joinTeamName(team.players.map(p => p.name)) : team.name}
        </div>
      </td>
      <td style={{ fontWeight: 500 }}>{team.players[0]?.phone || '—'}</td>
      <td>
        {onTogglePayment ? (
          <button
            type="button"
            className={team.paymentCleared ? styles.badgePaid : styles.badgeUnpaid}
            onClick={stop(onTogglePayment)}
            disabled={busy}
            title={team.paymentCleared ? 'Mark unpaid' : 'Mark paid'}
          >
            {team.paymentCleared ? 'Paid' : 'Unpaid'}
          </button>
        ) : (
          <span className={styles.badgeWaitlisted}>Unpaid</span>
        )}
      </td>
      <td className={styles.teamRowActions}>
        {onPromote && (
          <button
            type="button"
            className={styles.moveUpBtn}
            onClick={stop(onPromote)}
            disabled={busy}
          >
            Move Up
          </button>
        )}
        <button
          type="button"
          className={styles.rowRemoveBtn}
          onClick={stop(onRemove)}
          disabled={busy}
          aria-label={`Remove ${team.name}`}
          title="Remove team"
        >
          <X size={16} />
        </button>
      </td>
    </tr>
  );
}

/** A mobile team row with the remove action hidden behind a swipe-left (or a
 *  long-press, for anyone who does not think to swipe). The row itself stays
 *  a tap target for the detail sheet, so a horizontal drag or a long-press has
 *  to swallow the click it would otherwise fire. */
function MobileSwipeRow({
  open,
  onOpenChange,
  onRemove,
  label,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const REVEAL = 92;    // px of action panel exposed when the row is latched open
  const THRESHOLD = 44; // px of drag that latches it rather than springing back
  const SLOP = 8;       // px before a drag commits to an axis

  // null while the finger is up — the row then rests wherever `open` says.
  // A fast flick can deliver the last touchmove and the touchend in one task,
  // with no render in between, so the latch decision reads the ref, not state.
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'none' | 'x' | 'y'>('none');
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowClick = useRef(false);

  const cancelLongPress = () => {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  };
  useEffect(() => cancelLongPress, []);

  const resting = open ? -REVEAL : 0;
  const offset = drag ?? resting;

  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = 'none';
    cancelLongPress();
    longPress.current = setTimeout(() => {
      onOpenChange(true);
      swallowClick.current = true;
      start.current = null;
    }, 500);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (axis.current === 'none') {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      cancelLongPress();
      // A vertical drag is the page scrolling; hand it back to the browser.
      if (axis.current === 'y') {
        start.current = null;
        return;
      }
    }
    dragRef.current = Math.max(-REVEAL, Math.min(0, resting + dx));
    setDrag(dragRef.current);
  };

  const endDrag = () => {
    cancelLongPress();
    if (axis.current === 'x' && start.current) {
      onOpenChange((dragRef.current ?? resting) < -THRESHOLD);
      swallowClick.current = true;
    }
    dragRef.current = null;
    setDrag(null);
    start.current = null;
    axis.current = 'none';
  };

  return (
    <div className={styles.mobileSwipeRow} data-swipe-row>
      <div className={styles.mobileSwipeAction} aria-hidden={!open}>
        <button
          type="button"
          className={styles.mobileSwipeRemoveBtn}
          tabIndex={open ? 0 : -1}
          disabled={disabled}
          aria-label={`Remove ${label}`}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={15} />
          Remove
        </button>
      </div>
      <div
        className={styles.mobileSwipeContent}
        style={{
          transform: `translateX(${offset}px)`,
          transition: drag === null ? 'transform 0.2s ease' : 'none',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        onClickCapture={e => {
          // A tap on an open row closes it instead of opening the detail sheet.
          if (swallowClick.current || open) {
            swallowClick.current = false;
            e.preventDefault();
            e.stopPropagation();
            if (open) onOpenChange(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

const safeFormatDate = (d?: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string => {
  if (!d) return '';
  try {
    const cleanDate = d.includes('T') ? d : `${d}T00:00:00`;
    const dt = new Date(cleanDate);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-US', opts);
  } catch {
    return d;
  }
};

// Format the tournament date range collected on the create form (YYYY-MM-DD).
const formatDateRange = (start?: string, end?: string): string => {
  if (!start) return '';
  const s = safeFormatDate(start);
  if (end && end !== start) {
    const e = safeFormatDate(end);
    return `${s} – ${e}`;
  }
  return s;
};

// ── Team CSV import/export ────────────────────────────────────────
// One row per team; every player gets a Name/Phone/Email column triple
// (Player 1 Name, Player 1 Phone, Player 1 Email, Player 2 Name, ...).
interface ImportPlayerRow { name: string; phone: string; email: string }
interface ImportTeamRow { players: ImportPlayerRow[] }

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
};

const csvField = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const buildTeamTemplateCsv = (rosterSize: number): string => {
  const headers: string[] = [];
  for (let i = 1; i <= rosterSize; i++) {
    headers.push(`Player ${i} Name`, `Player ${i} Phone`, `Player ${i} Email`);
  }
  return headers.map(csvField).join(',') + '\r\n';
};

const parseTeamsCsv = (text: string): ImportTeamRow[] => {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length <= 1) return [];
  const teams: ImportTeamRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const players: ImportPlayerRow[] = [];
    for (let i = 0; i < cells.length; i += 3) {
      const name = (cells[i] ?? '').trim();
      if (!name) continue;
      players.push({ name, phone: (cells[i + 1] ?? '').trim(), email: (cells[i + 2] ?? '').trim() });
    }
    if (players.length > 0) teams.push({ players });
  }
  return teams;
};


/* ── Add Team modal ────────────────────────────────────────────────
   Mirrors the fields public registration asks each player for, so both
   paths write the same shape. Apparel sizes and the nationality /
   club-hometown keys come from the division's own reg_fields, exactly
   as the registration form resolves them — a division offering XS–XXL
   is not quietly forced onto the default four, and answers read back
   under the key the organizer's own question uses. */
/* The modal renders the public form's own roster component, so the
 * player shape is that component's. Contact is one pair per team, the
 * way registration collects it — the API writes it onto every player
 * row either way. */
type AddTeamPlayer = RosterPlayer;

const ADD_TEAM_DEFAULT_SIZES = ['S', 'M', 'L', 'XL'];

function divisionApparelSizes(regFields: RegField[] | undefined): string[] {
  const field = regFields?.find(f => f.preset === 'apparel');
  return field?.options?.length ? field.options : ADD_TEAM_DEFAULT_SIZES;
}

function divisionCustomKey(regFields: RegField[] | undefined, preset: PresetKey, fallback: string): string {
  return regFields?.find(f => f.preset === preset)?.id ?? fallback;
}



/* What a round's Advancement section should show.
 *
 * Both answers are about the NEXT round, not this one, because that is
 * what advancing means: teams leave this round to enter that one. A last
 * round has nowhere to send anybody, and crossing — which seeds pool
 * finishers into a bracket so pool winners meet late — describes nothing
 * if what follows is another round robin.
 *
 * A next round whose format the organizer has not picked yet still gets
 * the crossing control: undecided is not the same as round robin, and
 * hiding a setting they may need would be the worse guess. */
function advancementVisibility(rounds: TournamentRound[], index: number) {
  const current = rounds[index];
  const next = rounds[index + 1] ?? null;
  return {
    showSection: current.format === 'round-robin' && next !== null,
    showCrossing: next !== null && next.format !== 'round-robin',
  };
}



/* Net height is stored as a string with its unit on it ("2.43m") — that
 * is what the public event page prints and what the schedule screens
 * read, so the tile edits the number and puts the unit back rather than
 * changing the stored shape.
 *
 * Deliberately not parseFloat: re-parsing on every keystroke would fight
 * the organizer halfway through typing "2." by snapping it to "2". */
function netHeightDigits(stored: string): string {
  return stored.replace(/[^0-9.]/g, '');
}



/* ── Step 3 · Registration ─────────────────────────────────────────
 *
 * Registration opens today by default. The field used to be a
 * datetime-local behind an "open immediately" switch, where an empty
 * value meant "now" — two controls saying one thing. A date that
 * defaults to today says it once, and the switch is gone.
 *
 * Read in the organizer's own timezone: "today" is the day it is where
 * they are, not in UTC, which is a day out for most of Asia by evening. */
function registrationOpenDefault(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/* Divisions saved before this became a plain date still hold a
 * datetime-local string, which <input type="date"> renders as blank.
 * Trim to the date part rather than showing an empty box. */
function toDateOnly(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}

/* Which half of the form a question belongs to. Contact is what the
 * organizer needs to reach the team; everything else is asked of each
 * player, which is how the registration form itself renders them. */
function regFieldSection(field: RegField): 'contact' | 'players' {
  const target = targetFor(field);
  return target === 'email' || target === 'phone' ? 'contact' : 'players';
}

function regFieldTypeLabel(field: RegField): string {
  /* Nationality is stored as plain text but rendered as a country picker,
   * so the setup screen describes the control the player gets, not the
   * column type. */
  if (field.preset === 'nationality') return 'country dropdown';
  if (field.type === 'select') return `${field.options?.length ?? 0}-option dropdown`;
  if (field.type === 'paragraph') return 'paragraph';
  if (field.type === 'phone') return 'phone';
  if (field.type === 'email') return 'email';
  return 'short text';
}


export default function OrganizerSetup() {
  const params = useParams();
  const router = useRouter();

  // Active Map Phase: 1 = Initial Shell, 2 = Rules Announced, 3 = Live Reg, 4 = Logistics (Day Before)
  const [activePhase, setActivePhase] = useState<1 | 2 | 3 | 4>(1);

  // Info carried over from the create form (when arriving on a freshly created draft).
  const [tournamentInfo, setTournamentInfo] = useState<{
    title: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    regOpenDate?: string;
  } | null>(null);

  // Real tournament basic info from the database (title, location, dates, description).
  // Present once the tournament has actually been published (has a DB row).
  const [basicInfo, setBasicInfo] = useState<TournamentBasicInfo | null>(null);

  const [showBasicInfoEdit, setShowBasicInfoEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [basicInfoSaving, setBasicInfoSaving] = useState(false);
  const [basicInfoError, setBasicInfoError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  

  /* Cover image inside the Edit Basic Info form. The file is held until the
     form is saved rather than uploaded on selection, so cancelling out of
     the dialog doesn't leave an orphan in storage. */
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState('');
  const [editImageRemoved, setEditImageRemoved] = useState(false);

  // Phase 1 States: Division Modal & List
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState(0); // 0 = Basics & Fee, 1 = Format & Rules, 2 = Registration
  // Populated from the database once the tournament (and its divisions, if
  // any) load — see the mount effect below. Starts empty rather than seeded
  // with sample data, so a freshly published tournament with no divisions
  // shows none, instead of a leftover mock division.
  const [divisions, setDivisions] = useState<SetupDivision[]>([]);
  const [divisionsLoading, setDivisionsLoading] = useState(true);
  const [divisionSaving, setDivisionSaving] = useState(false);

  // Which division is currently selected in the top toggle, and which (if any)
  // the modal is editing (null = creating a new division).
  const [activeDivisionId, setActiveDivisionId] = useState<string | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(true);
  const [registeredTeams, setRegisteredTeams] = useState<RegisteredTeamRow[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);

  // Manual "Add Team" modal
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  /* The same answers public registration collects, so a team the
   * organizer types in is indistinguishable from one that registered
   * itself. The difference is what is enforced, not what is asked:
   * nothing here is required except one name to build the team name
   * from. */
  const [addTeamPlayers, setAddTeamPlayers] = useState<AddTeamPlayer[]>([]);
  const [addTeamContact, setAddTeamContact] = useState({ email: '', phone: '' });
  const [addTeamSaving, setAddTeamSaving] = useState(false);
  const [addTeamError, setAddTeamError] = useState('');

  // Full registration detail — index into registeredTeams so the modal can be
  // paged up/down through the whole list without closing.
  const [teamDetailIdx, setTeamDetailIdx] = useState<number | null>(null);

  // CSV import (template download + upload)
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Modal Form Inputs — A. Basics & dynamic capacity
  const [divName, setDivName] = useState('');
  const [divCap, setDivCap] = useState(8);
  const [formatType, setFormatType] = useState<OnSandFormat>('2v2');
  const [maxRoster, setMaxRoster] = useState(2);
  // B. Staggered timing & fees
  const [regFee, setRegFee] = useState(800);
  const [currency, setCurrency] = useState('THB');
  const [regOpenDate, setRegOpenDate] = useState('');
  const [regCloseDate, setRegCloseDate] = useState('');
  // C. Rules & formats — each round carries its own scoring rules (a round
  // robin round might go to 21 points while the elimination round after it
  // is best of 3), so scoring lives on TournamentRound, not the division.
  const [rounds, setRounds] = useState<TournamentRound[]>([{ id: 'r_1', format: null, scoring: defaultScoringRules(), durationMinutes: DEFAULT_MATCH_MINUTES }]);
  const [divRules, setDivRules] = useState('Standard FIVB Beach Volleyball rules apply.');

  // Per-division registration schema (isolated to this division)
  const [regFields, setRegFields] = useState<RegField[]>(makeBaseFields());

  // Post-registration response (confirmation message + optional photo)
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [confirmationImage, setConfirmationImage] = useState('');

  // Validation
  const [formError, setFormError] = useState<string | null>(null);

  /* Whole-tournament counts behind the readiness checklist and the division
   * cards. The teams table only ever loads one division; these are every
   * division at once, so they are refetched whenever a write lands. */
  const [overview, setOverview] = useState<SetupOverview | null>(null);
  const [overviewTick, setOverviewTick] = useState(0);
  const refreshOverview = () => setOverviewTick(t => t + 1);

  // Teams table controls (1A)
  const [teamQuery, setTeamQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('All');
  /** id of the team whose row action is in flight — disables just that row. */
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [capBusy, setCapBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<RegisteredTeamRow | null>(null);
  // Only one mobile row may sit swiped-open at a time; a tap anywhere off the
  // open row puts it back.
  const [swipedTeamId, setSwipedTeamId] = useState<string | null>(null);

  /** Poster lightbox — clicking the cover shows it full size. */
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [liveLinkCopied, setLiveLinkCopied] = useState(false);

  // Who the division is for (step 1, alongside cap and format)
  const [genderEligibility, setGenderEligibility] = useState<DivisionGender>('Anyone');
  const [ageLimit, setAgeLimit] = useState<AgeLimit>('');

  // Recommended/Missing Fields Inputs (Advanced Options)
  const [allowMulti, setAllowMulti] = useState(true);
  const [prizePool, setPrizePool] = useState('');
  const [netHeight, setNetHeight] = useState('2.24m');
  const [minTeams, setMinTeams] = useState(4);
  const [waitlistCap, setWaitlistCap] = useState(5);
  const [advancePerPool, setAdvancePerPool] = useState(2);
  const [crossing, setCrossing] = useState('fivb');
  const [showAdvanced, setShowAdvanced] = useState(false);



  // Floating back button: hides on scroll down, reappears on scroll up.
  const [backHidden, setBackHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY && y > 80) setBackHidden(true);
      else if (y < lastY) setBackHidden(false);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [rules, setRules] = useState('Standard FIVB Beach Volleyball rules apply. Matches are best of 3 sets to 21 points (third set to 15 if needed). Warm-ups are strictly limited to 5 minutes.');
  const [venueInfo, setVenueInfo] = useState('Memories Beach, Khao Lak. Food and drinks are available at the beach club. Free parking is available for players.');

  // Modal open reset
  const handleOpenCreateModal = () => {
    setEditingDivisionId(null);
    setDivName('');
    setDivCap(8);
    setFormatType('2v2');
    setMaxRoster(FORMAT_PLAYERS['2v2']);
    setRegFee(800);
    setCurrency('THB');
    setRegOpenDate(registrationOpenDefault());
    setRegCloseDate(registrationCloseDefault(basicInfo?.startDate));
    setRounds([{ id: 'r_' + Date.now(), format: null, scoring: defaultScoringRules(), durationMinutes: DEFAULT_MATCH_MINUTES }]);
    setDivRules('Standard FIVB Beach Volleyball rules apply.');
    setRegFields(makeBaseFields());
    setConfirmationMessage('');
    setConfirmationImage('');
    setFormError(null);
    setGenderEligibility('Anyone');
    setAgeLimit('');
    setAllowMulti(true);
    setPrizePool('');
    setNetHeight('2.24m');
    setMinTeams(4);
    setWaitlistCap(5);
    setAdvancePerPool(2);
    setCrossing('fivb');
    setShowAdvanced(false);
    setModalStep(0);
    setShowModal(true);
  };

  // Open the modal pre-filled with an existing division to edit it.
  const handleEditDivision = (id: string) => {
    const d = divisions.find(x => x.id === id);
    if (!d) return;
    setEditingDivisionId(id);
    setDivName(d.name);
    setDivCap(d.divisionTeamCap);
    setFormatType(d.formatTypeOnSand);
    setMaxRoster(d.maxRosterSize);
    setRegFee(d.registrationFee);
    setCurrency(d.currency);
    // Both fall back to their default rather than showing an empty date on
    // a division saved before these fields existed. An empty open date used
    // to mean "immediately", which today expresses just as well.
    setRegOpenDate(toDateOnly(d.registrationOpenDate) || registrationOpenDefault());
    setRegCloseDate(d.registrationCloseDate || registrationCloseDefault(basicInfo?.startDate));
    setRounds(d.rounds.length ? d.rounds : [{ id: 'r_' + Date.now(), format: null, scoring: defaultScoringRules(), durationMinutes: DEFAULT_MATCH_MINUTES }]);
    setDivRules(d.rules);
    setRegFields(d.regFields);
    setConfirmationMessage(d.confirmationMessage);
    setConfirmationImage(d.confirmationImage);
    setGenderEligibility(d.genderEligibility);
    setAgeLimit(d.ageLimit);
    setAllowMulti(d.allowMulti);
    setPrizePool(d.prizePool);
    setNetHeight(d.netHeight);
    setMinTeams(d.minTeams);
    setWaitlistCap(d.waitlistCap);
    setAdvancePerPool(d.advancePerPool);
    setCrossing(d.crossing);
    setFormError(null);
    setShowAdvanced(false);
    setModalStep(0);
    setShowModal(true);
  };

  // Per-step validation for the Create Division wizard.
  const validateModalStep = (s: number): string | null => {
    if (s === 0) {
      if (!divName.trim()) return 'Division name is required.';
      if (maxRoster < FORMAT_PLAYERS[formatType]) {
        return `Max Roster Size must be at least ${FORMAT_PLAYERS[formatType]} to field a ${formatType} team.`;
      }
    }
    if (s === 1) {
      if (rounds.some(r => r.format === null)) return 'Choose a format for every round.';
    }
    if (s === 2) {
      if (regFields.some(f => !f.core && !f.label.trim())) return 'Every custom registration question needs a label.';
    }
    return null;
  };

  // Navigate to a step. Going forward validates every step in between.
  const goToModalStep = (target: number) => {
    if (target > modalStep) {
      for (let i = modalStep; i < target; i++) {
        const err = validateModalStep(i);
        if (err) { setFormError(err); setModalStep(i); return; }
      }
    }
    setFormError(null);
    setModalStep(target);
  };

  const handleModalNext = () => goToModalStep(modalStep + 1);
  const handleModalBack = () => { setFormError(null); setModalStep(Math.max(0, modalStep - 1)); };

  // Read an uploaded confirmation photo as a data URL (no backend — stored inline).
  const handleConfirmationImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setConfirmationImage(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  };

  // On arrival from the create form: load the carried draft info and, for a brand-new
  // tournament (?new=1), start with an empty division list and auto-open the Create
  // Division modal. The tournament stays at Phase 1 (Draft) — nothing is published.
  useEffect(() => {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return;

    let draft: { title: string; location?: string; startDate?: string; endDate?: string; regOpenDate?: string } | null = null;
    try {
      const raw = sessionStorage.getItem(`lb:draft:${id}`);
      if (raw) draft = JSON.parse(raw);
    } catch {
      draft = null;
    }
    if (draft) {
      setTournamentInfo(draft);
      setDivisions([]);
      setActiveDivisionId(null);
    }

    const isNew = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new');
    if (isNew) {
      handleOpenCreateModal();
      if (draft?.regOpenDate) {
        setRegOpenDate(toDateOnly(draft.regOpenDate) || registrationOpenDefault());
      }
    }

    getTournamentBasicInfo(id).then(info => {
      if (info) setBasicInfo(info);
    }).catch(console.error);

    // Real divisions for this tournament, if it's been published — an
    // unpublished draft (no DB row yet) simply resolves to an empty list,
    // which is also the correct state for a published tournament that
    // hasn't had any divisions added yet.
    getSetupDivisions(id)
      .then(rows => {
        const mapped = rows.map(mapDbDivision);
        setDivisions(mapped);
        setActiveDivisionId(prev => prev ?? mapped[0]?.id ?? null);
      })
      .catch(console.error)
      .finally(() => setDivisionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!activeDivisionId || !tournamentId) {
      setRegisteredTeams([]);
      return;
    }
    setTeamsLoading(true);
    getDivisionTeams(tournamentId, activeDivisionId)
      .then(setRegisteredTeams)
      .catch(console.error)
      .finally(() => setTeamsLoading(false));
  }, [activeDivisionId, params.id]);

  // Whole-tournament counts for the readiness card and the division cards.
  useEffect(() => {
    const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!tournamentId) return;
    let cancelled = false;
    getSetupOverview(tournamentId)
      .then(o => { if (!cancelled) setOverview(o); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [params.id, overviewTick]);

  const [showPublishModal, setShowPublishModal] = useState(false);

  const openBasicInfoEdit = () => {
    if (basicInfo) {
      setEditTitle(basicInfo.title);
      setEditLocation(basicInfo.location);
      setEditStartDate(basicInfo.startDate);
      setEditEndDate(basicInfo.endDate ?? basicInfo.startDate);
      setEditDescription(basicInfo.description ?? '');
    } else {
      setEditTitle(tournamentInfo?.title ?? '');
      setEditLocation(tournamentInfo?.location ?? '');
      setEditStartDate(tournamentInfo?.startDate ?? '');
      setEditEndDate(tournamentInfo?.endDate ?? tournamentInfo?.startDate ?? '');
      setEditDescription('');
    }
    setEditImageFile(null);
    setEditImagePreview('');
    setEditImageRemoved(false);
    setBasicInfoError('');
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
    setDeleteError('');
    setShowBasicInfoEdit(true);
  };

  const saveBasicInfo = async () => {
    if (!editTitle.trim() || !editLocation.trim() || !editStartDate) {
      setBasicInfoError('Title, location, and start date are required.');
      return;
    }
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return;

    if (!basicInfo) {
      // Not yet published — nothing to PATCH, just update the local draft view.
      setTournamentInfo({
        title: editTitle,
        location: editLocation,
        startDate: editStartDate,
        endDate: editEndDate,
      });
      setShowBasicInfoEdit(false);
      return;
    }

    setBasicInfoSaving(true);
    setBasicInfoError('');
    try {
      /* Upload first: the PATCH wants a URL, and a failed upload should stop
         the save rather than quietly keep the old picture. `undefined` means
         "leave whatever is there" — only an explicit remove sends ''. */
      let imageUrl: string | undefined;
      if (editImageFile) {
        const fd = new FormData();
        fd.append('file', editImageFile);
        const up = await fetch('/api/tournaments/upload-image', { method: 'POST', body: fd });
        const upBody = await up.json();
        if (!up.ok) throw new Error(upBody.error || 'Could not upload the image');
        imageUrl = upBody.url;
      } else if (editImageRemoved) {
        imageUrl = '';
      }

      const res = await fetch(`/api/tournaments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          location: editLocation,
          startDate: editStartDate,
          endDate: editEndDate,
          isOneDay: editStartDate === editEndDate,
          description: editDescription,
          ...(imageUrl !== undefined ? { imageUrl } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save changes');

      // This PATCH saves details only; it can't retire a tournament, so the
      // lifecycle flags carry over from what's already loaded.
      setBasicInfo(prev => ({
        slug: body.slug,
        title: body.title,
        location: body.location,
        startDate: body.start_date,
        endDate: body.end_date,
        isOneDay: body.is_one_day,
        phase: prev?.phase ?? body.phase,
        description: body.description,
        imageUrl: body.image_url,
        archived: prev?.archived ?? false,
        cancelled: prev?.cancelled ?? false,
      }));
      setShowBasicInfoEdit(false);
    } catch (err) {
      setBasicInfoError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setBasicInfoSaving(false);
    }
  };

  const [revertingDraft, setRevertingDraft] = useState(false);
  const handleRevertToDraft = async () => {
    const slug = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!slug) return;
    setRevertingDraft(true);
    setBasicInfoError('');
    try {
      const res = await fetch(`/api/tournaments/${slug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: PHASE.draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to revert to draft');
      setBasicInfo(prev => prev ? { ...prev, phase: PHASE.draft } : null);
      setShowBasicInfoEdit(false);
      setOverviewTick(t => t + 1);
    } catch (err) {
      setBasicInfoError(err instanceof Error ? err.message : 'Failed to revert to draft');
    } finally {
      setRevertingDraft(false);
    }
  };

  const [archiving, setArchiving] = useState(false);
  const handleArchiveTournament = async () => {
    const slug = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!slug) return;
    setArchiving(true);
    setBasicInfoError('');
    try {
      const res = await fetch(`/api/tournaments/${slug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to archive tournament');
      setBasicInfo(prev => prev ? { ...prev, archived: true } : null);
      setShowBasicInfoEdit(false);
      setOverviewTick(t => t + 1);
    } catch (err) {
      setBasicInfoError(err instanceof Error ? err.message : 'Failed to archive tournament');
    } finally {
      setArchiving(false);
    }
  };

  const handleRestoreTournament = async () => {
    const slug = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!slug) return;
    setArchiving(true);
    setBasicInfoError('');
    try {
      const res = await fetch(`/api/tournaments/${slug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to unarchive tournament');
      setBasicInfo(prev => prev ? { ...prev, archived: false } : null);
      setShowBasicInfoEdit(false);
      setOverviewTick(t => t + 1);
    } catch (err) {
      setBasicInfoError(err instanceof Error ? err.message : 'Failed to unarchive tournament');
    } finally {
      setArchiving(false);
    }
  };

  const deleteTournament = async () => {
    if (!basicInfo || deleteConfirmText.trim() !== basicInfo.title) return;
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return;

    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/tournaments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete tournament');
      }
      router.push('/dashboard');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete tournament');
      setDeleting(false);
    }
  };

  // Format a Date into the value a datetime-local input expects (local time).
  const toLocalDatetimeValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // When the on-sand format changes, default Max Roster up to the new minimum
  // (only raising it — a manually entered larger roster is preserved).
  const handleFormatChange = (next: OnSandFormat) => {
    setFormatType(next);
    setMaxRoster(prev => (prev < FORMAT_PLAYERS[next] ? FORMAT_PLAYERS[next] : prev));
    setFormError(null);
  };

  /* Would saving rebuild this division's bracket?
   *
   * The rounds in a drawn division are its bracket stages, and every match
   * hangs off them. Changing the scoring or the match length is safe — those
   * are edited in place. Adding, removing or re-ordering a round is not: there
   * is no honest way to keep a bracket whose shape no longer matches, so it is
   * rebuilt, and the matches go with it. The organizer should hear that before
   * they press save, not after. */
  const originalRounds = editingDivisionId
    ? divisions.find(d => d.id === editingDivisionId)?.rounds ?? []
    : [];
  const rebuildsBracket =
    originalRounds.length > 0 &&
    (originalRounds.length !== rounds.length ||
      rounds.some((r, i) => r.format !== originalRounds[i]?.format));

  // ── Tournament rounds builder ──────────────────────────────────
  const addRound = () => {
    setRounds([...rounds, { id: 'r_' + Date.now(), format: null, scoring: defaultScoringRules(), durationMinutes: DEFAULT_MATCH_MINUTES }]);
    setFormError(null);
  };

  const setRoundFormat = (id: string, format: RoundFormat) => {
    setRounds(rounds.map(r => (r.id === id ? { ...r, format } : r)));
    setFormError(null);
  };

  const setRoundScoring = (id: string, patch: Partial<ScoringRules>) => {
    setRounds(rounds.map(r => (r.id === id ? { ...r, scoring: { ...r.scoring, ...patch } } : r)));
  };

  const setRoundDuration = (id: string, minutes: number) => {
    setRounds(rounds.map(r => (r.id === id ? { ...r, durationMinutes: minutes } : r)));
  };

  const removeRound = (id: string) => {
    if (rounds.length <= 1) return; // keep at least the first round
    setRounds(rounds.filter(r => r.id !== id));
  };

  // ── Per-division registration schema builders ──────────────────
  const isPresetActive = (key: PresetKey) => regFields.some(f => f.preset === key);

  const togglePreset = (key: PresetKey) => {
    if (isPresetActive(key)) {
      setRegFields(regFields.filter(f => f.preset !== key));
    } else {
      const preset = PRESETS.find(p => p.key === key);
      if (preset) setRegFields([...regFields, preset.build()]);
    }
  };

  const addCustomQuestion = () => {
    setRegFields([
      ...regFields,
      { id: 'q_' + Date.now(), label: '', type: 'text', required: false },
    ]);
  };

  const updateRegField = (id: string, patch: Partial<RegField>) => {
    setRegFields(regFields.map(f => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeRegField = (id: string) => {
    setRegFields(regFields.filter(f => f.id !== id));
  };

  // Helper Actions: Phase 1 (Create Division Modal Submission)
  const saveDivisionModal = async () => {
    if (!divName.trim()) {
      setFormError('Division name is required.');
      return;
    }
    // Structural constraint: roster must seat at least the on-sand format.
    if (maxRoster < FORMAT_PLAYERS[formatType]) {
      setFormError(`Max Roster Size must be at least ${FORMAT_PLAYERS[formatType]} to field a ${formatType} team.`);
      return;
    }
    // Every round needs a format chosen before saving.
    if (rounds.some(r => r.format === null)) {
      setFormError('Choose a format for every round.');
      return;
    }
    // Custom questions must be labelled before they can be saved.
    if (regFields.some(f => !f.core && !f.label.trim())) {
      setFormError('Every custom registration question needs a label.');
      return;
    }

    const data = {
      name: divName,
      divisionTeamCap: divCap,
      formatTypeOnSand: formatType,
      maxRosterSize: maxRoster,
      genderEligibility,
      ageLimit,
      registrationFee: regFee,
      currency,
      registrationOpenDate: regOpenDate,
      registrationCloseDate: regCloseDate,
      rounds,
      advancePerPool,
      crossing,
      rules: divRules,
      regFields,
      allowMulti,
      prizePool,
      netHeight,
      minTeams,
      waitlistCap,
      confirmationMessage,
      confirmationImage
    };

    const id = Array.isArray(params.id) ? params.id[0] : params.id;

    // Not yet published (no DB row to attach a division to) — keep the
    // previous local-only behavior; it'll be lost on refresh either way
    // until the tournament itself is published.
    if (!basicInfo || !id) {
      if (editingDivisionId) {
        setDivisions(divisions.map(d => d.id === editingDivisionId ? { ...d, ...data } : d));
        setActiveDivisionId(editingDivisionId);
      } else {
        const newId = 'd_' + Date.now();
        setDivisions([...divisions, { id: newId, ...data }]);
        setActiveDivisionId(newId);
      }
      setShowModal(false);
      return;
    }

    setDivisionSaving(true);
    setFormError(null);
    try {
      const res = await fetch(
        editingDivisionId ? `/api/tournaments/${id}/divisions/${editingDivisionId}` : `/api/tournaments/${id}/divisions`,
        {
          method: editingDivisionId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save division');

      const saved = mapDbDivision({
        id: body.id,
        name: body.name,
        formatTypeOnSand: body.format_type_on_sand,
        registrationFee: body.registration_fee,
        divisionTeamCap: body.division_team_cap,
        regFields: body.reg_fields,
        settings: body.settings,
        rounds: (body.rounds ?? []).map((r: { id: string; sequence: number; format: string; name: string; scoring_rules: Record<string, unknown> }) => {
          // Split the per-round duration back out of the scoring_rules blob.
          const { durationMinutes, ...scoringRules } = (r.scoring_rules ?? {}) as Record<string, unknown>;
          return {
            id: r.id,
            sequence: r.sequence,
            format: r.format,
            name: r.name,
            scoringRules,
            durationMinutes: typeof durationMinutes === 'number' ? durationMinutes : DEFAULT_MATCH_MINUTES,
          };
        }),
      });

      if (editingDivisionId) {
        setDivisions(divisions.map(d => d.id === editingDivisionId ? saved : d));
      } else {
        setDivisions([...divisions, saved]);
      }
      setActiveDivisionId(saved.id);
      setShowModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save division');
    } finally {
      setDivisionSaving(false);
    }
  };

  const removeDivision = async (id: string) => {
    const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
    const next = divisions.filter(d => d.id !== id);

    if (basicInfo && tournamentId) {
      try {
        const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to delete division');
        }
      } catch (err) {
        console.error(err);
        return;
      }
    }

    setDivisions(next);
    if (activeDivisionId === id) {
      setActiveDivisionId(next[0]?.id ?? null);
    }
  };

  // ── Registered teams: manual add + CSV import ────────────────────
  const openAddTeamModal = () => {
    if (!activeDivision) return;
    const size = activeDivision.maxRosterSize || FORMAT_PLAYERS[activeDivision.formatTypeOnSand] || 2;
    const sizes = divisionApparelSizes(activeDivision.regFields);
    // Same default the registration form picks: M when the division
    // offers it, otherwise whatever comes first.
    const defaultSize = sizes.includes('M') ? 'M' : sizes[0];
    setAddTeamPlayers(
      Array.from({ length: size }, () => ({
        name: '', shirtSize: defaultSize, skill: '', nationality: '', club: '', userId: null,
      }))
    );
    setAddTeamContact({ email: '', phone: '' });
    setAddTeamError('');
    setShowAddTeamModal(true);
  };

  const updateAddTeamPlayer = (idx: number, patch: Partial<AddTeamPlayer>) => {
    setAddTeamPlayers(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const submitAddTeam = async () => {
    if (!activeDivision || addTeamSaving) return;
    const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!tournamentId) return;

    /* Only the team name is enforced, and only because a team is named by
     * joining its players — everything else the organizer leaves blank
     * stays blank. Rows they never touched are dropped server-side. */
    if (!addTeamPlayers.some(p => p.name.trim())) {
      setAddTeamError('Add at least one player name — the team is named after its players.');
      return;
    }

    const natKey = divisionCustomKey(activeDivision.regFields, 'nationality', 'nationality');
    const clubKey = divisionCustomKey(activeDivision.regFields, 'hometown', 'hometown');
    const skillKey = divisionCustomKey(activeDivision.regFields, 'skill', 'skill');
    /* The one contact goes onto every player row, exactly as public
       registration sends it. */
    const players = addTeamPlayers.map(p => ({
      name: p.name.trim(),
      phone: addTeamContact.phone.trim(),
      email: addTeamContact.email.trim(),
      shirtSize: p.shirtSize,
      userId: p.userId ?? undefined,
      custom: {
        ...(p.nationality.trim() ? { [natKey]: p.nationality.trim() } : {}),
        ...(p.club.trim() ? { [clubKey]: p.club.trim() } : {}),
        ...(p.skill.trim() ? { [skillKey]: p.skill.trim() } : {}),
      },
    }));

    setAddTeamSaving(true);
    setAddTeamError('');
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${activeDivision.id}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 'manual' relaxes the per-player name rule the CSV importer keeps.
        body: JSON.stringify({ mode: 'manual', teams: [{ players }] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to add team');
      setRegisteredTeams(await getDivisionTeams(tournamentId, activeDivision.id));
      setShowAddTeamModal(false);
    } catch (err) {
      setAddTeamError(err instanceof Error ? err.message : 'Failed to add team');
    } finally {
      setAddTeamSaving(false);
    }
  };

  const downloadTeamTemplate = () => {
    if (!activeDivision) return;
    const rosterSize = activeDivision.maxRosterSize || FORMAT_PLAYERS[activeDivision.formatTypeOnSand] || 2;
    const csv = buildTeamTemplateCsv(rosterSize);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDivision.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-team-import-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setShowImportMenu(false);
  };

  // Export every stored field for every registered team in this division.
  const exportRegistrations = () => {
    if (!activeDivision || registeredTeams.length === 0) return;
    const maxPlayers = registeredTeams.reduce((m, t) => Math.max(m, t.players.length), 0);

    const headers = ['No.', 'Team', 'Seed', 'Status', 'Payment'];
    for (let i = 1; i <= maxPlayers; i++) {
      headers.push(`Player ${i} Name`, `Player ${i} Phone`, `Player ${i} Email`, `Player ${i} Shirt Size`);
    }

    const confirmedRows = registeredTeams.filter(t => t.status !== 'waitlist');
    const rows = registeredTeams.map((t) => {
      const isWait = t.status === 'waitlist';
      const num = isWait
        ? registeredTeams.filter(x => x.status === 'waitlist').indexOf(t) + 1
        : confirmedRows.indexOf(t) + 1;
      const cells = [
        String(num),
        t.name,
        t.seed == null ? '' : String(t.seed),
        t.status,
        t.paymentCleared ? 'Paid' : 'Unpaid',
      ];
      for (let i = 0; i < maxPlayers; i++) {
        const p = t.players[i];
        cells.push(p?.name ?? '', p?.phone ?? '', p?.email ?? '', p?.shirtSize ?? '');
      }
      return cells;
    });

    const csv = [headers, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDivision.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-registrations.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeDivision) return;
    const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!tournamentId) return;

    setImporting(true);
    setImportError('');
    setImportSummary(null);
    try {
      const text = await file.text();
      const teams = parseTeamsCsv(text);
      if (teams.length === 0) {
        throw new Error('No teams found in that file — check it matches the template.');
      }
      const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${activeDivision.id}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teams }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Import failed');
      const createdTeams = (body.created ?? []) as RegisteredTeamRow[];
      const waitlisted = createdTeams.filter(t => t.status === 'waitlist').length;
      const confirmed = createdTeams.length - waitlisted;
      setImportSummary(
        `Imported ${createdTeams.length} team${createdTeams.length === 1 ? '' : 's'}` +
          (waitlisted ? ` (${confirmed} confirmed, ${waitlisted} waitlisted).` : '.')
      );
      setRegisteredTeams(await getDivisionTeams(tournamentId, activeDivision.id));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  /* ── Per-row team actions ───────────────────────────────────────
   *
   * Each one writes first and re-reads the row the API hands back, rather
   * than guessing locally: promotion and removal both have consequences
   * (a waitlisted team moving into a freed seat) that only the server
   * knows the outcome of.
   */
  const teamUrl = (teamId: string) => {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    return `/api/tournaments/${id}/divisions/${activeDivisionId}/teams/${teamId}`;
  };

  const applyTeam = (team: RegisteredTeamRow) =>
    setRegisteredTeams(prev => prev.map(t => (t.id === team.id ? team : t)));

  const runRowAction = async (teamId: string, run: () => Promise<void>) => {
    setRowBusy(teamId);
    setRowError(null);
    try {
      await run();
      refreshOverview();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setRowBusy(null);
    }
  };

  const toggleTeamPayment = (team: RegisteredTeamRow) =>
    runRowAction(team.id, async () => {
      const res = await fetch(teamUrl(team.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentCleared: !team.paymentCleared }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not update payment');
      applyTeam(json.team);
    });

  const promoteTeam = (team: RegisteredTeamRow) =>
    runRowAction(team.id, async () => {
      const res = await fetch(teamUrl(team.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promote: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not move that team up');
      applyTeam(json.team);
    });

  // Removing a seated team frees a seat, and the API moves the first
  // waitlisted team into it — so the response, not the click, decides what
  // the list looks like afterwards.
  const removeTeam = (team: RegisteredTeamRow) =>
    runRowAction(team.id, async () => {
      const res = await fetch(teamUrl(team.id), { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not remove that team');
      setRegisteredTeams(prev =>
        prev
          .filter(t => t.id !== json.deletedId)
          .map(t => (json.promoted && t.id === json.promoted.id ? json.promoted : t)),
      );
      if (json.warning) setRowError(json.warning);
      setConfirmRemove(null);
      setSwipedTeamId(null);
    });

  /** The division as the divisions API expects it back — used to push a
   *  single changed field without inventing a partial-update endpoint. */
  const divisionPayload = (d: SetupDivision) => ({
    name: d.name,
    divisionTeamCap: d.divisionTeamCap,
    formatTypeOnSand: d.formatTypeOnSand,
    maxRosterSize: d.maxRosterSize,
    genderEligibility: d.genderEligibility,
    ageLimit: d.ageLimit,
    registrationFee: d.registrationFee,
    registrationOpenDate: d.registrationOpenDate,
    registrationCloseDate: d.registrationCloseDate,
    rounds: d.rounds,
    rules: d.rules,
    regFields: d.regFields,
    allowMulti: d.allowMulti,
    prizePool: d.prizePool,
    netHeight: d.netHeight,
    minTeams: d.minTeams,
    waitlistCap: d.waitlistCap,
    advancePerPool: d.advancePerPool,
    crossing: d.crossing,
    confirmationMessage: d.confirmationMessage,
    confirmationImage: d.confirmationImage,
  });

  // Promotion is allowed to overfill a division; this is the way back out —
  // raise the cap to match what is actually registered.
  const raiseCapTo = async (division: SetupDivision, cap: number) => {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return;
    setCapBusy(true);
    setRowError(null);
    try {
      const res = await fetch(`/api/tournaments/${id}/divisions/${division.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...divisionPayload(division), divisionTeamCap: cap }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not raise the cap');
      setDivisions(prev => prev.map(d => (d.id === division.id ? { ...d, divisionTeamCap: cap } : d)));
      refreshOverview();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not raise the cap');
    } finally {
      setCapBusy(false);
    }
  };

  // The division shown in the per-division setup panel (falls back to the first).
  const activeDivision = divisions.find(d => d.id === activeDivisionId) ?? divisions[0] ?? null;

  // Derived team-list splits + fill state, shared by the mobile Compact Utility view below.
  const confirmedTeams = registeredTeams.filter(t => t.status !== 'waitlist');
  const waitlistTeamsList = registeredTeams.filter(t => t.status === 'waitlist');
  const teamCap = activeDivision?.divisionTeamCap ?? 0;
  const fillRatio = teamCap > 0 ? Math.min(1, confirmedTeams.length / teamCap) : 0;
  const isDivisionFull = teamCap > 0 && confirmedTeams.length >= teamCap;

  // Unified single status computation (Option A: Active Division Context)
  const computeSingleStatus = (): { label: string; variant: 'live' | 'open' | 'highlight' | 'status' | 'outline' } => {
    // 1. If tournament is in Draft phase (private setup)
    if (!basicInfo || basicInfo.phase === PHASE.draft || !isPublic(basicInfo.phase as Phase)) {
      return { label: 'Draft', variant: 'status' };
    }

    // 2. If no division is loaded yet
    if (!activeDivision) {
      return { label: 'Announced', variant: 'highlight' };
    }

    const regState = divisionRegistrationState(
      {
        registrationOpens: activeDivision.registrationOpenDate || '',
        registrationCloses: activeDivision.registrationCloseDate || '',
      },
      new Date(),
    );

    if (regState === 'opens-soon') {
      return { label: 'Announced', variant: 'highlight' };
    }

    if (regState === 'closed') {
      return { label: 'Registration Closed', variant: 'status' };
    }

    // regState is 'open', check capacity
    if (isDivisionFull) {
      if (waitlistTeamsList.length > 0 || activeDivision.waitlistCap !== 0) {
        return { label: 'Waitlist Open', variant: 'highlight' };
      }
      return { label: 'Registration Full', variant: 'status' };
    }

    return { label: 'Registration Open', variant: 'open' };
  };

  const unifiedStatus = computeSingleStatus();

  // Registration-detail modal paging. The index is the position in
  // registeredTeams, so ↑/↓ walks the confirmed list straight into the
  // waitlist exactly as the table reads.
  const teamDetail = teamDetailIdx != null ? registeredTeams[teamDetailIdx] ?? null : null;
  const hasPrevTeam = teamDetailIdx != null && teamDetailIdx > 0;
  const hasNextTeam = teamDetailIdx != null && teamDetailIdx < registeredTeams.length - 1;
  useEffect(() => {
    if (!swipedTeamId) return;
    const onDown = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-swipe-row]')) setSwipedTeamId(null);
    };
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('mousedown', onDown);
    };
  }, [swipedTeamId]);

  const openTeamDetail = (team: RegisteredTeamRow) => {
    const idx = registeredTeams.findIndex(t => t.id === team.id);
    if (idx >= 0) setTeamDetailIdx(idx);
  };
  const stepTeamDetail = (delta: number) => {
    setTeamDetailIdx(prev => {
      if (prev == null) return prev;
      const next = prev + delta;
      return next >= 0 && next < registeredTeams.length ? next : prev;
    });
  };

  // Escape closes the cover lightbox, like every other overlay here.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  // ↑/↓ page the open detail modal; Escape closes it.
  useEffect(() => {
    if (teamDetailIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); stepTeamDetail(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepTeamDetail(1); }
      else if (e.key === 'Escape') setTeamDetailIdx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamDetailIdx, registeredTeams.length]);

  // Basic info card prefers the real DB row; falls back to the unsaved draft.
  const displayTitle = basicInfo?.title ?? tournamentInfo?.title ?? '';
  const displayLocation = basicInfo?.location ?? tournamentInfo?.location;
  const displayStart = basicInfo?.startDate ?? tournamentInfo?.startDate;
  const displayEnd = basicInfo?.endDate ?? tournamentInfo?.endDate;
  const displayDescription = basicInfo?.description ?? '';
  const formatPillDate = (d?: string) => safeFormatDate(d);
  const startPill = formatPillDate(displayStart);
  const endPill = displayEnd ? formatPillDate(displayEnd) : startPill;
  const dateLabel = `${startPill}${displayEnd && displayEnd !== displayStart ? ` – ${endPill}` : ''}`;

  /* ── 1A: readiness, division cards, filtered rows ───────────────
   *
   * The overview is a separate fetch, so everything below has to read
   * sensibly before it lands: no overview means no counts, which the
   * checklist renders as outstanding rather than as done.
   */
  const slug = Array.isArray(params.id) ? params.id[0] : params.id ?? '';

  const readiness = computeReadiness(
    {
      title: displayTitle,
      location: displayLocation ?? '',
      startDate: displayStart ?? '',
      dateLabel,
      divisions: (overview?.divisions ?? []).map(d => ({
        name: d.name,
        cap: d.cap,
        confirmed: d.confirmed,
        unpaid: d.unpaid,
        drawLocked: d.drawLocked,
      })),
      courtCount: overview?.courtCount ?? 0,
      totalMatches: overview?.totalMatches ?? 0,
      placedMatches: overview?.placedMatches ?? 0,
      firstMatchLabel: overview?.firstMatchLabel ?? null,
    },
    slug,
  );

  const onReadinessAction = (item: ReadinessItem) => {
    if (item.actionHref) router.push(item.actionHref);
    else openBasicInfoEdit();
  };

  /* Share the public event page. The native sheet is the right control on
   * a phone, and dismissing it is a decision rather than a failure — so a
   * cancelled share does nothing rather than silently copying instead.
   * Everywhere without a share sheet falls back to the clipboard. */
  const shareEvent = async () => {
    if (typeof window === 'undefined') return;
    if (!navigator.share) {
      copyLiveLink();
      return;
    }
    try {
      await navigator.share({
        title: displayTitle || 'Tournament',
        url: `${window.location.origin}/tournament/${slug}`,
      });
    } catch {
      /* Dismissed, or the sheet refused — either way, say nothing. */
    }
  };

  const copyLiveLink = () => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(`${window.location.origin}/tournament/${slug}`).then(
      () => {
        setLiveLinkCopied(true);
        window.setTimeout(() => setLiveLinkCopied(false), 2000);
      },
      () => setRowError('Could not copy the link'),
    );
  };

  // Seats across the whole event, for the figure in the header card.
  const seatTotals = (overview?.divisions ?? []).reduce(
    (acc, d) => ({ filled: acc.filled + d.confirmed, cap: acc.cap + d.cap }),
    { filled: 0, cap: 0 },
  );

  /** One card per division: counts come from the overview so every card is
   *  populated, not just the one whose teams happen to be loaded. */
  const divisionCards = divisions.map(d => {
    const sum = overview?.divisions.find(o => o.id === d.id);
    const confirmed = sum?.confirmed ?? 0;
    const waitlisted = sum?.waitlisted ?? 0;
    const seatsOpen = Math.max(0, d.divisionTeamCap - confirmed);
    return {
      id: d.id,
      name: d.name,
      count: `${confirmed}/${d.divisionTeamCap}`,
      meta: `${d.formatTypeOnSand} · ${d.registrationFee === 0 ? 'Free' : `${d.registrationFee} THB`}`,
      stateLabel: seatsOpen === 0 ? 'Full' : `${seatsOpen} seat${seatsOpen === 1 ? '' : 's'} open`,
      stateFull: seatsOpen === 0,
      waitLabel: waitlisted > 0 ? `${waitlisted} on waiting list` : 'No waiting list',
      active: activeDivision?.id === d.id,
    };
  });

  // Search matches a player's name or phone; the segmented control narrows
  // by payment or waiting-list status. Both apply to the loaded division.
  const matchesTeamQuery = (t: RegisteredTeamRow) => {
    const q = teamQuery.trim().toLowerCase();
    if (!q) return true;
    if (t.name.toLowerCase().includes(q)) return true;
    return t.players.some(
      p => p.name.toLowerCase().includes(q) || (p.phone ?? '').toLowerCase().includes(q),
    );
  };
  const matchesTeamFilter = (t: RegisteredTeamRow) => {
    if (teamFilter === 'All') return true;
    if (teamFilter === 'Waitlist') return t.status === 'waitlist';
    if (teamFilter === 'Paid') return t.status !== 'waitlist' && t.paymentCleared;
    return t.status !== 'waitlist' && !t.paymentCleared;
  };
  const visibleConfirmed = confirmedTeams.filter(t => matchesTeamQuery(t) && matchesTeamFilter(t));
  const visibleWaitlist = waitlistTeamsList.filter(t => matchesTeamQuery(t) && matchesTeamFilter(t));
  const noTeamsMatch =
    registeredTeams.length > 0 && visibleConfirmed.length === 0 && visibleWaitlist.length === 0;

  const unpaidCount = confirmedTeams.filter(t => !t.paymentCleared).length;
  const overCap = !!activeDivision && confirmedTeams.length > activeDivision.divisionTeamCap;

  return (
    <div className={styles.page}>
      <Link
        href="/dashboard"
        className={`${styles.backLink} ${backHidden ? styles.backLinkHidden : ''}`}
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </Link>

      <main className={styles.main}>
        <div className={styles.container}>
          {/* ── Mobile View (Header & Event Card) ──────────── */}
          <div className={styles.mobileOnly}>
            <div className={styles.headerArea}>
              <Link href="/dashboard" className={styles.mobileBackBtn} aria-label="Back to Dashboard">
                <ArrowLeft size={18} />
              </Link>
              <h1 className={styles.title}>Tournament Setup</h1>
            </div>
            {/* No cover here. On a phone the card's job is the title, the
                dates and the status — the poster took a quarter of the row
                to repeat what the event page already shows, and the
                desktop header keeps it (with the full-size view). */}
            <div className={styles.mobileEventCard}>
              {/* Editing the event's own details — title, dates, location,
                  phase. The division below has its own edit action; this
                  one is deliberately on the card it edits. */}
              <button
                type="button"
                className={styles.mobileEventEditBtn}
                onClick={openBasicInfoEdit}
                aria-label="Edit tournament details"
                title="Edit tournament details"
              >
                <Pencil size={15} />
              </button>
              <div className={styles.mobileEventBody}>
                <div className={styles.mobileEventTitle}>{displayTitle || 'Untitled tournament'}</div>
                <div className={styles.mobileEventMeta}>
                  <Calendar size={13} />
                  <span>{startPill}{displayEnd && displayEnd !== displayStart ? ` – ${endPill}` : ''}</span>
                </div>
                {displayLocation && (
                  <div className={styles.mobileEventMeta}>
                    <MapPin size={13} />
                    <span>{displayLocation}</span>
                  </div>
                )}
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge variant={unifiedStatus.variant}>{unifiedStatus.label}</Badge>
                  {basicInfo && !isPublic(basicInfo.phase as Phase) && (
                    <button
                      type="button"
                      className={styles.mobilePublishBtn}
                      onClick={() => setShowPublishModal(true)}
                    >
                      <Globe size={13} /> Publish
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Basic Info & Setup Workspace (Design 2A Desktop View) ── */}
          <div className={styles.desktopOnly}>
            {/* 1A header: eyebrow + title on the left, actions on the right */}
            <div className={styles.setupHeaderRow}>
              <div>
                <p className={styles.setupEyebrow}>Organizer</p>
                <h1 className={styles.desktop2aTitle}>Tournament Setup</h1>
              </div>
              <div className={styles.setupHeaderActions}>
                {basicInfo && isPublic(basicInfo.phase as Phase) ? (
                  <>
                    <Button
                      variant="general"
                      size="medium"
                      iconLeft={<Link2 size={15} />}
                      onClick={copyLiveLink}
                    >
                      {liveLinkCopied ? 'Link copied' : 'Copy Live Link'}
                    </Button>
                    <Button variant="primary" size="medium" iconLeft={<Pencil size={15} />} onClick={openBasicInfoEdit}>
                      Edit Tournament
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="general" size="medium" iconLeft={<Pencil size={15} />} onClick={openBasicInfoEdit}>
                      Edit Details
                    </Button>
                    <Button
                      variant="primary"
                      size="medium"
                      iconLeft={<Globe size={15} />}
                      onClick={() => setShowPublishModal(true)}
                    >
                      Publish Tournament
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* 1A Header Card — poster, summary, and the event's seat total */}
            <Card padding={0} radius="xl" className={styles.desktop2aHeaderCard}>
              <div className={styles.desktop2aHeaderCardBody}>
                {/* The cover opens full size. Replacing it lives in the Edit
                    Tournament form, so there is one way to change it. */}
                {basicInfo?.imageUrl ? (
                  <button
                    type="button"
                    className={styles.posterButton}
                    onClick={() => setLightboxOpen(true)}
                    aria-label="View cover image full size"
                    title="View full size"
                  >
                    <img src={basicInfo.imageUrl} alt="" className={styles.desktop2aPoster} />
                    <span className={styles.posterZoomHint}>
                      <Eye size={14} /> View
                    </span>
                  </button>
                ) : (
                  <div className={styles.desktop2aPosterPlaceholder}>
                    <ImagePlus size={28} opacity={0.6} />
                  </div>
                )}

                <div className={styles.desktop2aHeaderTextCol}>
                  <div className={styles.desktop2aBadgeRow}>
                    <Badge variant={unifiedStatus.variant}>{unifiedStatus.label}</Badge>
                  </div>

                  <h2 className={styles.desktop2aEventTitle}>{displayTitle || 'Untitled tournament'}</h2>

                  <div className={styles.desktop2aMetaCol}>
                    <div className={styles.desktop2aMetaItem}>
                      <Icon name="calendar" size={16} />
                      <span>{dateLabel}</span>
                    </div>
                    {displayLocation && (
                      <div className={styles.desktop2aMetaItem}>
                        <Icon name="location" size={16} />
                        <span>{displayLocation}</span>
                      </div>
                    )}
                  </div>

                </div>

                {/* Seats across the whole event, not just the open division. */}
                {seatTotals.cap > 0 && (
                  <div className={styles.headerSeats}>
                    <p className={styles.headerSeatsValue}>{seatTotals.filled}/{seatTotals.cap}</p>
                    <p className={styles.headerSeatsLabel}>
                      seats filled across {divisions.length} division{divisions.length === 1 ? '' : 's'}
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Division Tabs & 2-Column Split Layout */}
            {divisionsLoading ? (
              <div className={styles.emptyDivisions}>
                <p className={styles.emptyDivisionsHint}>Loading divisions…</p>
              </div>
            ) : divisions.length === 0 ? (
              <div className={styles.emptyDivisions}>
                <button type="button" className={styles.bigAddDivision} onClick={handleOpenCreateModal}>
                  <Plus size={34} />
                  <span>Add Division</span>
                </button>
                <p className={styles.emptyDivisionsHint}>
                  Create your first division to start configuring formats, rules, and registration.
                </p>
              </div>
            ) : (
              <>
                <div className={styles.divisionNavRow}>
                  <div className={styles.divisionSegmented} role="tablist" aria-label="Select division">
                    {divisions.map(d => {
                      const active = d.id === activeDivisionId;
                      const sum = overview?.divisions.find(o => o.id === d.id);
                      const confirmed = sum?.confirmed ?? 0;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`${styles.divisionSegment} ${active ? styles.divisionSegmentActive : ''}`}
                          onClick={() => setActiveDivisionId(d.id)}
                        >
                          <span>{d.name}</span>
                          <span style={{ fontSize: 11, opacity: 0.85 }}>({confirmed}/{d.divisionTeamCap})</span>
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" className={styles.addDivisionBtn} onClick={handleOpenCreateModal}>
                    <Plus size={16} />
                    <span>Add Division</span>
                  </button>
                </div>

                {activeDivision && (
                  <div className={styles.desktop2aGrid}>
                    {/* Left Column: Registered Teams Table */}
                    <div className={styles.desktop2aMainCol}>
                      <section className={styles.card}>
                        <div className={styles.cardHeader}>
                          <div className={styles.iconHeader}>
                            <Users size={20} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <h3 className={styles.cardTitle}>Registered Teams</h3>
                              {(() => {
                                const sum = overview?.divisions.find(o => o.id === activeDivision.id);
                                const confirmed = sum?.confirmed ?? confirmedTeams.length;
                                const badge = getOrganizerDivisionBadge({
                                  name: activeDivision.name,
                                  cap: activeDivision.divisionTeamCap,
                                  filled: confirmed,
                                  registrationOpens: activeDivision.registrationOpenDate || '',
                                  registrationCloses: activeDivision.registrationCloseDate || '',
                                  isDrawLocked: sum?.drawLocked,
                                });
                                return <Badge variant={badge.variant}>{badge.label}</Badge>;
                              })()}
                            </div>
                            <p className={styles.subtitle}>
                              {confirmedTeams.length} of {activeDivision.divisionTeamCap} seats filled
                              {' · '}
                              {unpaidCount > 0 ? `${unpaidCount} unpaid` : 'all paid'}
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button type="button" className={styles.btnGhost} onClick={openAddTeamModal}>
                              <UserPlus size={15} /> Add Team
                            </button>
                            <div style={{ position: 'relative' }}>
                              <button type="button" className={styles.btnGhost} onClick={() => setShowImportMenu(v => !v)} disabled={importing}>
                                <FileSpreadsheet size={15} /> {importing ? 'Importing…' : 'Import'} <ChevronDown size={14} />
                              </button>
                              {showImportMenu && (
                                <>
                                  <div className={styles.importMenuBackdrop} onClick={() => setShowImportMenu(false)} />
                                  <div className={styles.importMenu}>
                                    <button type="button" className={styles.importMenuItem} onClick={downloadTeamTemplate}>
                                      <Download size={15} /> Download CSV template
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.importMenuItem}
                                      onClick={() => { setShowImportMenu(false); importFileInputRef.current?.click(); }}
                                    >
                                      <UploadCloud size={15} /> Upload CSV file
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              className={styles.btnGhost}
                              onClick={exportRegistrations}
                              disabled={registeredTeams.length === 0}
                              title="Download every registration field as CSV"
                            >
                              <Download size={15} /> Export
                            </button>
                            <input ref={importFileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />
                          </div>
                        </div>
                        <div className={styles.sectionBody}>
                          {/* Search + status filter, both scoped to this division */}
                          <div className={styles.teamsControls}>
                            <div className={styles.teamsSearch}>
                              <Search size={16} className={styles.teamsSearchIcon} />
                              <input
                                type="search"
                                className={styles.teamsSearchInput}
                                placeholder="Search players or number"
                                value={teamQuery}
                                onChange={e => setTeamQuery(e.target.value)}
                              />
                            </div>
                            <div className={styles.segmented} role="group" aria-label="Filter teams">
                              {TEAM_FILTERS.map(f => (
                                <button
                                  key={f}
                                  type="button"
                                  className={`${styles.segmentedBtn} ${teamFilter === f ? styles.segmentedBtnActive : ''}`}
                                  aria-pressed={teamFilter === f}
                                  onClick={() => setTeamFilter(f)}
                                >
                                  {f}
                                </button>
                              ))}
                            </div>
                          </div>

                          {importError && <div className={styles.importErrorBanner}>{importError}</div>}
                          {importSummary && !importError && <div className={styles.importSuccessBanner}>{importSummary}</div>}
                          {rowError && <div className={styles.importErrorBanner}>{rowError}</div>}

                          {/* Promoting past the cap is allowed — this is how
                              the organizer squares it up afterwards. */}
                          {overCap && (
                            <div className={styles.overCapBanner}>
                              <p className={styles.overCapNote}>
                                Over team cap — {confirmedTeams.length} teams in a {activeDivision.divisionTeamCap}-team division.
                              </p>
                              <button
                                type="button"
                                className={styles.overCapBtn}
                                disabled={capBusy}
                                onClick={() => raiseCapTo(activeDivision, confirmedTeams.length)}
                              >
                                {capBusy ? 'Raising…' : `Raise cap to ${confirmedTeams.length}`}
                              </button>
                            </div>
                          )}

                          {teamsLoading ? (
                            <p className={styles.summaryText}>Loading registered teams…</p>
                          ) : registeredTeams.length === 0 ? (
                            <p className={styles.summaryText}>No teams registered yet for this division.</p>
                          ) : noTeamsMatch ? (
                            <p className={styles.summaryText}>No teams match this filter.</p>
                          ) : (
                            <table className={styles.teamsTable}>
                              <thead>
                                <tr>
                                  <th style={{ width: '60px' }}>No.</th>
                                  <th>Players</th>
                                  <th style={{ width: '150px' }}>Contact</th>
                                  <th style={{ width: '110px' }}>Payment</th>
                                  <th style={{ width: '84px', textAlign: 'right' }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleConfirmed.map((t, idx) => (
                                  <TeamRow
                                    key={t.id}
                                    team={t}
                                    index={idx + 1}
                                    busy={rowBusy === t.id}
                                    onOpen={() => openTeamDetail(t)}
                                    onTogglePayment={() => toggleTeamPayment(t)}
                                    onRemove={() => setConfirmRemove(t)}
                                  />
                                ))}

                                {visibleWaitlist.length > 0 && (
                                  <tr>
                                    <td colSpan={5} className={styles.waitlistSeparatorCell}>
                                      <div className={styles.waitlistSeparator}>
                                        <span className={styles.waitlistTag}>Waiting list</span>
                                        <span className={styles.waitlistNote}>
                                          {waitlistTeamsList.length} waiting · promote when a seat frees up
                                        </span>
                                        <span className={styles.waitlistRule} />
                                      </div>
                                    </td>
                                  </tr>
                                )}

                                {visibleWaitlist.map((t, idx) => (
                                  <TeamRow
                                    key={t.id}
                                    team={t}
                                    index={idx + 1}
                                    waitlisted
                                    busy={rowBusy === t.id}
                                    onOpen={() => openTeamDetail(t)}
                                    onPromote={() => promoteTeam(t)}
                                    onRemove={() => setConfirmRemove(t)}
                                  />
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </section>
                    </div>

                    {/* Right Column: Division Details & Setup Sidebar */}
                    <div className={styles.desktop2aSidebar}>
                      <section className={styles.card}>
                        <div className={styles.divisionSidebarHead}>
                          <span className={styles.divisionRingLarge}>
                            {confirmedTeams.length}/{activeDivision.divisionTeamCap}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 className={styles.cardTitle}>{activeDivision.name}</h3>
                            <p className={styles.cardSubtitle}>
                              {activeDivision.genderEligibility}
                              {activeDivision.ageLimit ? ` · ${ageLimitLabel(activeDivision.ageLimit)}` : ''}
                              {' · '}{activeDivision.formatTypeOnSand}
                            </p>
                          </div>
                        </div>

                        <div className={styles.sectionBody}>
                          {/* Section 1: Capacity & Format */}
                          <div className={styles.summaryGrid} style={{ gridTemplateColumns: '1fr 1fr' }}>
                            <div className={styles.summaryItem}><span>Team Cap</span><strong>{activeDivision.divisionTeamCap} teams</strong></div>
                            <div className={styles.summaryItem}><span>Format</span><strong>{activeDivision.formatTypeOnSand}</strong></div>
                            <div className={styles.summaryItem}><span>Max Roster</span><strong>{activeDivision.maxRosterSize} players</strong></div>
                            <div className={styles.summaryItem}><span>Opens</span><strong>{activeDivision.registrationOpenDate ? safeFormatDate(activeDivision.registrationOpenDate) : 'Immediately'}</strong></div>
                          </div>

                          <hr className={styles.divider} />

                          {/* Section 2: Eligibility, Net Height & Rules */}
                          <div className={styles.summaryGrid} style={{ gridTemplateColumns: '1fr 1fr' }}>
                            <div className={styles.summaryItem}><span>Gender</span><strong>{activeDivision.genderEligibility}</strong></div>
                            <div className={styles.summaryItem}><span>Age limit</span><strong>{ageLimitLabel(activeDivision.ageLimit)}</strong></div>
                            <div className={styles.summaryItem}><span>Net Height</span><strong>{activeDivision.netHeight}</strong></div>
                          </div>

                          {activeDivision.rules && (
                            <div className={styles.fieldGroup} style={{ marginTop: 8 }}>
                              <span className={styles.summaryLabelSubtle}>Rules</span>
                              <p className={styles.summaryText} style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{activeDivision.rules}</p>
                            </div>
                          )}

                          <hr className={styles.divider} />

                          {/* Section 3: Fee (Larger highlight) */}
                          <div className={styles.feeHighlight}>
                            <span className={styles.feeHighlightLabel}>Registration Fee</span>
                            <span className={styles.feeHighlightValue}>
                              {activeDivision.registrationFee === 0 ? 'Free' : `${activeDivision.registrationFee} THB`}
                            </span>
                          </div>

                          <hr className={styles.divider} />

                          {/* Section 4: Competition rounds */}
                          <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel}>Competition rounds</label>
                            <div className={styles.roundList}>
                              {activeDivision.rounds.map((r, i) => {
                                const formatLabel = ROUND_FORMATS.find(f => f.value === r.format)?.label ?? '—';
                                const sets = r.scoring?.setsBestOf || 3;
                                const matchText = sets === 1 ? '1 Set' : `Best of ${sets}`;
                                const pts = r.scoring?.pointsPerSet || 21;
                                const deciding = r.scoring?.decidingSetPoints || 15;
                                const winBy2 = r.scoring?.winBy2 !== false;
                                const cap = r.scoring?.hardCap || 0;
                                const scorePattern = sets === 1 ? `To ${pts}` : sets === 5 ? `${pts}-${pts}-${pts}-${pts}-${deciding}` : `${pts}-${pts}-${deciding}`;
                                const scoreLine = `${scorePattern}${winBy2 ? ' (win by 2)' : ''}${cap > 0 ? ` cap ${cap}` : ''}`;
                                const isRoundRobin = r.format === 'round-robin';
                                const nextRound = activeDivision.rounds[i + 1] ?? null;
                                const showAdvance = isRoundRobin && nextRound !== null;
                                const showCrossing = showAdvance && nextRound.format !== 'round-robin';

                                return (
                                  <div key={r.id} className={styles.roundCard}>
                                    <div className={styles.roundCardHead}>
                                      <span className={styles.roundIndex}>R{i + 1}</span>
                                      <span className={styles.roundTitleText}>{formatLabel}</span>
                                    </div>
                                    <div className={styles.roundDetailsList}>
                                      <div className={styles.roundDetailLine}>{matchText}</div>
                                      <div className={styles.roundDetailLine}>{scoreLine}</div>
                                      {showAdvance && (
                                        <div className={styles.roundDetailLine}>Top {activeDivision.advancePerPool || 2} advance</div>
                                      )}
                                      {showCrossing && (
                                        <div className={styles.roundDetailLine}>
                                          Crossing: {activeDivision.crossing === 'static' ? 'Static Cross-Bracket' : 'FIVB'}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <hr className={styles.divider} />

                          <div className={styles.divActions} style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
                            <button type="button" className={styles.btnGhost} onClick={() => handleEditDivision(activeDivision.id)}>
                              <Pencil size={15} /> Edit Division
                            </button>
                            <button type="button" className={styles.btnRemove} onClick={() => removeDivision(activeDivision.id)} aria-label="Delete division">
                              <Trash2 size={16} /> Delete
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

                {/* ── Mobile: divisions, teams (1A) ────────── */}
                <div className={styles.mobileOnly}>
                  {/* Mobile division tabs */}

                  {/* Mobile had no way to change division at all before this. */}
                  {divisionCards.length > 0 && (
                    <div className={styles.mobileDivTabs}>
                      {divisionCards.map(card => (
                        <button
                          key={card.id}
                          type="button"
                          className={`${styles.mobileDivTab} ${card.active ? styles.mobileDivTabActive : ''}`}
                          onClick={() => setActiveDivisionId(card.id)}
                          aria-pressed={card.active}
                        >
                          {card.name}
                        </button>
                      ))}
                      {/* Adding a division belongs at the end of the list
                          it adds to. Dashed, so it reads as the slot for
                          one more rather than as a division itself. */}
                      <button
                        type="button"
                        className={styles.mobileDivAdd}
                        onClick={handleOpenCreateModal}
                      >
                        <Plus size={15} />
                        <span>New Division</span>
                      </button>
                    </div>
                  )}

                  {activeDivision && (
                    <>
                      {/* Registration sits with the division toggle rather
                          than in the stat row: it is the one number here
                          that moves, and a bar answers "how full" at a
                          glance where "3/16" has to be read and divided.
                          The row below keeps the four settings, which do
                          not change on their own. */}
                      <div className={styles.mobileFillRow}>
                        <div className={styles.mobileFillHead}>
                          <span className={styles.mobileFillCount}>
                            {confirmedTeams.length}/{activeDivision.divisionTeamCap} teams
                          </span>
                          <span className={styles.mobileFillNote}>
                            {isDivisionFull
                              ? 'Division full'
                              : `${activeDivision.divisionTeamCap - confirmedTeams.length} spots left`}
                          </span>
                        </div>
                        <div className={styles.mobileTeamsBar}>
                          <div
                            className={styles.mobileTeamsBarFill}
                            style={{ width: `${fillRatio * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* The four settings that used to sit here — gender,
                          fee, format, roster — are all in Division Details
                          just below, which is open by default. Repeating
                          them cost a row and gave the phone view no way to
                          act on anything; these two are what the screen is
                          for. */}
                      <div className={styles.mobileActionRow}>
                        <button
                          type="button"
                          className={styles.mobileActionBtn}
                          onClick={() => handleEditDivision(activeDivision.id)}
                        >
                          <Pencil size={15} /> Edit division
                        </button>
                        <button
                          type="button"
                          className={styles.mobileActionBtn}
                          onClick={shareEvent}
                        >
                          <Share2 size={15} /> {liveLinkCopied ? 'Link copied' : 'Share'}
                        </button>
                      </div>

                      <div className={styles.mobileDetailsCard}>
                        <button
                          type="button"
                          className={styles.mobileDetailsHeader}
                          onClick={() => setDetailsCollapsed(!detailsCollapsed)}
                        >
                          Division Details
                          {detailsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        </button>
                        {!detailsCollapsed && (
                          <div className={styles.mobileDetailsBody}>
                            {/* Section 1: Capacity & Format */}
                            <div className={styles.summaryGrid} style={{ gridTemplateColumns: '1fr 1fr' }}>
                              <div className={styles.summaryItem}><span>Team Cap</span><strong>{activeDivision.divisionTeamCap} teams</strong></div>
                              <div className={styles.summaryItem}><span>Format</span><strong>{activeDivision.formatTypeOnSand}</strong></div>
                              <div className={styles.summaryItem}><span>Max Roster</span><strong>{activeDivision.maxRosterSize} players</strong></div>
                              <div className={styles.summaryItem}><span>Opens</span><strong>{activeDivision.registrationOpenDate ? safeFormatDate(activeDivision.registrationOpenDate) : 'Immediately'}</strong></div>
                            </div>

                            <hr className={styles.divider} />

                            {/* Section 2: Eligibility, Net Height & Rules */}
                            <div className={styles.summaryGrid} style={{ gridTemplateColumns: '1fr 1fr' }}>
                              <div className={styles.summaryItem}><span>Gender</span><strong>{activeDivision.genderEligibility}</strong></div>
                              <div className={styles.summaryItem}><span>Age limit</span><strong>{ageLimitLabel(activeDivision.ageLimit)}</strong></div>
                              <div className={styles.summaryItem}><span>Net Height</span><strong>{activeDivision.netHeight}</strong></div>
                            </div>

                            {activeDivision.rules && (
                              <div className={styles.fieldGroup} style={{ marginTop: 6 }}>
                                <span className={styles.summaryLabelSubtle}>Rules</span>
                                <p className={styles.summaryText} style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{activeDivision.rules}</p>
                              </div>
                            )}

                            <hr className={styles.divider} />

                            {/* Section 3: Fee (Larger highlight) */}
                            <div className={styles.feeHighlight}>
                              <span className={styles.feeHighlightLabel}>Registration Fee</span>
                              <span className={styles.feeHighlightValue}>
                                {activeDivision.registrationFee === 0 ? 'Free' : `${activeDivision.registrationFee} THB`}
                              </span>
                            </div>

                            <hr className={styles.divider} />

                            {/* Section 4: Competition rounds */}
                            <div className={styles.fieldGroup}>
                              <label className={styles.fieldLabel}>Competition rounds</label>
                              <div className={styles.roundList}>
                                {activeDivision.rounds.map((r, i) => {
                                  const formatLabel = ROUND_FORMATS.find(f => f.value === r.format)?.label ?? '—';
                                  const sets = r.scoring?.setsBestOf || 3;
                                  const matchText = sets === 1 ? '1 Set' : `Best of ${sets}`;
                                  const pts = r.scoring?.pointsPerSet || 21;
                                  const deciding = r.scoring?.decidingSetPoints || 15;
                                  const winBy2 = r.scoring?.winBy2 !== false;
                                  const cap = r.scoring?.hardCap || 0;
                                  const scorePattern = sets === 1 ? `To ${pts}` : sets === 5 ? `${pts}-${pts}-${pts}-${pts}-${deciding}` : `${pts}-${pts}-${deciding}`;
                                  const scoreLine = `${scorePattern}${winBy2 ? ' (win by 2)' : ''}${cap > 0 ? ` cap ${cap}` : ''}`;
                                  const isRoundRobin = r.format === 'round-robin';
                                  const nextRound = activeDivision.rounds[i + 1] ?? null;
                                  const showAdvance = isRoundRobin && nextRound !== null;
                                  const showCrossing = showAdvance && nextRound.format !== 'round-robin';

                                  return (
                                    <div key={r.id} className={styles.roundCard}>
                                      <div className={styles.roundCardHead}>
                                        <span className={styles.roundIndex}>R{i + 1}</span>
                                        <span className={styles.roundTitleText}>{formatLabel}</span>
                                      </div>
                                      <div className={styles.roundDetailsList}>
                                        <div className={styles.roundDetailLine}>{matchText}</div>
                                        <div className={styles.roundDetailLine}>{scoreLine}</div>
                                        {showAdvance && (
                                          <div className={styles.roundDetailLine}>Top {activeDivision.advancePerPool || 2} advance</div>
                                        )}
                                        {showCrossing && (
                                          <div className={styles.roundDetailLine}>
                                            Crossing: {activeDivision.crossing === 'static' ? 'Static Cross-Bracket' : 'FIVB'}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className={styles.mobileTeamsCard}>
                        <div className={styles.mobileTeamsHeader}>
                          <h3>Registered Teams</h3>
                          <span className={styles.mobileTeamsCount}>{confirmedTeams.length}/{activeDivision.divisionTeamCap}</span>
                        </div>
                        {teamsLoading ? (
                          <p className={styles.summaryText}>Loading registered teams…</p>
                        ) : registeredTeams.length === 0 ? (
                          <p className={styles.summaryText}>No teams registered yet.</p>
                        ) : (
                          <>
                            {visibleConfirmed.map((t, idx) => (
                              <MobileSwipeRow
                                key={t.id}
                                label={t.players.length > 0 ? joinTeamName(t.players.map(p => p.name)) : t.name}
                                open={swipedTeamId === t.id}
                                onOpenChange={next => setSwipedTeamId(next ? t.id : null)}
                                onRemove={() => setConfirmRemove(t)}
                                disabled={rowBusy === t.id}
                              >
                              <div
                                className={`${styles.mobileTeamRow} ${styles.teamRowClickable}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => openTeamDetail(t)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTeamDetail(t); }
                                }}
                              >
                                <span className={styles.mobileTeamRank}>{idx + 1}</span>
                                <span className={styles.mobileTeamCol}>
                                  <span className={styles.mobileTeamName}>
                                    {t.players.length > 0 ? joinTeamName(t.players.map(p => p.name)) : t.name}
                                  </span>
                                  {t.players[0]?.phone && (
                                    <span className={styles.mobileTeamPhone}>{t.players[0].phone}</span>
                                  )}
                                </span>
                                {/* 44px tap target, per the design's mobile frame. */}
                                <button
                                  type="button"
                                  className={t.paymentCleared ? styles.mobilePillPaid : styles.mobilePillUnpaid}
                                  disabled={rowBusy === t.id}
                                  onClick={e => { e.stopPropagation(); toggleTeamPayment(t); }}
                                >
                                  {t.paymentCleared ? 'Paid' : 'Unpaid'}
                                </button>
                              </div>
                              </MobileSwipeRow>
                            ))}

                            {visibleWaitlist.length > 0 && (
                              <>
                                <div className={styles.mobileWaitlistHeader}>
                                  <span className={styles.mobileWaitlistDot} />
                                  Waiting List · {waitlistTeamsList.length}
                                </div>
                                {visibleWaitlist.map((t, idx) => (
                                  <MobileSwipeRow
                                    key={t.id}
                                    label={t.players.length > 0 ? joinTeamName(t.players.map(p => p.name)) : t.name}
                                    open={swipedTeamId === t.id}
                                    onOpenChange={next => setSwipedTeamId(next ? t.id : null)}
                                    onRemove={() => setConfirmRemove(t)}
                                    disabled={rowBusy === t.id}
                                  >
                                  <div
                                    className={`${styles.mobileTeamRow} ${styles.teamRowClickable}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openTeamDetail(t)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTeamDetail(t); }
                                    }}
                                  >
                                    <span className={`${styles.mobileTeamRank} ${styles.mobileTeamRankWaitlist}`}>{idx + 1}</span>
                                    <span className={styles.mobileTeamCol}>
                                      <span className={styles.mobileTeamName}>
                                        {t.players.length > 0 ? joinTeamName(t.players.map(p => p.name)) : t.name}
                                      </span>
                                      {t.players[0]?.phone && (
                                        <span className={styles.mobileTeamPhone}>{t.players[0].phone}</span>
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      className={styles.mobileMoveUpBtn}
                                      disabled={rowBusy === t.id}
                                      onClick={e => { e.stopPropagation(); promoteTeam(t); }}
                                    >
                                      Move Up
                                    </button>
                                  </div>
                                  </MobileSwipeRow>
                                ))}
                              </>
                            )}
                          </>
                        )}
                        {noTeamsMatch && (
                          <p className={styles.summaryText}>No teams match this filter.</p>
                        )}
                        <button type="button" className={styles.mobileAddTeamBtn} onClick={openAddTeamModal}>
                          <UserPlus size={16} /> Add Team
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

            </main>

      {/* ── COVER IMAGE LIGHTBOX ──────────────────────────────────────
          Clicking the cover shows it at full size. Replacing the image is
          the Edit Tournament form's job, so it is not offered here. */}
      {lightboxOpen && basicInfo?.imageUrl && (
        <div
          className={styles.lightboxOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Cover image"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={() => setLightboxOpen(false)}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          <img
            src={basicInfo.imageUrl}
            alt={displayTitle ? `${displayTitle} cover` : 'Tournament cover'}
            className={styles.lightboxImage}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── REMOVE TEAM CONFIRM ───────────────────────────────────────
          A removal deletes a real registration and, when it frees a seat,
          moves the first waitlisted team into it — both worth saying out
          loud before it happens. */}
      {confirmRemove && (
        <div className={styles.modalOverlay}>
          <div className={styles.confirmDialog}>
            <h3 className={styles.confirmTitle}>Remove this team?</h3>
            <p className={styles.confirmBody}>
              <strong>
                {confirmRemove.players.length > 0
                  ? joinTeamName(confirmRemove.players.map(p => p.name))
                  : confirmRemove.name}
              </strong>{' '}
              will be removed from {activeDivision?.name}, along with their registration details.
              This cannot be undone.
              {confirmRemove.status !== 'waitlist' && waitlistTeamsList.length > 0 && (
                <> The first team on the waiting list will take the freed seat.</>
              )}
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.btnGhost} onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={rowBusy === confirmRemove.id}
                onClick={() => removeTeam(confirmRemove)}
              >
                {rowBusy === confirmRemove.id ? 'Removing…' : 'Remove team'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE DIVISION MODAL ─────────────────────────────────── */}
      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modalContent} ${styles.divisionModalContent}`}>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitleGroup}>
                <h3>{editingDivisionId ? 'Edit Division' : 'Create New Division'}</h3>
                <p className={styles.modalSubtitle}>
                  {basicInfo?.title || 'Tournament'} — {divName.trim() ? divName.trim() : editingDivisionId ? 'Division' : 'New Division'}
                </p>
              </div>
              <button className={styles.modalCloseBtnCircle} onClick={() => setShowModal(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* ── Step navigation line ─────────────────────────── */}
            <div className={styles.modalSteps}>
              {MODAL_STEPS.map((label, i) => (
                <div key={label} className={styles.modalStepRow}>
                  <button
                    type="button"
                    className={`${styles.modalStepItem} ${i === modalStep ? styles.modalStepActive : ''} ${i < modalStep ? styles.modalStepDone : ''}`}
                    onClick={() => goToModalStep(i)}
                  >
                    <span className={styles.modalStepDot}>
                      {i < modalStep ? <Check size={14} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={styles.modalStepLabel}>{label}</span>
                  </button>
                  {i < MODAL_STEPS.length - 1 && (
                    <span className={`${styles.modalStepLine} ${i < modalStep ? styles.modalStepLineDone : ''}`} />
                  )}
                </div>
              ))}
            </div>

            <div className={styles.modalBody}>
              {formError && (
                <div className={styles.modalFormError}>{formError}</div>
              )}

              {/* ══ Step 1: Basics & Fee ═════════════════════════ */}
              {modalStep === 0 && (
              <>
              {/* ── A. Basics & Capacity ─────────────────────────── */}
              <div className={styles.stepCard}>
                <span className={styles.stepCardEyebrow}>Basics &amp; Capacity</span>

                <div className={styles.stepFieldBlock}>
                  <label className={styles.stepFieldLabel}>
                    Division Name <span className={styles.asteriskOrange}>*</span>
                  </label>
                  <input
                    type="text"
                    className={styles.stepNameInput}
                    placeholder="e.g. Women's Open, Mixed 4s"
                    value={divName}
                    onChange={e => { setDivName(e.target.value); setFormError(null); }}
                  />
                </div>

                <div className={styles.tileGrid}>
                  <div className={styles.creamTile}>
                    <span className={styles.creamTileLabel}>Team cap</span>
                    <div className={styles.creamTileInputRow}>
                      <input
                        type="number"
                        className={styles.creamTileNumberInput}
                        min={2}
                        value={divCap}
                        onChange={e => setDivCap(parseInt(e.target.value) || 8)}
                      />
                      <span className={styles.creamTileSuffix}>teams</span>
                    </div>
                  </div>

                  <div className={styles.creamTile}>
                    <span className={styles.creamTileLabel}>Format</span>
                    <div className={styles.creamTileSelectRow}>
                      <select
                        className={styles.creamTileSelect}
                        value={formatType}
                        onChange={e => handleFormatChange(e.target.value as OnSandFormat)}
                      >
                        <option value="2v2">2 v 2</option>
                        <option value="3v3">3 v 3</option>
                        <option value="4v4">4 v 4</option>
                        <option value="6v6">6 v 6</option>
                      </select>
                      <ChevronDown size={15} className={styles.creamTileChevron} />
                    </div>
                  </div>

                  <div className={styles.creamTile}>
                    <span className={styles.creamTileLabel}>Max roster size</span>
                    <div className={styles.creamTileInputRow}>
                      <input
                        type="number"
                        className={styles.creamTileNumberInput}
                        min={FORMAT_PLAYERS[formatType]}
                        value={maxRoster}
                        onChange={e => { setMaxRoster(parseInt(e.target.value) || 0); setFormError(null); }}
                      />
                      <span className={styles.creamTileSuffix}>players</span>
                    </div>
                  </div>

                  {/* A property of how the court is set up, so it belongs
                      with the format rather than buried in the advanced
                      panel on step 3, which is where it used to live. */}
                  <div className={styles.creamTile}>
                    <span className={styles.creamTileLabel}>Net height</span>
                    <div className={styles.creamTileInputRow}>
                      <input
                        type="number"
                        className={styles.creamTileNumberInput}
                        min={0}
                        max={5}
                        step={0.01}
                        title="Standard: men 2.43 m, women 2.24 m"
                        value={netHeightDigits(netHeight)}
                        onChange={e => setNetHeight(e.target.value ? `${e.target.value}m` : '')}
                      />
                      <span className={styles.creamTileSuffix}>m</span>
                    </div>
                  </div>
                </div>

                <div className={styles.stepDivider} />

                <div className={styles.stepSubGroup}>
                  <span className={styles.stepCardEyebrowMuted}>Eligibility</span>
                  <div className={styles.tileGrid}>
                    <div className={styles.creamTile}>
                      <span className={styles.creamTileLabel}>Gender</span>
                      <div className={styles.creamTileSelectRow}>
                        <select
                          className={styles.creamTileSelect}
                          value={genderEligibility}
                          onChange={e => setGenderEligibility(e.target.value as DivisionGender)}
                        >
                          {DIVISION_GENDERS.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                        <ChevronDown size={15} className={styles.creamTileChevron} />
                      </div>
                    </div>

                    <div className={styles.creamTile}>
                      <span className={styles.creamTileLabel}>Age limit</span>
                      <div className={styles.creamTileSelectRow}>
                        <select
                          className={styles.creamTileSelect}
                          value={ageLimit}
                          onChange={e => setAgeLimit(e.target.value as AgeLimit)}
                        >
                          {AGE_LIMITS.map(a => (
                            <option key={a || 'none'} value={a}>{ageLimitLabel(a)}</option>
                          ))}
                        </select>
                        <ChevronDown size={15} className={styles.creamTileChevron} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── B. Fees ──────────────────────────────────────── */}
              <div className={styles.stepCard}>
                <span className={styles.stepCardEyebrow}>Fees</span>
                <div className={styles.feeRow}>
                  <div className={styles.feeBox}>
                    <div className={styles.feeCurrencyWrap}>
                      <select
                        className={styles.feeCurrencySelect}
                        value={currency}
                        onChange={e => setCurrency(e.target.value)}
                        aria-label="Currency"
                      >
                        {CURRENCIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className={styles.feeCurrencyChevron} />
                    </div>
                    <input
                      type="number"
                      className={styles.feeAmountInput}
                      min={0}
                      value={regFee}
                      onChange={e => setRegFee(parseInt(e.target.value) || 0)}
                      aria-label="Registration fee per team"
                    />
                    <span className={styles.feeSuffix}>per team</span>
                  </div>
                  <span className={styles.feeTotalText}>
                    Full division collects {CURRENCY_SYMBOLS[currency] ?? ''}
                    {(divCap * regFee).toLocaleString('en-US')} at {divCap} teams
                  </span>
                </div>
              </div>
              </>
              )}

              {/* ══ Step 2: Format & Rules ═══════════════════════ */}
              {modalStep === 1 && (
              <>
              {/* ── C. Rules & Formats ───────────────────────────── */}
              <div className={styles.fieldGroup}>
                <h4 className={styles.sectionTitleWithAsterisk}>
                  Competition Format <span className={styles.asteriskOrange}>*</span>
                </h4>
                {rebuildsBracket && (
                  <div className={styles.modalFormError} style={{ marginTop: 8 }}>
                    Adding, removing or re-ordering a round changes the shape of the bracket, so saving will
                    rebuild it — every match already drawn for this division, and its saved schedule, will be
                    deleted. Leave the rounds as they are to keep them.
                  </div>
                )}
                <div className={styles.roundsList}>
                  {rounds.map((round, i) => (
                    <div key={round.id} className={styles.roundCardNew}>
                      <div className={styles.roundCardHeader}>
                        <div className={styles.roundHeaderLeft}>
                          <span className={styles.roundBadge}>{roundBadgeLabel(i)}</span>
                          <div className={styles.roundTitleGroup}>
                            <span className={styles.roundName}>{roundLabel(i)}</span>
                            <span className={styles.roundSummaryText}>
                              {getRoundSummaryText(round)}
                            </span>
                          </div>
                        </div>
                        {rounds.length > 1 && (
                          <button
                            type="button"
                            className={styles.roundCardDeleteBtn}
                            onClick={() => removeRound(round.id)}
                            aria-label={`Remove ${roundLabel(i)}`}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>

                      {/* 3-Column Format Cards */}
                      <div className={styles.formatCardsGrid}>
                        {ROUND_FORMAT_CARDS.map(opt => {
                          const isActive = round.format === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={`${styles.formatCard} ${isActive ? styles.formatCardActive : ''}`}
                              onClick={() => setRoundFormat(round.id, opt.value)}
                            >
                              <span className={styles.formatCardTitle}>{opt.label}</span>
                              <span className={styles.formatCardDesc}>{opt.desc}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Match & Scoring Section */}
                      {round.format !== null && (
                        <div className={styles.formatSubSection}>
                          <div className={styles.formatSubSectionHeader}>MATCH &amp; SCORING</div>
                          <div className={styles.scoringTilesGrid}>
                            {/* 1. MATCH LENGTH */}
                            <div className={styles.creamTile}>
                              <span className={styles.creamTileLabel}>MATCH LENGTH</span>
                              <div className={styles.creamTileInputRow}>
                                <input
                                  type="number"
                                  className={styles.creamTileNumberInput}
                                  min={5}
                                  max={240}
                                  step={5}
                                  value={round.durationMinutes}
                                  onChange={e => setRoundDuration(round.id, parseInt(e.target.value) || 0)}
                                />
                                <span className={styles.creamTileSuffix}>min</span>
                              </div>
                            </div>

                            {/* 2. MATCH */}
                            <div className={styles.creamTile}>
                              <span className={styles.creamTileLabel}>MATCH</span>
                              <div className={styles.creamTileSelectRow}>
                                <select
                                  className={styles.creamTileSelect}
                                  value={round.scoring.setsBestOf}
                                  onChange={e => setRoundScoring(round.id, { setsBestOf: parseInt(e.target.value) })}
                                >
                                  <option value={1}>Best of 1</option>
                                  <option value={3}>Best of 3</option>
                                  <option value={5}>Best of 5</option>
                                </select>
                                <ChevronDown size={15} className={styles.creamTileChevron} />
                              </div>
                            </div>

                            {/* 3. WIN BY 2 */}
                            <div className={styles.creamTile}>
                              <span className={styles.creamTileLabel}>WIN BY 2</span>
                              <div className={styles.creamTileToggleRow}>
                                <label className={styles.creamSwitch}>
                                  <input
                                    type="checkbox"
                                    role="switch"
                                    checked={round.scoring.winBy2}
                                    onChange={e => setRoundScoring(round.id, { winBy2: e.target.checked })}
                                  />
                                  <span className={styles.creamSwitchTrack}>
                                    <span className={styles.creamSwitchThumb} />
                                  </span>
                                </label>
                              </div>
                            </div>

                            {/* 4. WINNING SCORE */}
                            <div className={styles.creamTile}>
                              <span className={styles.creamTileLabel}>WINNING SCORE</span>
                              <div className={styles.creamTileInputRow}>
                                <input
                                  type="number"
                                  className={styles.creamTileNumberInput}
                                  min={1}
                                  value={round.scoring.pointsPerSet}
                                  onChange={e => setRoundScoring(round.id, { pointsPerSet: parseInt(e.target.value) || 0 })}
                                />
                                <span className={styles.creamTileSuffix}>points</span>
                              </div>
                            </div>

                            {/* 5. HARD CAP */}
                            <div className={styles.creamTile}>
                              <span className={styles.creamTileLabel}>HARD CAP</span>
                              <div className={styles.creamTileInputRow}>
                                <input
                                  type="text"
                                  className={styles.creamTileNumberInput}
                                  placeholder="none"
                                  value={round.scoring.hardCap ? round.scoring.hardCap : ''}
                                  onChange={e => {
                                    const val = e.target.value.trim();
                                    const num = parseInt(val, 10);
                                    setRoundScoring(round.id, { hardCap: isNaN(num) ? 0 : num });
                                  }}
                                />
                              </div>
                            </div>

                            {/* 6. DECIDING SET TO */}
                            <div className={styles.creamTile} style={{ opacity: round.scoring.setsBestOf > 1 ? 1 : 0.4 }}>
                              <span className={styles.creamTileLabel}>DECIDING SET TO</span>
                              <div className={styles.creamTileInputRow}>
                                <input
                                  type="number"
                                  className={styles.creamTileNumberInput}
                                  min={1}
                                  disabled={round.scoring.setsBestOf <= 1}
                                  value={round.scoring.decidingSetPoints}
                                  onChange={e => setRoundScoring(round.id, { decidingSetPoints: parseInt(e.target.value) || 0 })}
                                />
                                <span className={styles.creamTileSuffix}>points</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Advancement — only when there is a round to advance
                          into, and only from a round that pools teams. */}
                      {advancementVisibility(rounds, i).showSection && (
                        <div className={styles.formatSubSection}>
                          <div className={styles.formatSubSectionHeader}>ADVANCEMENT</div>
                          <div className={styles.advancementGrid}>
                            <div className={styles.creamTile}>
                              <span className={styles.creamTileLabel}>TEAMS ADVANCING</span>
                              <div className={styles.creamTileInputRow}>
                                <span className={styles.creamTilePrefix}>Top</span>
                                <input
                                  type="number"
                                  className={styles.creamTileNumberInput}
                                  min={1}
                                  max={4}
                                  value={advancePerPool}
                                  onChange={e => {
                                    const v = parseInt(e.target.value, 10);
                                    setAdvancePerPool(isNaN(v) ? 1 : Math.max(1, Math.min(4, v)));
                                  }}
                                />
                                <span className={styles.creamTileSuffix}>per pool</span>
                              </div>
                            </div>

                            {advancementVisibility(rounds, i).showCrossing && (
                              <div className={styles.creamTile}>
                                <span className={styles.creamTileLabel}>CROSSING</span>
                                <div className={styles.creamTileSelectRow}>
                                  <select
                                    className={styles.creamTileSelect}
                                    value={crossing}
                                    onChange={e => setCrossing(e.target.value)}
                                  >
                                    <option value="fivb">FIVB Standard Draw</option>
                                    <option value="static">Static Cross-Bracket A1–D4</option>
                                  </select>
                                  <ChevronDown size={15} className={styles.creamTileChevron} />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  ))}
                </div>
                <button type="button" className={styles.btnAddRoundDashed} onClick={addRound}>
                  <Plus size={16} /> Add Round
                </button>
              </div>

              <div className={styles.rulesSection}>
                <label className={styles.rulesLabel}>
                  Competition Rules <span className={styles.rulesLabelOptional}>(optional)</span>
                </label>
                <textarea
                  className={styles.rulesTextarea}
                  rows={3}
                  placeholder="Standard FIVB Beach Volleyball rules apply."
                  value={divRules}
                  onChange={e => setDivRules(e.target.value)}
                />
              </div>
              </>
              )}

              {/* ══ Step 3: Registration ═════════════════════════ */}
              {modalStep === 2 && (
              <>
              {/* ── Registration window ─────────────────────────── */}
              <div className={styles.stepCard}>
                <div className={styles.stepCardHead}>
                  <span className={styles.stepCardEyebrow}>Registration Window</span>
                  <span className={styles.stepCardDesc}>
                    The division takes new teams between these two dates.
                  </span>
                </div>

                <div className={styles.tileGrid}>
                  <div className={styles.creamTile}>
                    <span className={styles.creamTileLabel}>Registration opens</span>
                    <input
                      type="date"
                      className={styles.creamTileDateInput}
                      value={regOpenDate}
                      onChange={e => setRegOpenDate(e.target.value)}
                    />
                  </div>
                  <div className={styles.creamTile}>
                    <span className={styles.creamTileLabel}>Registration closes</span>
                    <input
                      type="date"
                      className={styles.creamTileDateInput}
                      value={regCloseDate}
                      onChange={e => setRegCloseDate(e.target.value)}
                    />
                  </div>
                </div>

                <span className={styles.fieldHint}>
                  {regOpenDate && regCloseDate
                    ? `Open ${safeFormatDate(regOpenDate)} → closes ${safeFormatDate(regCloseDate)}. Closing defaults to a week before the tournament.`
                    : 'Closing defaults to a week before the tournament. After the close date the division stops taking new teams.'}
                </span>
              </div>

              {/* ── Registration form ───────────────────────────── */}
              <div className={styles.stepCard}>
                <div className={styles.stepCardHead}>
                  <span className={styles.stepCardEyebrow}>Registration Form</span>
                  <span className={styles.stepCardDesc}>
                    This form is bound to this division only. Toggle <b>Required</b> on any field.
                  </span>
                </div>

                {([
                  { key: 'contact' as const, title: '1 · Team contact', hint: 'who the organizer reaches' },
                  { key: 'players' as const, title: '2 · Players', hint: 'collected per player on the team' },
                ]).map(section => {
                  const fields = regFields.filter(f => regFieldSection(f) === section.key);
                  if (fields.length === 0) return null;
                  return (
                    <div key={section.key} className={styles.regSection}>
                      <div className={styles.regSectionHead}>
                        <span className={styles.regSectionTitle}>{section.title}</span>
                        <span className={styles.regSectionHint}>{section.hint}</span>
                      </div>

                      {fields.map(f => (
                        <div key={f.id} className={styles.regFieldRow}>
                          <div className={styles.regFieldMain}>
                            {/* A custom question is the organizer's own wording, so
                                its label stays editable. Core and preset fields are
                                named by the platform and only read out. */}
                            {f.core || f.preset ? (
                              <div className={styles.regFieldText}>
                                <span className={styles.regFieldLabel}>{f.label}</span>
                                <span className={styles.regFieldType}>{regFieldTypeLabel(f)}</span>
                              </div>
                            ) : (
                              <input
                                type="text"
                                className={styles.regFieldLabelInput}
                                placeholder="Field label (e.g. Team walk-out song?)"
                                value={f.label}
                                onChange={e => updateRegField(f.id, { label: e.target.value })}
                              />
                            )}

                            {/* The base form is always collected, so its pill states
                                that rather than offering a choice that isn't one. */}
                            <button
                              type="button"
                              className={`${styles.regRequiredPill} ${f.required ? styles.regRequiredPillOn : ''}`}
                              disabled={f.core}
                              title={f.core ? 'Always collected' : 'Toggle whether this answer is required'}
                              onClick={() => updateRegField(f.id, { required: !f.required })}
                            >
                              Required
                            </button>

                            {f.core ? (
                              <span className={styles.regFieldLocked} aria-label="Always collected">—</span>
                            ) : (
                              <button
                                type="button"
                                className={styles.regFieldRemove}
                                onClick={() => removeRegField(f.id)}
                                aria-label={`Remove ${f.label || 'field'}`}
                              >
                                <X size={15} />
                              </button>
                            )}
                          </div>

                          {!f.core && !f.preset && (
                            <div className={styles.regFieldEditRow}>
                              <select
                                className={styles.select}
                                value={f.type}
                                onChange={e => updateRegField(f.id, { type: e.target.value as RegFieldType })}
                              >
                                <option value="text">Short Text</option>
                                <option value="paragraph">Paragraph</option>
                                <option value="select">Multiple Choice Dropdown</option>
                              </select>
                              {f.type === 'select' && (
                                <input
                                  type="text"
                                  className={styles.input}
                                  placeholder="Options, comma-separated (e.g. Yes, No, Maybe)"
                                  value={(f.options ?? []).join(', ')}
                                  onChange={e => updateRegField(f.id, {
                                    options: e.target.value.split(',').map(o => o.trim()).filter(Boolean),
                                  })}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}

                <div className={styles.regSection}>
                  <span className={styles.regSectionTitle}>Add more fields</span>
                  <div className={styles.regAddRow}>
                    {/* Only what is not already on the form — a field is removed
                        from its row above, not by toggling the chip off. */}
                    {PRESETS.filter(p => !isPresetActive(p.key)).map(p => (
                      <button
                        key={p.key}
                        type="button"
                        className={styles.regAddPill}
                        onClick={() => togglePreset(p.key)}
                      >
                        <Plus size={14} /> {p.label}
                      </button>
                    ))}
                    <button type="button" className={styles.regAddPillNeutral} onClick={addCustomQuestion}>
                      <Plus size={14} /> Custom Question
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Registration response ───────────────────────── */}
              <div className={styles.stepCard}>
                <div className={styles.stepCardHead}>
                  <span className={styles.stepCardEyebrow}>Registration Response</span>
                  <span className={styles.stepCardDesc}>
                    Shown to players right after they successfully register — e.g. a WhatsApp group
                    invite, a Facebook page link, or a QR code to join for announcements.
                  </span>
                </div>

                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="e.g. You're in! 🏐 Join our WhatsApp group for schedule updates: https://chat.whatsapp.com/..."
                  value={confirmationMessage}
                  onChange={e => setConfirmationMessage(e.target.value)}
                />

                {confirmationImage ? (
                  <div className={styles.confirmImagePreview}>
                    <img src={confirmationImage} alt="Registration response attachment" />
                    <button
                      type="button"
                      className={styles.confirmImageRemove}
                      onClick={() => setConfirmationImage('')}
                      aria-label="Remove photo"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : (
                  <label className={styles.regAddPhoto}>
                    <Plus size={15} /> Add Photo (WhatsApp QR, flyer, etc.)
                    <input type="file" accept="image/*" hidden onChange={handleConfirmationImage} />
                  </label>
                )}
              </div>

              {/* Collapsible Advanced / Missing Options */}
              <div className={styles.advancedCollapsible}>
                <button
                  type="button"
                  className={styles.advancedToggleBtn}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span>Advanced Settings (Automatic recommendations)</span>
                  <ChevronDown
                    size={16}
                    style={{
                      transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </button>

                {showAdvanced && (
                  <div className={styles.advancedFieldsPanel}>
                    <p style={{ fontSize: 11.5, color: '#D35400', marginBottom: 12, lineHeight: 1.4 }}>
                      ⚠️ <strong>Missing Parameters Detected:</strong> To ensure high-quality competition scoring and player logistics, we recommend configuring these 4 additional fields:
                    </p>

                    <div className={styles.twoCol}>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>1. Min Teams Count</label>
                        <input
                          type="number"
                          className={styles.input}
                          min={2}
                          value={minTeams}
                          onChange={e => setMinTeams(parseInt(e.target.value) || 4)}
                        />
                      </div>
                      <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>2. Waitlist Cap</label>
                        <input
                          type="number"
                          className={styles.input}
                          min={0}
                          value={waitlistCap}
                          onChange={e => setWaitlistCap(parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    {/* Full width — it holds a whole payout breakdown, and
                        with net height gone there is no field left to pair
                        it with anyway. */}
                    <div className={styles.fieldGroup} style={{ marginTop: 10 }}>
                      <label className={styles.fieldLabel}>3. Prizes &amp; Payout</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. Cash 1st: 50%, 2nd: 30%, 3rd: 20%"
                        value={prizePool}
                        onChange={e => setPrizePool(e.target.value)}
                      />
                    </div>

                    <div className={styles.fieldGroup} style={{ marginTop: 10 }}>
                      <label className={styles.fieldLabel}>4. Allow Multi-Division Play</label>
                      <select
                        className={styles.select}
                        value={allowMulti ? 'yes' : 'no'}
                        onChange={e => setAllowMulti(e.target.value === 'yes')}
                      >
                        <option value="yes">Yes (Allow players to cross-register)</option>
                        <option value="no">No (Strict single-division lock)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              </>
              )}
            </div>
            <div className={styles.modalFooter}>
              {modalStep === 0 ? (
                <button type="button" className={styles.btnModalBack} onClick={() => setShowModal(false)}>Cancel</button>
              ) : (
                <button type="button" className={styles.btnModalBack} onClick={handleModalBack}>
                  Back
                </button>
              )}
              {modalStep < MODAL_STEPS.length - 1 ? (
                <button type="button" className={styles.btnModalNext} onClick={handleModalNext}>
                  Next <ArrowRight size={16} />
                </button>
              ) : (
                <button type="button" className={styles.btnModalNext} onClick={saveDivisionModal} disabled={divisionSaving}>
                  {divisionSaving ? 'Saving…' : editingDivisionId ? 'Save Division' : 'Create Division'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT BASIC INFO MODAL ─────────────────────────────────── */}
      {showBasicInfoEdit && (
        <div className={styles.modalOverlay} onClick={() => setShowBasicInfoEdit(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Edit Basic Info</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowBasicInfoEdit(false)}><X size={18} /></button>
            </div>
            <div className={styles.modalBody}>
              {basicInfoError && <div className={styles.modalFormError}>{basicInfoError}</div>}

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Tournament Name *</label>
                <input className={styles.input} type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Location *</label>
                <input className={styles.input} type="text" value={editLocation} onChange={e => setEditLocation(e.target.value)} />
              </div>

              {/* One control for both dates: a tournament's span is one
                  decision, and two date inputs couldn't show it. */}
              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Tournament dates *</label>
                <DateRangePicker
                  start={editStartDate}
                  end={editEndDate}
                  onChange={(s, e) => {
                    setEditStartDate(s);
                    setEditEndDate(e);
                  }}
                />
              </div>

              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Description</label>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  placeholder="Optional — tell players what to expect..."
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                />
              </div>

              {/* Cover image. The preview is the picked file if there is one,
                  otherwise whatever is saved — unless it has been removed. */}
              <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                <label className={styles.fieldLabel}>Tournament image</label>
                {(() => {
                  const shown = editImagePreview || (editImageRemoved ? '' : basicInfo?.imageUrl ?? '');
                  return shown ? (
                    <div className={styles.editImageRow}>
                      <img src={shown} alt="" className={styles.editImageThumb} />
                      <div className={styles.editImageActions}>
                        <label className={styles.editImageBtn}>
                          <ImagePlus size={15} /> Replace
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setEditImageFile(file);
                              setEditImageRemoved(false);
                              setEditImagePreview(URL.createObjectURL(file));
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className={styles.editImageRemove}
                          onClick={() => {
                            setEditImageFile(null);
                            setEditImagePreview('');
                            setEditImageRemoved(true);
                          }}
                        >
                          <Trash2 size={15} /> Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className={styles.editImageEmpty}>
                      <ImagePlus size={16} /> Add cover image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setEditImageFile(file);
                          setEditImageRemoved(false);
                          setEditImagePreview(URL.createObjectURL(file));
                        }}
                      />
                    </label>
                  );
                })()}
                <p className={styles.fieldHint}>
                  Shown on tournament cards and the event page. PNG/JPEG/WebP, max 5MB.
                </p>
              </div>

              {/* Lifecycle Actions */}
              {basicInfo && (
                <>
                  {basicInfo.archived ? (
                    <div className={styles.statusRow} style={{ marginTop: 16 }}>
                      <div>
                        <span className={styles.statusRowLabel}>Archived Tournament</span>
                        <span className={styles.statusRowBlurb}>
                          This tournament is currently archived and hidden from your active dashboard and public site.
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.btnUnpublish}
                        onClick={handleRestoreTournament}
                        disabled={archiving}
                      >
                        <Archive size={14} /> {archiving ? 'Restoring…' : 'Restore Tournament'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Draft Delete */}
                      {canDelete(basicInfo.phase as Phase) && (
                        <div className={styles.statusRowDanger} style={{ marginTop: 16 }}>
                          <div className={styles.statusRow} style={{ border: 'none', padding: 0 }}>
                            <div>
                              <span className={styles.statusRowLabel}>{DELETE_COPY.label}</span>
                              <span className={styles.statusRowBlurb}>{DELETE_COPY.blurb}</span>
                            </div>
                            {!showDeleteConfirm && (
                              <button
                                type="button"
                                className={styles.btnDanger}
                                onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText(''); setDeleteError(''); }}
                              >
                                <Trash2 size={15} /> Delete tournament
                              </button>
                            )}
                          </div>
                          {showDeleteConfirm && (
                            <div style={{ marginTop: 10 }}>
                              {deleteError && <div className={styles.modalFormError}>{deleteError}</div>}
                              <p className={styles.fieldHint} style={{ marginTop: 0 }}>
                                {DELETE_COPY.confirmHint} Type <strong>{basicInfo.title}</strong> below.
                              </p>
                              <input
                                className={styles.input}
                                type="text"
                                value={deleteConfirmText}
                                onChange={e => setDeleteConfirmText(e.target.value)}
                                placeholder={basicInfo.title}
                              />
                              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                <button
                                  type="button"
                                  className={styles.btnGhost}
                                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError(''); }}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className={styles.btnDanger}
                                  onClick={deleteTournament}
                                  disabled={deleting || deleteConfirmText.trim() !== basicInfo.title}
                                >
                                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Public with 0 teams: Revert to Draft */}
                      {isPublic(basicInfo.phase as Phase) && seatTotals.filled === 0 && (
                        <div className={styles.statusRow} style={{ marginTop: 16 }}>
                          <div>
                            <span className={styles.statusRowLabel}>Unpublish tournament</span>
                            <span className={styles.statusRowBlurb}>
                              Revert this tournament back to a private Draft. It will be hidden from the public homepage and directory until published again.
                            </span>
                          </div>
                          <button
                            type="button"
                            className={styles.btnUnpublish}
                            onClick={handleRevertToDraft}
                            disabled={revertingDraft}
                          >
                            <RotateCcw size={14} /> {revertingDraft ? 'Reverting…' : 'Revert to Draft'}
                          </button>
                        </div>
                      )}

                      {/* Archive tournament */}
                      {seatTotals.filled === 0 && (
                        <div className={styles.statusRow} style={{ marginTop: 16 }}>
                          <div>
                            <span className={styles.statusRowLabel}>Archive tournament</span>
                            <span className={styles.statusRowBlurb}>
                              Hides this tournament from the public site and active dashboard. Divisions, teams, and matches are kept, and you can restore it anytime.
                            </span>
                          </div>
                          <button
                            type="button"
                            className={styles.btnUnpublish}
                            onClick={handleArchiveTournament}
                            disabled={archiving}
                          >
                            <Archive size={14} /> {archiving ? 'Archiving…' : 'Archive Tournament'}
                          </button>
                        </div>
                      )}

                      {isPublic(basicInfo.phase as Phase) && seatTotals.filled > 0 && (
                        <div className={styles.statusRow} style={{ marginTop: 16 }}>
                          <div>
                            <span className={styles.statusRowLabel}>Public Tournament</span>
                            <span className={styles.statusRowBlurb}>
                              {seatTotals.filled} team{seatTotals.filled === 1 ? ' has' : 's have'} already registered. To call off the event, use the cancellation workflow.
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setShowBasicInfoEdit(false)}>Cancel</button>
              <button className={styles.btnActionPrimary} onClick={saveBasicInfo} disabled={basicInfoSaving}>
                {basicInfoSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TEAM REGISTRATION DETAIL MODAL ────────────────────────── */}
      {teamDetail && (
        <div className={styles.modalOverlay} onClick={() => setTeamDetailIdx(null)}>
          <div className={styles.detailDeck} onClick={e => e.stopPropagation()}>
            {/* Cards still ahead in the list, peeking out behind the current one. */}
            {hasNextTeam && <div className={`${styles.detailStackCard} ${styles.detailStackCard2}`} aria-hidden="true" />}
            {hasNextTeam && <div className={`${styles.detailStackCard} ${styles.detailStackCard1}`} aria-hidden="true" />}

            <div className={styles.modalContent} style={{ maxWidth: 520, position: 'relative', zIndex: 2 }}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Registration Details</h3>
                <span className={styles.detailCounter}>
                  {(teamDetailIdx ?? 0) + 1} of {registeredTeams.length}
                </span>
              </div>
              <button className={styles.modalCloseBtn} onClick={() => setTeamDetailIdx(null)}><X size={18} /></button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailTeamName}>
                {teamDetail.players.length > 0
                  ? joinTeamName(teamDetail.players.map(p => p.name))
                  : teamDetail.name}
              </div>
              <div className={styles.detailBadgeRow}>
                <span className={`${styles.statusBadge} ${teamDetail.status === 'confirmed' ? styles.statusConfirmed : teamDetail.status === 'waitlist' ? styles.statusWaitlist : styles.statusUnpaid}`}>
                  {teamDetail.status}
                </span>
                <span className={teamDetail.paymentCleared ? styles.badgePaid : styles.badgeUnpaid}>
                  {teamDetail.paymentCleared ? 'Paid' : 'Unpaid'}
                </span>
                {teamDetail.seed != null && (
                  <span className={styles.detailSeed}>Seed {teamDetail.seed}</span>
                )}
              </div>

              {teamDetail.players.length === 0 ? (
                <p className={styles.summaryText} style={{ marginTop: 16 }}>No player details recorded for this team.</p>
              ) : (
                teamDetail.players.map((p, idx) => (
                  <div key={p.id} className={styles.detailPlayerCard}>
                    <div className={styles.detailPlayerHeading}>Player {idx + 1}</div>
                    <div className={styles.detailRow}><span>Name</span><strong>{p.name || '—'}</strong></div>
                    <div className={styles.detailRow}><span>Contact number</span><strong>{p.phone || '—'}</strong></div>
                    <div className={styles.detailRow}><span>Email</span><strong>{p.email || '—'}</strong></div>
                    <div className={styles.detailRow}><span>Shirt size</span><strong>{p.shirtSize || '—'}</strong></div>
                  </div>
                ))
              )}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setTeamDetailIdx(null)}>Close</button>
            </div>
            </div>

            {/* Up/down pager, sitting outside the card on the right. */}
            <div className={styles.detailNav}>
              <button
                type="button"
                className={styles.detailNavBtn}
                onClick={() => stepTeamDetail(-1)}
                disabled={!hasPrevTeam}
                aria-label="Previous team"
                title="Previous team (↑)"
              >
                <ChevronUp size={20} />
              </button>
              <button
                type="button"
                className={styles.detailNavBtn}
                onClick={() => stepTeamDetail(1)}
                disabled={!hasNextTeam}
                aria-label="Next team"
                title="Next team (↓)"
              >
                <ChevronDown size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD TEAM MODAL ────────────────────────────────────────── */}
      {showAddTeamModal && activeDivision && (
        <div className={styles.modalOverlay} onClick={() => setShowAddTeamModal(false)}>
          {/* 812 = the 768px the roster measures inside the registration
              card on desktop, plus this modal's own 44px of body padding —
              so the fields come out exactly the size they are on the
              public form. Narrower viewports shrink it, and the roster's
              container query then stacks the players just as the public
              form does on a phone. */}
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: 812 }}>
            <div className={styles.modalHeader}>
              <h3>Add Team — {activeDivision.name}</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowAddTeamModal(false)}><X size={18} /></button>
            </div>
            <div className={styles.modalBody}>
              {addTeamError && <div className={styles.modalFormError}>{addTeamError}</div>}

              {/* The one rule left. Said once at the top rather than as an
                  asterisk per field, because everything else really is
                  optional and a form full of markers implies otherwise. */}
              <p className={styles.addTeamHint}>
                Every field is optional — fill in as much as you have. One player
                name is needed, since the team is named after its players.
              </p>

              {/* The public registration form's own roster component: same
                  fields, same player-ID search, same layout. The organizer
                  differs only in what is enforced, which is the `required`
                  prop — everything false here. */}
              <RosterFields
                players={addTeamPlayers}
                onPlayerChange={updateAddTeamPlayer}
                contact={addTeamContact}
                onContactChange={patch => setAddTeamContact(c => ({ ...c, ...patch }))}
                fields={activeDivision.regFields}
                required={{}}
              />
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnGhost} onClick={() => setShowAddTeamModal(false)}>Cancel</button>
              <button className={styles.btnActionPrimary} onClick={submitAddTeam} disabled={addTeamSaving}>
                {addTeamSaving ? 'Adding…' : 'Add Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PublishTournamentModal
        open={showPublishModal}
        tournamentTitle={displayTitle}
        tournamentSlug={(Array.isArray(params.id) ? params.id[0] : params.id) || ''}
        onClose={() => setShowPublishModal(false)}
        onPublished={() => {
          setBasicInfo(prev => prev ? { ...prev, phase: PHASE.announced } : null);
          setOverviewTick(t => t + 1);
        }}
      />
    </div>
  );
}
